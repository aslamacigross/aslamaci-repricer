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
  const apiKey = process.env.TY_API_KEY;
  const apiSecret = process.env.TY_API_SECRET;

  return "Basic " + Buffer.from(apiKey + ":" + apiSecret).toString("base64");
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
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});
app.get("/reset-products", async (req,res)=>{
  try{

    await pool.query(`
      DROP TABLE IF EXISTS products;
    `);

    res.json({
      status:"ok",
      message:"Products table dropped"
    });

  }catch(error){
    res.status(500).json({
      status:"error",
      message:error.message
    });
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
    min_price NUMERIC,
    auto_update BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    needs_cost_mapping BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(marketplace, barcode)
  );
`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        marketplace TEXT NOT NULL,
        barcode TEXT NOT NULL,
        product_name TEXT,
        my_price NUMERIC,
        buybox_price NUMERIC,
        second_price NUMERIC,
        third_price NUMERIC,
        rank INTEGER,
        has_multiple_seller BOOLEAN,
        min_price NUMERIC,
        auto_update BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(marketplace, barcode)
      );
    `);

    res.json({
      status: "ok",
      message: "Database tables created"
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message
    });
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
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Aşlamacı Repricer running on port ${PORT}`);
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
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});
app.get("/products-summary", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_products,
        COUNT(*) FILTER (WHERE is_active = true) AS active_products,
        COUNT(*) FILTER (WHERE on_sale = true) AS on_sale_products,
        COUNT(*) FILTER (WHERE needs_cost_mapping = true) AS needs_cost_mapping,
        COUNT(*) FILTER (WHERE auto_update = true) AS auto_update_enabled
      FROM products
      WHERE marketplace = 'TRENDYOL'
    `);

    res.json({
      status: "ok",
      summary: result.rows[0]
    });

  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});
