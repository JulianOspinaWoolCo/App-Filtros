const fetch = require("node-fetch");
const { upsertProduct, deleteProduct } = require("./db");

const SHOP_DOMAIN  = process.env.SHOP_DOMAIN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const API_VERSION  = process.env.API_VERSION || "2024-10";
const GRAPHQL_URL  = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

const HEADERS = {
  "Content-Type": "application/json",
  "X-Shopify-Access-Token": ACCESS_TOKEN,
};

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  // Throttle automático
  const available = json?.extensions?.cost?.throttleStatus?.currentlyAvailable || 1000;
  if (available < 200) {
    console.log(`   ⏳ Rate limit (${available} pts), esperando 2s...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  return json.data;
}

// Transforma un nodo de producto de GraphQL al formato de la DB
function transformProduct(node) {
  const getMeta = (key) => {
    const mf = (node.metafields?.nodes || []).find(m => m.key === key);
    return mf ? mf.value : null;
  };

  const variants = node.variants?.nodes || [];
  const prices   = variants.map(v => parseFloat(v.price)).filter(Boolean);
  const invQty   = variants.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0);
  const available = variants.some(v => v.availableForSale);

  const colorRaw  = getMeta("color") || "";
  const numberRaw = getMeta("number") || "";
  const numParsed = parseFloat(numberRaw.replace(/[^\d.]/g, "")) || null;
  const craftRaw  = getMeta("craft") || "";
  const handDye   = getMeta("hand_dye") === "true";

  // Recoger todos los metafields como JSON
  const allMeta = {};
  (node.metafields?.nodes || []).forEach(m => {
    allMeta[`${m.namespace}.${m.key}`] = m.value;
  });

  // Colecciones como array de IDs
  const collections = (node.collections?.nodes || []).map(c => c.id);

  return {
    id:           node.id,
    handle:       node.handle,
    title:        node.title,
    vendor:       node.vendor,
    product_type: node.productType,
    status:       node.status,
    price_min:    prices.length ? Math.min(...prices) : null,
    price_max:    prices.length ? Math.max(...prices) : null,
    available,
    inventory_qty: invQty,
    image_src:    node.featuredImage?.url || null,
    color:        colorRaw.trim().toLowerCase(),
    number:       numberRaw.trim().toLowerCase(),
    number_num:   numParsed,
    craft:        craftRaw.trim().toLowerCase(),
    hand_dye:     handDye,
    metafields:   allMeta,
    collections,
  };
}

const PRODUCT_QUERY = `
  query($cursor: String) {
    products(first: 50, after: $cursor) {
      nodes {
        id handle title vendor productType status
        featuredImage { url }
        variants(first: 10) {
          nodes {
            price
            availableForSale
            inventoryQuantity
          }
        }
        collections(first: 20) {
          nodes { id }
        }
        metafields(first: 30) {
          nodes { namespace key value }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Sync completo de todos los productos
async function syncAll() {
  console.log("🔄 Iniciando sync completo...");
  let cursor = null;
  let total  = 0;
  let page   = 1;

  while (true) {
    console.log(`   Página ${page}...`);
    const data = await gql(PRODUCT_QUERY, { cursor });
    const { nodes, pageInfo } = data.products;

    for (const node of nodes) {
      const product = transformProduct(node);
      await upsertProduct(product);
      total++;
    }

    console.log(`   ✅ ${total} productos sincronizados`);

    if (pageInfo.hasNextPage) {
      cursor = pageInfo.endCursor;
      page++;
      await new Promise(r => setTimeout(r, 300)); // evitar rate limit
    } else {
      break;
    }
  }

  console.log(`✅ Sync completo: ${total} productos`);
  return total;
}

// Sync de un solo producto (para webhooks)
async function syncProduct(productId) {
  const query = `
    query($id: ID!) {
      product(id: $id) {
        id handle title vendor productType status
        featuredImage { url }
        variants(first: 10) {
          nodes { price availableForSale inventoryQuantity }
        }
        collections(first: 20) {
          nodes { id }
        }
        metafields(first: 30) {
          nodes { namespace key value }
        }
      }
    }
  `;

  const data = await gql(query, { id: productId });
  if (!data?.product) {
    console.warn(`[sync] Producto ${productId} no encontrado — eliminando`);
    await deleteProduct(productId);
    return;
  }

  const product = transformProduct(data.product);
  await upsertProduct(product);
  console.log(`[sync] ✅ Producto actualizado: ${product.title}`);
}

module.exports = { syncAll, syncProduct };
