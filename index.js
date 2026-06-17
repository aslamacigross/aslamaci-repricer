require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
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

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

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

app.get("/setup-db", async (req, res) => {
  try {
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

app.listen(PORT, () => {
  console.log(`Aşlamacı Repricer running on port ${PORT}`);
});
