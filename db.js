const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id            TEXT PRIMARY KEY,
      handle        TEXT NOT NULL,
      title         TEXT,
      vendor        TEXT,
      product_type  TEXT,
      status        TEXT,
      price_min     NUMERIC,
      price_max     NUMERIC,
      available     BOOLEAN DEFAULT false,
      inventory_qty INTEGER DEFAULT 0,
      image_src     TEXT,
      color         TEXT,
      number        TEXT,
      number_num    NUMERIC,
      craft         TEXT,
      hand_dye      BOOLEAN DEFAULT false,
      metafields    JSONB DEFAULT '{}',
      collections   TEXT[] DEFAULT '{}',
      updated_at    TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_color      ON products(color);
    CREATE INDEX IF NOT EXISTS idx_products_number_num ON products(number_num);
    CREATE INDEX IF NOT EXISTS idx_products_title      ON products(title);
    CREATE INDEX IF NOT EXISTS idx_products_available  ON products(available);
    CREATE INDEX IF NOT EXISTS idx_products_collections ON products USING GIN(collections);
  `);
  console.log("✅ DB ready");
}

// Upsert un producto
async function upsertProduct(p) {
  await pool.query(`
    INSERT INTO products (
      id, handle, title, vendor, product_type, status,
      price_min, price_max, available, inventory_qty, image_src,
      color, number, number_num, craft, hand_dye,
      metafields, collections, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,$18,NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      handle       = EXCLUDED.handle,
      title        = EXCLUDED.title,
      vendor       = EXCLUDED.vendor,
      product_type = EXCLUDED.product_type,
      status       = EXCLUDED.status,
      price_min    = EXCLUDED.price_min,
      price_max    = EXCLUDED.price_max,
      available    = EXCLUDED.available,
      inventory_qty= EXCLUDED.inventory_qty,
      image_src    = EXCLUDED.image_src,
      color        = EXCLUDED.color,
      number       = EXCLUDED.number,
      number_num   = EXCLUDED.number_num,
      craft        = EXCLUDED.craft,
      hand_dye     = EXCLUDED.hand_dye,
      metafields   = EXCLUDED.metafields,
      collections  = EXCLUDED.collections,
      updated_at   = NOW()
  `, [
    p.id, p.handle, p.title, p.vendor, p.product_type, p.status,
    p.price_min, p.price_max, p.available, p.inventory_qty, p.image_src,
    p.color, p.number, p.number_num, p.craft, p.hand_dye,
    JSON.stringify(p.metafields), p.collections,
  ]);
}

// Query productos con filtros y sort
async function queryProducts({ collectionId, sortBy, order, onlyInStock, limit, offset }) {
  const conditions = ["$1 = ANY(collections)"];
  const params = [collectionId];
  let idx = 2;

  if (onlyInStock) {
    conditions.push(`available = true`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  // Sort
  const dir = order === "desc" ? "DESC" : "ASC";
  let orderClause;
  if (sortBy === "color") {
    orderClause = `color ${dir} NULLS LAST, title ASC`;
  } else if (sortBy === "number") {
    orderClause = `number_num ${dir} NULLS LAST, number ${dir} NULLS LAST, title ASC`;
  } else if (sortBy === "name") {
    orderClause = `title ${dir}`;
  } else if (sortBy === "price") {
    orderClause = `price_min ${dir} NULLS LAST`;
  } else {
    orderClause = `color ASC NULLS LAST, title ASC`;
  }

  // Count
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM products ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  // Data
  const dataRes = await pool.query(
    `SELECT * FROM products ${where} ORDER BY ${orderClause} LIMIT $${idx} OFFSET $${idx+1}`,
    [...params, limit || 48, offset || 0]
  );

  return { total, products: dataRes.rows };
}

async function deleteProduct(id) {
  await pool.query("DELETE FROM products WHERE id = $1", [id]);
}

async function getProductCount() {
  const res = await pool.query("SELECT COUNT(*) FROM products");
  return parseInt(res.rows[0].count, 10);
}

module.exports = { pool, setupDB, upsertProduct, queryProducts, deleteProduct, getProductCount };
