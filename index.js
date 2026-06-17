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
      ),
      shipping AS (
        SELECT
          p.marketplace,
          p.barcode,
          sr.shipping_cost
        FROM products p
        LEFT JOIN shipping_rules sr
          ON sr.marketplace = p.marketplace
         AND p.desi >= sr.min_desi
         AND p.desi <= sr.max_desi
        WHERE p.marketplace = 'TRENDYOL'
      )
      UPDATE products p
      SET
        calculated_product_cost = COALESCE(pc.product_cost, 0),
        calculated_shipping_cost = COALESCE(s.shipping_cost, 0),
        calculated_total_cost =
          COALESCE(pc.product_cost, 0)
          + COALESCE(s.shipping_cost, 0)
          + COALESCE(p.packaging_cost, 0)
          + COALESCE(p.service_fee, 13.19)
          + COALESCE(p.target_profit, 0),

        calculated_min_price =
          CASE
            WHEN COALESCE(p.commission_rate, 0) > 0
            THEN (
              COALESCE(pc.product_cost, 0)
              + COALESCE(s.shipping_cost, 0)
              + COALESCE(p.packaging_cost, 0)
              + COALESCE(p.service_fee, 13.19)
              + COALESCE(p.target_profit, 0)
            ) / (1 - (COALESCE(p.commission_rate, 0) / 100))
            ELSE
              COALESCE(pc.product_cost, 0)
              + COALESCE(s.shipping_cost, 0)
              + COALESCE(p.packaging_cost, 0)
              + COALESCE(p.service_fee, 13.19)
              + COALESCE(p.target_profit, 0)
          END,

        min_price =
          CASE
            WHEN COALESCE(p.commission_rate, 0) > 0
            THEN (
              COALESCE(pc.product_cost, 0)
              + COALESCE(s.shipping_cost, 0)
              + COALESCE(p.packaging_cost, 0)
              + COALESCE(p.service_fee, 13.19)
              + COALESCE(p.target_profit, 0)
            ) / (1 - (COALESCE(p.commission_rate, 0) / 100))
            ELSE
              COALESCE(pc.product_cost, 0)
              + COALESCE(s.shipping_cost, 0)
              + COALESCE(p.packaging_cost, 0)
              + COALESCE(p.service_fee, 13.19)
              + COALESCE(p.target_profit, 0)
          END,

        needs_cost_mapping =
          CASE
            WHEN pc.product_cost IS NULL OR pc.product_cost <= 0 THEN true
            ELSE false
          END,

        updated_at = NOW()

      FROM product_costs pc
      LEFT JOIN shipping s
        ON s.marketplace = pc.marketplace
       AND s.barcode = pc.barcode
      WHERE p.marketplace = pc.marketplace
        AND p.barcode = pc.barcode
      RETURNING
        p.barcode,
        p.product_name,
        p.my_price,
        p.commission_rate,
        p.desi,
        p.calculated_product_cost,
        p.calculated_shipping_cost,
        p.packaging_cost,
        p.service_fee,
        p.target_profit,
        p.calculated_total_cost,
        p.calculated_min_price,
        p.min_price
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
app.get("/add-shipping-rule", async (req, res) => {
  try {
    const minDesi = Number(req.query.min);
    const maxDesi = Number(req.query.max);
    const cost = Number(req.query.cost);

    if (isNaN(minDesi) || isNaN(maxDesi) || isNaN(cost) || maxDesi <= minDesi) {
      return res.status(400).json({
        status: "error",
        message: "min, max ve cost zorunlu. Örnek: /add-shipping-rule?min=0&max=1&cost=62.5"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO shipping_rules (
        marketplace,
        min_desi,
        max_desi,
        shipping_cost,
        updated_at
      )
      VALUES ('TRENDYOL', $1, $2, $3, NOW())
      RETURNING *
      `,
      [minDesi, maxDesi, cost]
    );

    res.json({
      status: "ok",
      rule: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/shipping-rules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM shipping_rules
      WHERE marketplace = 'TRENDYOL'
      ORDER BY min_desi ASC
    `);

    res.json({
      status: "ok",
      count: result.rows.length,
      rules: result.rows
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/set-product-desi", async (req, res) => {
  try {
    const barcode = String(req.query.barcode || "").trim();
    const desi = Number(req.query.desi);

    if (!barcode || isNaN(desi) || desi <= 0) {
      return res.status(400).json({
        status: "error",
        message: "barcode ve desi zorunlu. Örnek: /set-product-desi?barcode=869xxx&desi=3.2"
      });
    }

    const result = await pool.query(
      `
      UPDATE products
      SET desi = $1,
          updated_at = NOW()
      WHERE marketplace = 'TRENDYOL'
        AND barcode = $2
      RETURNING barcode, product_name, desi
      `,
      [desi, barcode]
    );

    res.json({
      status: "ok",
      updated: result.rows.length,
      product: result.rows[0] || null
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.get("/products", async (req, res) => {
  try {
    const active = req.query.active;
    const needsCost = req.query.needs_cost;
    const missingDesi = req.query.missing_desi;
    const loss = req.query.loss;
    const limit = Number(req.query.limit || 100);

    const conditions = ["marketplace = 'TRENDYOL'"];

    if (active === "true") conditions.push("on_sale = true");
    if (active === "false") conditions.push("on_sale = false");
    if (needsCost === "true") conditions.push("needs_cost_mapping = true");
    if (missingDesi === "true") conditions.push("(desi IS NULL OR desi <= 0)");
    if (loss === "true") conditions.push("my_price > 0 AND min_price > 0 AND my_price < min_price");

    const whereClause = conditions.join(" AND ");

    const result = await pool.query(`
      SELECT
        barcode,
        product_name,
        brand,
        category_name,
        my_price,
        list_price,
        stock_quantity,
        on_sale,
        desi,
        commission_rate,
        calculated_product_cost,
        calculated_shipping_cost,
        calculated_total_cost,
        min_price,
        ROUND((my_price - min_price), 2) AS price_vs_min,
        needs_cost_mapping,
        auto_update,
        updated_at
      FROM products
      WHERE ${whereClause}
      ORDER BY category_name ASC, product_name ASC
      LIMIT $1
    `, [limit]);

    res.json({
      status: "ok",
      count: result.rows.length,
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
