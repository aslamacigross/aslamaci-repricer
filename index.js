require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const MARKETPLACE = "TRENDYOL";
const DEFAULT_CARRIER = "TEX";
const DEFAULT_SERVICE_FEE = 13.19;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

function parseNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function trendyolAuthHeader() {
  return (
    "Basic " +
    Buffer.from(
      process.env.TY_API_KEY + ":" + process.env.TY_API_SECRET
    ).toString("base64")
  );
}

function trendyolHeaders() {
  return {
    Authorization: trendyolAuthHeader(),
    "User-Agent": process.env.TY_SUPPLIER_ID + " - SelfIntegration",
    "Content-Type": "application/json"
  };
}

function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

async function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: "v4", auth });
}

app.get("/", (req, res) => {
  res.send("Aşlamacı ERP / Repricer çalışıyor 🚀");
});

app.get("/health", async (req, res) => {
  try {
    const db = await pool.query("SELECT NOW() AS now");
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
        min_price NUMERIC DEFAULT 0,
        calculated_net_profit NUMERIC DEFAULT 0,
        calculated_net_margin NUMERIC DEFAULT 0,
        auto_update BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        needs_cost_mapping BOOLEAN DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(marketplace, barcode)
      );
    `);

    const productColumns = [
      "brand TEXT",
      "category_name TEXT",
      "category_id TEXT",
      "commission_rate NUMERIC",
      "my_price NUMERIC",
      "list_price NUMERIC",
      "stock_quantity INTEGER",
      "archived BOOLEAN DEFAULT false",
      "locked BOOLEAN DEFAULT false",
      "on_sale BOOLEAN DEFAULT false",
      "approved BOOLEAN DEFAULT false",
      "buybox_price NUMERIC",
      "second_price NUMERIC",
      "third_price NUMERIC",
      "rank INTEGER",
      "has_multiple_seller BOOLEAN",
      "desi NUMERIC",
      "packaging_cost NUMERIC DEFAULT 0",
      "service_fee NUMERIC DEFAULT 13.19",
      "target_profit NUMERIC DEFAULT 0",
      "calculated_product_cost NUMERIC DEFAULT 0",
      "calculated_shipping_cost NUMERIC DEFAULT 0",
      "calculated_total_cost NUMERIC DEFAULT 0",
      "calculated_min_price NUMERIC DEFAULT 0",
      "min_price NUMERIC DEFAULT 0",
      "calculated_net_profit NUMERIC DEFAULT 0",
      "calculated_net_margin NUMERIC DEFAULT 0",
      "auto_update BOOLEAN DEFAULT false",
      "is_active BOOLEAN DEFAULT true",
      "needs_cost_mapping BOOLEAN DEFAULT true",
      "updated_at TIMESTAMP DEFAULT NOW()"
    ];

    for (const col of productColumns) {
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${col};`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cost_items (
        id SERIAL PRIMARY KEY,
        item_code TEXT UNIQUE NOT NULL,
        item_name TEXT NOT NULL,
        unit_cost NUMERIC NOT NULL DEFAULT 0,
        unit TEXT DEFAULT 'adet',
        unit_desi NUMERIC DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS shipping_costs (
        id SERIAL PRIMARY KEY,
        desi_kg NUMERIC NOT NULL,
        carrier TEXT NOT NULL,
        cost_ex_vat NUMERIC NOT NULL,
        cost_inc_vat NUMERIC NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(desi_kg, carrier)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipping_barems (
        id SERIAL PRIMARY KEY,
        min_basket NUMERIC NOT NULL,
        max_basket NUMERIC NOT NULL,
        barem_name TEXT,
        carrier TEXT NOT NULL,
        cost_ex_vat NUMERIC NOT NULL,
        cost_inc_vat NUMERIC NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(min_basket, max_basket, carrier)
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS buybox_snapshots (
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
        net_profit NUMERIC,
        net_margin NUMERIC,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    res.json({
      status: "ok",
      message: "Database tables created/updated"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.get("/test-trendyol", async (req, res) => {
  try {
    const supplierId = process.env.TY_SUPPLIER_ID;

    const url =
      `https://apigw.trendyol.com/integration/product/sellers/${supplierId}` +
      `/products?approved=true&page=0&size=1`;

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

app.get("/test-sheet", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID
    });

    res.json({
      status: "ok",
      title: result.data.properties.title,
      sheets: result.data.sheets.map(s => s.properties.title)
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
        `https://apigw.trendyol.com/integration/product/sellers/${supplierId}` +
        `/products?approved=true&page=${page}&size=200`;

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
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,NOW()
          )
          ON CONFLICT (marketplace, barcode)
          DO UPDATE SET
            product_name = EXCLUDED.product_name,
            brand = EXCLUDED.brand,
            category_name = EXCLUDED.category_name,
            category_id = EXCLUDED.category_id,
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
            MARKETPLACE,
            barcode,
            p.title || "",
            p.brand || "",
            p.categoryName || "",
            String(p.pimCategoryId || p.categoryId || ""),
            parseNumber(p.salePrice),
            parseNumber(p.listPrice),
            parseNumber(p.quantity),
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
      message: "Products synced without overwriting commissions"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/import-cost-index", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "MaliyetIndex!A2:F"
    });

    const rows = result.data.values || [];
    let imported = 0;

    for (const row of rows) {
      const itemCode = String(row[0] || "").trim();
      const itemName = String(row[1] || "").trim();
      const unitCost = parseNumber(row[2]);
      const unitDesi = parseNumber(row[3]);
      const unit = String(row[4] || "adet").trim();

      if (!itemCode || !itemName || unitCost <= 0) continue;

      await pool.query(
        `
        INSERT INTO cost_items (
          item_code,
          item_name,
          unit_cost,
          unit_desi,
          unit,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (item_code)
        DO UPDATE SET
          item_name = EXCLUDED.item_name,
          unit_cost = EXCLUDED.unit_cost,
          unit_desi = EXCLUDED.unit_desi,
          unit = EXCLUDED.unit,
          updated_at = NOW()
        `,
        [itemCode, itemName, unitCost, unitDesi, unit]
      );

      imported++;
    }

    res.json({
      status: "ok",
      imported,
      message: "MaliyetIndex imported"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/import-product-mappings", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "UrunMaliyetMap!A2:D"
    });

    const rows = result.data.values || [];
    let imported = 0;

    for (const row of rows) {
      const barcode = String(row[0] || "").trim();
      const costCode = String(row[1] || "").trim();
      const quantity = parseNumber(row[2], 1);

      if (!barcode || !costCode || quantity <= 0) continue;

      await pool.query(
        `
        INSERT INTO product_cost_mappings (
          marketplace,
          barcode,
          cost_item_code,
          quantity,
          updated_at
        )
        VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (marketplace, barcode, cost_item_code)
        DO UPDATE SET
          quantity = EXCLUDED.quantity,
          updated_at = NOW()
        `,
        [MARKETPLACE, barcode, costCode, quantity]
      );

      imported++;
    }

    res.json({
      status: "ok",
      imported,
      message: "UrunMaliyetMap imported"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/import-commissions", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "KomisyonKurallari!A2:D"
    });

    const rows = result.data.values || [];
    let importedRules = 0;
    let updatedProducts = 0;

    for (const row of rows) {
      const categoryId = String(row[0] || "").trim();
      const commissionRate = parseNumber(row[1]);

      if (!categoryId || commissionRate <= 0) continue;

      const update = await pool.query(
        `
        UPDATE products
        SET commission_rate = $1,
            updated_at = NOW()
        WHERE marketplace = $2
          AND category_id = $3
        `,
        [commissionRate, MARKETPLACE, categoryId]
      );

      importedRules++;
      updatedProducts += update.rowCount;
    }

    res.json({
      status: "ok",
      imported_rules: importedRules,
      updated_products: updatedProducts,
      message: "Category-based commissions imported"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.get("/import-shipping-costs", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "KargoMaliyetleri!A1:K"
    });

    const rows = result.data.values || [];
    if (rows.length < 2) {
      return res.json({
        status: "ok",
        imported: 0,
        message: "KargoMaliyetleri boş"
      });
    }

    const headers = rows[0].map(h => String(h || "").trim());

    await pool.query(`DELETE FROM shipping_costs;`);

    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const desiKg = parseNumber(row[0], NaN);
      if (!Number.isFinite(desiKg)) continue;

      for (let c = 1; c < headers.length; c++) {
        const carrier = headers[c];
        const costExVat = parseNumber(row[c], NaN);

        if (!carrier || !Number.isFinite(costExVat) || costExVat <= 0) continue;

        const costIncVat = Number((costExVat * 1.2).toFixed(2));

        await pool.query(
          `
          INSERT INTO shipping_costs (
            desi_kg,
            carrier,
            cost_ex_vat,
            cost_inc_vat,
            updated_at
          )
          VALUES ($1,$2,$3,$4,NOW())
          ON CONFLICT (desi_kg, carrier)
          DO UPDATE SET
            cost_ex_vat = EXCLUDED.cost_ex_vat,
            cost_inc_vat = EXCLUDED.cost_inc_vat,
            updated_at = NOW()
          `,
          [desiKg, carrier, costExVat, costIncVat]
        );

        imported++;
      }
    }

    res.json({
      status: "ok",
      imported,
      message: "KargoMaliyetleri imported"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/import-shipping-barems", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "KargoBarem!A1:J"
    });

    const rows = result.data.values || [];
    if (rows.length < 2) {
      return res.json({
        status: "ok",
        imported: 0,
        message: "KargoBarem boş"
      });
    }

    const headers = rows[0].map(h => String(h || "").trim());

    await pool.query(`DELETE FROM shipping_barems;`);

    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      const minBasket = parseNumber(row[0]);
      const maxBasket = parseNumber(row[1], 999999);
      const baremName = String(row[2] || "").trim();

      for (let c = 3; c < headers.length; c++) {
        const carrier = headers[c];
        const costExVat = parseNumber(row[c], NaN);

        if (!carrier || !Number.isFinite(costExVat) || costExVat <= 0) continue;

        const costIncVat = Number((costExVat * 1.2).toFixed(2));

        await pool.query(
          `
          INSERT INTO shipping_barems (
            min_basket,
            max_basket,
            barem_name,
            carrier,
            cost_ex_vat,
            cost_inc_vat,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,NOW())
          ON CONFLICT (min_basket, max_basket, carrier)
          DO UPDATE SET
            barem_name = EXCLUDED.barem_name,
            cost_ex_vat = EXCLUDED.cost_ex_vat,
            cost_inc_vat = EXCLUDED.cost_inc_vat,
            updated_at = NOW()
          `,
          [minBasket, maxBasket, baremName, carrier, costExVat, costIncVat]
        );

        imported++;
      }
    }

    res.json({
      status: "ok",
      imported,
      message: "KargoBarem imported"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/refresh-cost-mapping-status", async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE products p
      SET
        needs_cost_mapping =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN false
            ELSE true
          END,

        desi =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.desi
            ELSE NULL
          END,

        calculated_product_cost =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.calculated_product_cost
            ELSE 0
          END,

        calculated_shipping_cost =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.calculated_shipping_cost
            ELSE 0
          END,

        calculated_total_cost =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.calculated_total_cost
            ELSE 0
          END,

        calculated_min_price =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.calculated_min_price
            ELSE 0
          END,

        min_price =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.min_price
            ELSE 0
          END,

        calculated_net_profit =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.calculated_net_profit
            ELSE 0
          END,

        calculated_net_margin =
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_cost_mappings pcm
              WHERE pcm.marketplace = p.marketplace
                AND pcm.barcode = p.barcode
            )
            THEN p.calculated_net_margin
            ELSE 0
          END,

        updated_at = NOW()
      WHERE p.marketplace = $1
      RETURNING barcode, product_name, needs_cost_mapping
      `,
      [MARKETPLACE]
    );

    res.json({
      status: "ok",
      updated: result.rows.length,
      message: "Cost mapping status refreshed"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/calculate-costs", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH product_costs AS (
        SELECT
          pcm.marketplace,
          pcm.barcode,
          SUM(pcm.quantity * ci.unit_cost) AS product_cost,
          SUM(pcm.quantity * COALESCE(ci.unit_desi, 0)) AS total_desi
        FROM product_cost_mappings pcm
        JOIN cost_items ci
          ON ci.item_code = pcm.cost_item_code
        WHERE pcm.marketplace = '${MARKETPLACE}'
        GROUP BY pcm.marketplace, pcm.barcode
      ),
      calculated AS (
        SELECT
          p.marketplace,
          p.barcode,
          pc.product_cost,
          pc.total_desi,
          CASE
            WHEN p.my_price <= 349.99
              THEN COALESCE(sb.cost_inc_vat, 0)
            ELSE
              COALESCE(sc.cost_inc_vat, 0)
          END AS shipping_cost
        FROM products p
        JOIN product_costs pc
          ON pc.marketplace = p.marketplace
         AND pc.barcode = p.barcode
        LEFT JOIN shipping_barems sb
          ON sb.carrier = '${DEFAULT_CARRIER}'
         AND p.my_price >= sb.min_basket
         AND p.my_price <= sb.max_basket
        LEFT JOIN shipping_costs sc
          ON sc.carrier = '${DEFAULT_CARRIER}'
         AND sc.desi_kg = CEIL(pc.total_desi)
      )
      UPDATE products p
      SET
        calculated_product_cost = COALESCE(c.product_cost, 0),
        desi = COALESCE(c.total_desi, p.desi),
        calculated_shipping_cost = COALESCE(c.shipping_cost, 0),
        calculated_total_cost =
          COALESCE(c.product_cost, 0)
          + COALESCE(c.shipping_cost, 0)
          + COALESCE(p.packaging_cost, 0)
          + COALESCE(p.service_fee, ${DEFAULT_SERVICE_FEE})
          + COALESCE(p.target_profit, 0),

        calculated_min_price =
          CASE
            WHEN COALESCE(p.commission_rate, 0) > 0
            THEN (
              COALESCE(c.product_cost, 0)
              + COALESCE(c.shipping_cost, 0)
              + COALESCE(p.packaging_cost, 0)
              + COALESCE(p.service_fee, ${DEFAULT_SERVICE_FEE})
              + COALESCE(p.target_profit, 0)
            ) / (1 - (COALESCE(p.commission_rate, 0) / 100))
            ELSE 0
          END,

        min_price =
          CASE
            WHEN COALESCE(p.commission_rate, 0) > 0
            THEN (
              COALESCE(c.product_cost, 0)
              + COALESCE(c.shipping_cost, 0)
              + COALESCE(p.packaging_cost, 0)
              + COALESCE(p.service_fee, ${DEFAULT_SERVICE_FEE})
              + COALESCE(p.target_profit, 0)
            ) / (1 - (COALESCE(p.commission_rate, 0) / 100))
            ELSE 0
          END,

        calculated_net_profit =
          CASE
            WHEN COALESCE(p.commission_rate, 0) > 0
            THEN
              COALESCE(p.my_price, 0)
              - (COALESCE(p.my_price, 0) * (COALESCE(p.commission_rate, 0) / 100))
              - (
                COALESCE(c.product_cost, 0)
                + COALESCE(c.shipping_cost, 0)
                + COALESCE(p.packaging_cost, 0)
                + COALESCE(p.service_fee, ${DEFAULT_SERVICE_FEE})
              )
            ELSE 0
          END,

        calculated_net_margin =
          CASE
            WHEN COALESCE(p.my_price, 0) > 0
             AND COALESCE(p.commission_rate, 0) > 0
            THEN (
              (
                COALESCE(p.my_price, 0)
                - (COALESCE(p.my_price, 0) * (COALESCE(p.commission_rate, 0) / 100))
                - (
                  COALESCE(c.product_cost, 0)
                  + COALESCE(c.shipping_cost, 0)
                  + COALESCE(p.packaging_cost, 0)
                  + COALESCE(p.service_fee, ${DEFAULT_SERVICE_FEE})
                )
              ) / COALESCE(p.my_price, 0)
            ) * 100
            ELSE 0
          END,

        needs_cost_mapping =
          CASE
            WHEN c.product_cost IS NULL OR c.product_cost <= 0 THEN true
            ELSE false
          END,

        updated_at = NOW()
      FROM calculated c
      WHERE p.marketplace = c.marketplace
        AND p.barcode = c.barcode
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
        p.min_price,
        p.calculated_net_profit,
        p.calculated_net_margin
    `);

    res.json({
      status: "ok",
      updated: result.rows.length,
      products: result.rows
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/products-summary", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*) AS total_products,
        COUNT(*) FILTER (WHERE on_sale = true) AS active_products,
        COUNT(*) FILTER (WHERE on_sale = false) AS passive_products,
        COUNT(*) FILTER (WHERE needs_cost_mapping = true AND on_sale = true) AS needs_cost_mapping,
        COUNT(*) FILTER (WHERE commission_rate IS NULL AND on_sale = true) AS missing_commission,
        COUNT(*) FILTER (WHERE auto_update = true AND on_sale = true) AS auto_update_enabled
      FROM products
      WHERE marketplace = $1
      `,
      [MARKETPLACE]
    );

    res.json({
      status: "ok",
      summary: result.rows[0]
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
    const missingCommission = req.query.missing_commission;
    const loss = req.query.loss;
    const limit = Math.min(parseNumber(req.query.limit, 100), 500);

    const conditions = ["marketplace = $1"];
    const params = [MARKETPLACE];

    if (active === "true") conditions.push("on_sale = true");
    if (active === "false") conditions.push("on_sale = false");
    if (needsCost === "true") conditions.push("needs_cost_mapping = true");
    if (missingDesi === "true") conditions.push("(desi IS NULL OR desi <= 0)");
    if (missingCommission === "true") conditions.push("commission_rate IS NULL");
    if (loss === "true") {
      conditions.push(
        "my_price > 0 AND min_price > 0 AND calculated_net_profit < 0"
      );
    }

    const result = await pool.query(
      `
      SELECT
        barcode,
        product_name,
        brand,
        category_name,
        category_id,
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
        calculated_net_profit,
        calculated_net_margin,
        ROUND((my_price - min_price), 2) AS price_vs_min,
        needs_cost_mapping,
        auto_update,
        updated_at
      FROM products
      WHERE ${conditions.join(" AND ")}
      ORDER BY category_name ASC, product_name ASC
      LIMIT $2
      `,
      [...params, limit]
    );

    res.json({
      status: "ok",
      count: result.rows.length,
      products: result.rows
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/categories", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        category_id,
        category_name,
        COUNT(*) AS product_count
      FROM products
      WHERE marketplace = $1
      GROUP BY category_id, category_name
      ORDER BY product_count DESC
      `,
      [MARKETPLACE]
    );

    res.json({
      status: "ok",
      count: result.rows.length,
      categories: result.rows
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

app.get("/product-cost-mappings", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        pcm.barcode,
        p.product_name,
        pcm.cost_item_code,
        ci.item_name,
        pcm.quantity,
        ci.unit_cost,
        ci.unit_desi,
        pcm.quantity * ci.unit_cost AS total_cost,
        pcm.quantity * COALESCE(ci.unit_desi,0) AS total_desi
      FROM product_cost_mappings pcm
      LEFT JOIN cost_items ci
        ON ci.item_code = pcm.cost_item_code
      LEFT JOIN products p
        ON p.marketplace = pcm.marketplace
       AND p.barcode = pcm.barcode
      WHERE pcm.marketplace = $1
      ORDER BY p.product_name ASC
      `,
      [MARKETPLACE]
    );

    res.json({
      status: "ok",
      count: result.rows.length,
      mappings: result.rows
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/delete-product-mapping", async (req, res) => {
  try {
    const barcode = String(req.query.barcode || "").trim();
    const costCode = String(req.query.cost_code || "").trim();

    if (!barcode) {
      return res.status(400).json({
        status: "error",
        message: "barcode zorunlu."
      });
    }

    let result;

    if (costCode) {
      result = await pool.query(
        `
        DELETE FROM product_cost_mappings
        WHERE marketplace = $1
          AND barcode = $2
          AND cost_item_code = $3
        RETURNING *
        `,
        [MARKETPLACE, barcode, costCode]
      );
    } else {
      result = await pool.query(
        `
        DELETE FROM product_cost_mappings
        WHERE marketplace = $1
          AND barcode = $2
        RETURNING *
        `,
        [MARKETPLACE, barcode]
      );
    }

    res.json({
      status: "ok",
      deleted: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/reset-commissions", async (req, res) => {
  try {
    await pool.query(
      `
      UPDATE products
      SET commission_rate = NULL,
          updated_at = NOW()
      WHERE marketplace = $1
      `,
      [MARKETPLACE]
    );

    res.json({
      status: "ok",
      message: "All Trendyol commissions cleared"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/export-products-to-sheet", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await pool.query(
      `
      SELECT
        barcode,
        product_name,
        brand,
        category_name,
        category_id,
        my_price,
        commission_rate,
        stock_quantity,
        on_sale,
        needs_cost_mapping,
        desi,
        calculated_product_cost,
        calculated_shipping_cost,
        calculated_total_cost,
        min_price,
        calculated_net_profit,
        calculated_net_margin,
        updated_at
      FROM products
      WHERE marketplace = $1
      ORDER BY on_sale DESC, category_name ASC, product_name ASC
      `,
      [MARKETPLACE]
    );

    const header = [
      "Barkod",
      "Ürün Adı",
      "Marka",
      "Kategori",
      "Kategori ID",
      "TY Fiyatı",
      "Komisyon %",
      "Stok",
      "Aktif mi",
      "Maliyet Durumu",
      "Desi",
      "Ürün Maliyeti",
      "Kargo Maliyeti",
      "Toplam Maliyet",
      "Minimum Fiyat",
      "Net Kâr",
      "Net Marj %",
      "Son Güncelleme"
    ];

    const rows = result.rows.map(p => [
      p.barcode,
      p.product_name,
      p.brand,
      p.category_name,
      p.category_id,
      parseNumber(p.my_price),
      p.commission_rate === null ? "" : parseNumber(p.commission_rate),
      parseNumber(p.stock_quantity),
      p.on_sale ? "EVET" : "HAYIR",
      p.needs_cost_mapping ? "EKSİK" : "TAMAM",
      p.desi === null ? "" : parseNumber(p.desi),
      parseNumber(p.calculated_product_cost),
      parseNumber(p.calculated_shipping_cost),
      parseNumber(p.calculated_total_cost),
      parseNumber(p.min_price),
      parseNumber(p.calculated_net_profit),
      parseNumber(p.calculated_net_margin),
      p.updated_at
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Urunler!A:R"
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Urunler!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [header, ...rows]
      }
    });

    res.json({
      status: "ok",
      exported: rows.length,
      message: "Urunler sheet updated"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/export-new-products-to-sheet", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await pool.query(
      `
      SELECT
        barcode,
        product_name,
        brand,
        category_name,
        category_id,
        my_price,
        commission_rate,
        needs_cost_mapping,
        min_price,
        desi,
        calculated_product_cost,

        CONCAT_WS(' + ',
          CASE WHEN needs_cost_mapping = true THEN 'Maliyet Mapping Eksik' END,
          CASE WHEN commission_rate IS NULL THEN 'Komisyon Eksik' END,
          CASE WHEN needs_cost_mapping = false AND (desi IS NULL OR desi <= 0) THEN 'Desi Eksik/Hatalı' END,
          CASE WHEN needs_cost_mapping = false AND COALESCE(calculated_product_cost,0) <= 0 THEN 'Ürün Maliyeti Hesaplanamıyor' END,
          CASE WHEN needs_cost_mapping = false AND commission_rate IS NOT NULL AND COALESCE(min_price,0) = 0 THEN 'Minimum Fiyat Hesaplanamıyor' END
        ) AS issue

      FROM products
      WHERE marketplace = $1
        AND on_sale = true
        AND (
             needs_cost_mapping = true
          OR commission_rate IS NULL
          OR COALESCE(min_price,0) = 0
          OR desi IS NULL
          OR desi <= 0
          OR COALESCE(calculated_product_cost,0) <= 0
        )
      ORDER BY
        needs_cost_mapping DESC,
        commission_rate NULLS FIRST,
        product_name ASC
      `,
      [MARKETPLACE]
    );

    const header = [
      "Barkod",
      "Ürün",
      "Marka",
      "Kategori",
      "Kategori ID",
      "TY Fiyat",
      "Komisyon %",
      "Mapping",
      "Desi",
      "Ürün Maliyeti",
      "Minimum Fiyat",
      "Eksik Sebep"
    ];

    const values = result.rows.map(r => [
      r.barcode,
      r.product_name,
      r.brand,
      r.category_name,
      r.category_id,
      parseNumber(r.my_price),
      r.commission_rate === null ? "" : parseNumber(r.commission_rate),
      r.needs_cost_mapping ? "EKSİK" : "TAMAM",
      r.desi === null ? "" : parseNumber(r.desi),
      parseNumber(r.calculated_product_cost),
      parseNumber(r.min_price),
      r.issue || "Kontrol Edilmeli"
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "YeniUrunler!A:L"
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "YeniUrunler!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [header, ...values]
      }
    });

    res.json({
      status: "ok",
      exported: values.length,
      message: "YeniUrunler updated with detailed issues"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/export-dashboard-to-sheet", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const summary = await pool.query(
      `
      SELECT
        COUNT(*) AS total_products,
        COUNT(*) FILTER (WHERE on_sale = true) AS active_products,

        COUNT(*) FILTER (
          WHERE on_sale = true
          AND (
            needs_cost_mapping = true
            OR commission_rate IS NULL
            OR COALESCE(min_price,0) = 0
          )
        ) AS action_needed,

        COUNT(*) FILTER (WHERE on_sale = true AND needs_cost_mapping = false) AS costed_products,
        COUNT(*) FILTER (WHERE on_sale = true AND needs_cost_mapping = true) AS missing_mapping,
        COUNT(*) FILTER (WHERE on_sale = true AND commission_rate IS NULL) AS missing_commission,

        COUNT(*) FILTER (
          WHERE on_sale = true
          AND calculated_net_profit < 0
          AND needs_cost_mapping = false
          AND commission_rate IS NOT NULL
        ) AS loss_products,

        ROUND(AVG(calculated_net_margin) FILTER (
          WHERE on_sale = true
          AND needs_cost_mapping = false
          AND commission_rate IS NOT NULL
        ), 2) AS avg_net_margin,

        ROUND(SUM(calculated_net_profit) FILTER (
          WHERE on_sale = true
          AND needs_cost_mapping = false
          AND commission_rate IS NOT NULL
        ), 2) AS total_profit_per_unit,

        ROUND(SUM(stock_quantity * calculated_product_cost) FILTER (
          WHERE on_sale = true
          AND needs_cost_mapping = false
        ), 2) AS total_stock_value,

        ROUND(SUM(stock_quantity * calculated_net_profit) FILTER (
          WHERE on_sale = true
          AND needs_cost_mapping = false
          AND commission_rate IS NOT NULL
        ), 2) AS total_potential_stock_profit
      FROM products
      WHERE marketplace = $1
      `,
      [MARKETPLACE]
    );

    const topProfit = await pool.query(
      `
      SELECT barcode, product_name, my_price, stock_quantity,
             calculated_net_profit, calculated_net_margin
      FROM products
      WHERE marketplace = $1
        AND on_sale = true
        AND needs_cost_mapping = false
        AND commission_rate IS NOT NULL
      ORDER BY calculated_net_profit DESC
      LIMIT 20
      `,
      [MARKETPLACE]
    );

    const risky = await pool.query(
      `
      SELECT barcode, product_name, my_price, min_price,
             calculated_net_profit, calculated_net_margin
      FROM products
      WHERE marketplace = $1
        AND on_sale = true
        AND needs_cost_mapping = false
        AND commission_rate IS NOT NULL
      ORDER BY calculated_net_margin ASC
      LIMIT 20
      `,
      [MARKETPLACE]
    );

    const s = summary.rows[0];

    const values = [
      ["Aşlamacı Repricer Dashboard"],
      [""],
      ["KPI", "Değer"],
      ["Toplam Ürün", Number(s.total_products || 0)],
      ["Aktif Ürün", Number(s.active_products || 0)],
      ["Aksiyon Bekleyen Ürün", Number(s.action_needed || 0)],
      ["Maliyetlendirilmiş Ürün", Number(s.costed_products || 0)],
      ["Maliyet Mapping Eksik", Number(s.missing_mapping || 0)],
      ["Komisyon Eksik", Number(s.missing_commission || 0)],
      ["Zarardaki Ürün", Number(s.loss_products || 0)],
      ["Ortalama Net Marj %", Number(s.avg_net_margin || 0)],
      ["Toplam Ürün Başı Net Kâr", Number(s.total_profit_per_unit || 0)],
      ["Toplam Stok Değeri", Number(s.total_stock_value || 0)],
      ["Toplam Potansiyel Stok Kârı", Number(s.total_potential_stock_profit || 0)],
      ["Son Güncelleme", new Date().toISOString()],
      [""],
      ["En Çok Kâr Bırakan Ürünler"],
      ["Barkod", "Ürün", "TY Fiyat", "Stok", "Net Kâr", "Net Marj %"],
      ...topProfit.rows.map(r => [
        r.barcode,
        r.product_name,
        parseNumber(r.my_price),
        parseNumber(r.stock_quantity),
        parseNumber(r.calculated_net_profit),
        parseNumber(r.calculated_net_margin)
      ]),
      [""],
      ["Riskli / Düşük Marjlı Ürünler"],
      ["Barkod", "Ürün", "TY Fiyat", "Minimum Fiyat", "Net Kâr", "Net Marj %"],
      ...risky.rows.map(r => [
        r.barcode,
        r.product_name,
        parseNumber(r.my_price),
        parseNumber(r.min_price),
        parseNumber(r.calculated_net_profit),
        parseNumber(r.calculated_net_margin)
      ])
    ];

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Dashboard!A:Z"
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Dashboard!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });

    res.json({
      status: "ok",
      message: "Dashboard updated with enhanced KPIs"
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.get("/debug-commissions-sheet", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "KomisyonKurallari!A1:D10"
    });

    res.json({
      status: "ok",
      values: result.data.values || []
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.listen(PORT, () => {
  console.log(`Aşlamacı Repricer running on port ${PORT}`);
});
