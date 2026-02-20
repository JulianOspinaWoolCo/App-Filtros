const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");
const cron    = require("node-cron");

const { setupDB, queryProducts, getProductCount } = require("./db");
const { syncAll, syncProduct } = require("./shopify");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS: permitir llamadas desde tu tienda Shopify ──────────────────────────
const SHOP_DOMAIN = process.env.SHOP_DOMAIN || "";
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // Postman / curl
    if (
      origin.includes("myshopify.com") ||
      origin.includes("shopify.com") ||
      (process.env.STORE_DOMAIN && origin.includes(process.env.STORE_DOMAIN))
    ) {
      cb(null, true);
    } else {
      cb(null, true); // en dev aceptar todo; en prod puedes restringir
    }
  },
}));

// Raw body para webhooks (antes del json parser)
app.use("/webhooks", express.raw({ type: "application/json" }));
app.use(express.json());

// ── API: buscar productos ─────────────────────────────────────────────────────
/**
 * GET /api/products
 * Query params:
 *   collection  — ID de colección (gid://shopify/Collection/123) REQUERIDO
 *   sortBy      — color | number | name | price  (default: color)
 *   order       — asc | desc  (default: asc)
 *   instock     — true | false
 *   page        — número de página (default: 1)
 *   limit       — productos por página (default: 48, max: 250)
 */
app.get("/api/products", async (req, res) => {
  try {
    const {
      collection,
      sortBy   = "color",
      order    = "asc",
      instock,
      page     = 1,
      limit    = 48,
    } = req.query;

    if (!collection) {
      return res.status(400).json({ error: "collection param required" });
    }

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(250, Math.max(1, parseInt(limit, 10) || 48));
    const offset   = (pageNum - 1) * limitNum;

    const result = await queryProducts({
      collectionId: collection,
      sortBy,
      order,
      onlyInStock: instock === "true",
      limit:  limitNum,
      offset,
    });

    res.json({
      total:    result.total,
      page:     pageNum,
      limit:    limitNum,
      pages:    Math.ceil(result.total / limitNum),
      products: result.products,
    });

  } catch (err) {
    console.error("[api/products]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── WEBHOOKS de Shopify ───────────────────────────────────────────────────────
function verifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // skip en dev
  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader || ""));
  } catch {
    return false;
  }
}

// Producto creado o actualizado
app.post("/webhooks/products/update", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!verifyWebhook(req.body, hmac)) {
    return res.status(401).send("Unauthorized");
  }
  res.status(200).send("OK"); // responder a Shopify de inmediato

  try {
    const body = JSON.parse(req.body.toString());
    const gid  = body.admin_graphql_api_id;
    if (gid) {
      console.log(`[webhook] Actualizando producto: ${gid}`);
      await syncProduct(gid);
    }
  } catch (err) {
    console.error("[webhook/update]", err.message);
  }
});

// Producto eliminado
app.post("/webhooks/products/delete", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!verifyWebhook(req.body, hmac)) {
    return res.status(401).send("Unauthorized");
  }
  res.status(200).send("OK");

  try {
    const body = JSON.parse(req.body.toString());
    const gid  = body.admin_graphql_api_id;
    if (gid) {
      const { deleteProduct } = require("./db");
      await deleteProduct(gid);
      console.log(`[webhook] Producto eliminado: ${gid}`);
    }
  } catch (err) {
    console.error("[webhook/delete]", err.message);
  }
});

// ── SYNC manual ───────────────────────────────────────────────────────────────
app.post("/admin/sync", async (req, res) => {
  // Proteger con una clave simple
  const key = req.headers["x-admin-key"];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ message: "Sync iniciado en background" });
  syncAll().catch(console.error);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", async (req, res) => {
  const count = await getProductCount().catch(() => -1);
  res.json({
    status:   "ok",
    shop:     SHOP_DOMAIN,
    products: count,
    version:  "1.0.0",
  });
});

// ── CRON: sync completo una vez al día (3am) ─────────────────────────────────
cron.schedule("0 3 * * *", async () => {
  console.log("[cron] Iniciando sync diario...");
  await syncAll().catch(console.error);
});

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  await setupDB();

  // Si la DB está vacía, hacer sync inicial automáticamente
  const count = await getProductCount();
  if (count === 0) {
    console.log("DB vacía — iniciando sync inicial...");
    syncAll().catch(console.error);
  } else {
    console.log(`✅ DB lista con ${count} productos`);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Shopify Search App corriendo en puerto ${PORT}`);
    console.log(`   Shop: ${SHOP_DOMAIN}`);
    console.log(`   API:  http://localhost:${PORT}/api/products?collection=gid://...`);
  });
}

init().catch(err => {
  console.error("Error iniciando:", err);
  process.exit(1);
});
