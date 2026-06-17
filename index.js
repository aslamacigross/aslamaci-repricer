require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

function trendyolAuthHeader() {
  return "Basic " + Buffer
    .from(process.env.TY_API_KEY + ":" + process.env.TY_API_SECRET)
    .toString("base64");
}

function trendyolHeaders() {
  return {
    Authorization: trendyolAuthHeader(),
    "User-Agent": process.env.TY_SUPPLIER_ID + " - SelfIntegration",
    "Content-Type": "application/json"
  };
}

app.get("/", (req, res) => {
  res.send("Aşlamacı Repricer v2 çalışıyor 🚀");
});

app.get("/health", async (req, res) => {
  try {
    const db = await pool.query("SELECT NOW() as now");
    res.json({
      status: "ok",
      app: "aslamaci-repricer",
      database: "connected",
      time: db.rows[0].now
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/reset-products", async (req, res) => {
  try {
    await pool.query(`DROP TABLE IF EXISTS products;`);
    res.json({ status: "ok", message: "Products table dropped" });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/setup-db", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        marketplace TEXT NOT NULL,
        barcode TEXT NOT NULL,
        product_name TEXT,
        brand TEXT,
        category_name TEXT,
        category_id TEXT,
        commission_rate NUMERIC,
        my_price NUMERIC,
        list_price NUMERIC,
        stock_quantity INTEGER,
        archived BOOLEAN DEFAULT false,
        locked BOOLEAN DEFAULT false,
        on_sale BOOLEAN DEFAULT false,
        approved BOOLEAN DEFAULT false,
        buybox_price NUMERIC,
        second_price NUMERIC,
        third_price NUMERIC,
        rank INTEGER,
        has_multiple_seller BOOLEAN,
        desi NUMERIC,
        packaging_cost NUMERIC DEFAULT 0,
        service_fee NUMERIC DEFAULT 13.19,
        target_profit NUMERIC DEFAULT 0,
        calculated_product_cost NUMERIC DEFAULT 0,
        calculated_shipping_cost NUMERIC DEFAULT 0,
        calculated_total_cost NUMERIC DEFAULT 0,
        calculated_min_price NUMERIC DEFAULT 0,
        min_price NUMERIC,
        auto_update BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        needs_cost_mapping BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(marketplace, barcode)
      );
    `);

    await pool.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS brand TEXT,
      ADD COLUMN IF NOT EXISTS category_name TEXT,
      ADD COLUMN IF NOT EXISTS category_id TEXT,
      ADD COLUMN IF NOT EXISTS commission_rate NUMERIC,
      ADD COLUMN IF NOT EXISTS list_price NUMERIC,
      ADD COLUMN IF NOT EXISTS stock_quantity INTEGER,
      ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS on_sale BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS desi NUMERIC,
      ADD COLUMN IF NOT EXISTS packaging_cost NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS service_fee NUMERIC DEFAULT 13.19,
      ADD COLUMN IF NOT EXISTS target_profit NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS calculated_product_cost NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS calculated_shipping_cost NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS calculated_total_cost NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS calculated_min_price NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS needs_cost_mapping BOOLEAN DEFAULT true;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cost_items (
        id SERIAL PRIMARY KEY,
        item_code TEXT UNIQUE NOT NULL,
        item_name TEXT NOT NULL,
        unit_cost NUMERIC NOT NULL DEFAULT 0,
        unit TEXT DEFAULT 'adet',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_cost_mappings (
        id SERIAL PRIMARY KEY,
        marketplace TEXT NOT NULL,
        barcode TEXT NOT NULL,
        cost_item_code TEXT NOT NULL,
        quantity NUMERIC NOT NULL DEFAULT 1,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(marketplace, barcode, cost_item_code)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipping_rules (
        id SERIAL PRIMARY KEY,
        marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
        min_desi NUMERIC NOT NULL,
        max_desi NUMERIC NOT NULL,
        shipping_cost NUMERIC NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS price_war_log (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW(),
        marketplace TEXT NOT NULL,
        barcode TEXT NOT NULL,
        product_name TEXT,
        old_price NUMERIC,
        new_price NUMERIC,
        price_diff NUMERIC,
        buybox_price NUMERIC,
        second_price NUMERIC,
        third_price NUMERIC,
        rank INTEGER,
        min_price NUMERIC,
        action TEXT
      );
    `);

    res.json({ status: "ok", message: "Database tables created" });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/test-trendyol", async (req, res) => {
  try {
    const supplierId = process.env.TY_SUPPLIER_ID;

    const url =
      "https://apigw.trendyol.com/integration/product/sellers/" +
      supplierId +
      "/products?approved=true&page=0&size=1";

    const response = await fetch(url, {
      method: "GET",
      headers: trendyolHeaders()
    });

    const text = await response.text();

    res.status(response.status).json({
      status: response.ok ? "ok" : "error",
      httpStatus: response.status,
      raw: text
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/sync-products", async (req, res) => {
  try {
    const supplierId = process.env.TY_SUPPLIER_ID;

    let page = 0;
    let totalSynced = 0;

    while (true) {
      const url =
        "https://apigw.trendyol.com/integration/product/sellers/" +
        supplierId +
        "/products?approved=true&page=" +
        page +
        "&size=200";

      const response = await fetch(url, {
        method: "GET",
        headers: trendyolHeaders()
      });

      const text = await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          status: "error",
          httpStatus: response.status,
          raw: text
        });
      }

      const data = JSON.parse(text);
      const products = data.content || [];

      for (const p of products) {
        const barcode = String(p.barcode || "").trim();
        if (!barcode) continue;

        await pool.query(
          `
          INSERT INTO products (
            marketplace,
            barcode,
            product_name,
            brand,
            category_name,
            category_id,
            commission_rate,
            my_price,
            list_price,
            stock_quantity,
            archived,
            locked,
            on_sale,
            approved,
            is_active,
            updated_at
          )
          VALUES (
            'TRENDYOL',
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,NOW()
          )
          ON CONFLICT (marketplace, barcode)
          DO UPDATE SET
            product_name = EXCLUDED.product_name,
            brand = EXCLUDED.brand,
            category_name = EXCLUDED.category_name,
            category_id = EXCLUDED.category_id,
            commission_rate = EXCLUDED.commission_rate,
            my_price = EXCLUDED.my_price,
            list_price = EXCLUDED.list_price,
            stock_quantity = EXCLUDED.stock_quantity,
            archived = EXCLUDED.archived,
            locked = EXCLUDED.locked,
            on_sale = EXCLUDED.on_sale,
            approved = EXCLUDED.approved,
            is_active = true,
            updated_at = NOW()
          `,
          [
            barcode,
            p.title || "",
            p.brand || "",
            p.categoryName || "",
            String(p.pimCategoryId || p.categoryId || ""),
            Number(p.vatRate || 0),
            Number(p.salePrice || 0),
            Number(p.listPrice || 0),
            Number(p.quantity || 0),
            Boolean(p.archived),
            Boolean(p.locked),
            Boolean(p.onSale),
            Boolean(p.approved)
          ]
        );

        totalSynced++;
      }

      if (data.last === true || products.length === 0) break;
      page++;
    }

    res.json({
      status: "ok",
      synced: totalSynced,
      message: "Products synced to PostgreSQL"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/products-summary", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_products,
        COUNT(*) FILTER (WHERE on_sale = true) AS active_products,
        COUNT(*) FILTER (WHERE on_sale = false) AS passive_products,
        COUNT(*) FILTER (WHERE on_sale = true) AS on_sale_products,
        COUNT(*) FILTER (WHERE needs_cost_mapping = true AND on_sale = true) AS needs_cost_mapping,
        COUNT(*) FILTER (WHERE auto_update = true AND on_sale = true) AS auto_update_enabled
      FROM products
      WHERE marketplace = 'TRENDYOL'
    `);

    res.json({
      status: "ok",
      summary: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/cost-items", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM cost_items
      ORDER BY item_name ASC
    `);

    res.json({
      status: "ok",
      count: result.rows.length,
      items: result.rows
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/add-cost-item", async (req, res) => {
  try {
    const itemCode = String(req.query.code || "").trim();
    const itemName = String(req.query.name || "").trim();
    const unitCost = Number(req.query.cost || 0);
    const unit = String(req.query.unit || "adet").trim();

    if (!itemCode || !itemName || unitCost <= 0) {
      return res.status(400).json({
        status: "error",
        message:
          "code, name ve cost zorunlu. Örnek: /add-cost-item?code=YUM1500&name=Yumusatici%201500ml&cost=78"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO cost_items (
        item_code,
        item_name,
        unit_cost,
        unit,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (item_code)
      DO UPDATE SET
        item_name = EXCLUDED.item_name,
        unit_cost = EXCLUDED.unit_cost,
        unit = EXCLUDED.unit,
        updated_at = NOW()
      RETURNING *
      `,
      [itemCode, itemName, unitCost, unit]
    );

    res.json({
      status: "ok",
      item: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.get("/map-product-cost", async (req, res) => {
  try {
    const barcode = String(req.query.barcode || "").trim();
    const costItemCode = String(req.query.cost_code || "").trim();
    const quantity = Number(req.query.qty || 1);

    if (!barcode || !costItemCode || quantity <= 0) {
      return res.status(400).json({
        status: "error",
        message: "barcode, cost_code ve qty zorunlu. Örnek: /map-product-cost?barcode=869xxx&cost_code=YUM1500&qty=4"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO product_cost_mappings (
        marketplace,
        barcode,
        cost_item_code,
        quantity,
        updated_at
      )
      VALUES ('TRENDYOL', $1, $2, $3, NOW())
      ON CONFLICT (marketplace, barcode, cost_item_code)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        updated_at = NOW()
      RETURNING *
      `,
      [barcode, costItemCode, quantity]
    );

    await pool.query(
      `
      UPDATE products
      SET needs_cost_mapping = false
      WHERE marketplace = 'TRENDYOL'
      AND barcode = $1
      `,
      [barcode]
    );

    res.json({
      status: "ok",
      mapping: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});
app.get("/product-cost-mappings", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        pcm.barcode,
        p.product_name,
        pcm.cost_item_code,
        ci.item_name,
        pcm.quantity,
        ci.unit_cost,
        pcm.quantity * ci.unit_cost AS total_cost
      FROM product_cost_mappings pcm
      LEFT JOIN cost_items ci
        ON ci.item_code = pcm.cost_item_code
      LEFT JOIN products p
        ON p.marketplace = pcm.marketplace
       AND p.barcode = pcm.barcode
      WHERE pcm.marketplace = 'TRENDYOL'
      ORDER BY p.product_name ASC
    `);

    res.json({
      status: "ok",
      count: result.rows.length,
      mappings: result.rows
    });

  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});
app.get("/calculate-costs", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH product_costs AS (
        SELECT
          pcm.marketplace,
          pcm.barcode,
          SUM(pcm.quantity * ci.unit_cost) AS product_cost
        FROM product_cost_mappings pcm
        JOIN cost_items ci
          ON ci.item_code = pcm.cost_item_code
        WHERE pcm.marketplace = 'TRENDYOL'
        GROUP BY pcm.marketplace, pcm.barcode
      )
      UPDATE products p
      SET
        calculated_product_cost = pc.product_cost,
        needs_cost_mapping = false,
        updated_at = NOW()
      FROM product_costs pc
      WHERE p.marketplace = pc.marketplace
        AND p.barcode = pc.barcode
      RETURNING
        p.barcode,
        p.product_name,
        p.calculated_product_cost
    `);

    res.json({
      status: "ok",
      updated: result.rows.length,
      products: result.rows
    });

  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});
app.listen(PORT, () => {
  console.log(`Aşlamacı Repricer running on port ${PORT}`);
});
