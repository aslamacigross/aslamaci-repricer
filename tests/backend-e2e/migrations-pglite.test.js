const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const { createPglitePool } = require("../helpers/pglite-pool");

test("PostgreSQL migrationlari up, idempotency, down ve yeniden up calisir", async () => {
  const db = await createPglitePool();
  try {
    await migrate("up", db);
    await migrate("up", db);

    const initial = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(initial.rowCount, 38);
    assert.equal(
      initial.rows.at(-1).version,
      "038_hepsiburada_seller_portal_metadata",
    );

    const columnsAfterUp = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN (
          'catalog_gtin',
          'catalog_gtin_source',
          'merchant_sku',
          'hb_sku',
          'listing_id'
        )
      ORDER BY column_name
    `);
    assert.deepEqual(
      columnsAfterUp.rows.map((row) => row.column_name),
      [
        "catalog_gtin",
        "catalog_gtin_source",
        "hb_sku",
        "listing_id",
        "merchant_sku",
      ],
    );

    const sellerPortalMetadataTablesAfterUp = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'hepsiburada_seller_portal_imports',
          'hepsiburada_seller_portal_metadata'
        )
      ORDER BY table_name
    `);
    assert.deepEqual(
      sellerPortalMetadataTablesAfterUp.rows.map((row) => row.table_name),
      [
        "hepsiburada_seller_portal_imports",
        "hepsiburada_seller_portal_metadata",
      ],
    );

    const buyboxCollectorJobAfterUp = await db.query(
      "SELECT enabled FROM jobs WHERE name='sync-hepsiburada-buybox'",
    );
    assert.equal(buyboxCollectorJobAfterUp.rowCount, 1);
    assert.equal(buyboxCollectorJobAfterUp.rows[0].enabled, false);

    await migrate("down", db);
    const afterSellerPortalMetadataDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterSellerPortalMetadataDown.rowCount, 37);
    assert.equal(
      afterSellerPortalMetadataDown.rows.at(-1).version,
      "037_hepsiburada_buybox_public_collectors",
    );
    const sellerPortalMetadataTablesAfterDown = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'hepsiburada_seller_portal_imports',
          'hepsiburada_seller_portal_metadata'
        )
    `);
    assert.equal(sellerPortalMetadataTablesAfterDown.rowCount, 0);

    await migrate("down", db);
    const afterBuyboxCollectorDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterBuyboxCollectorDown.rowCount, 36);
    assert.equal(
      afterBuyboxCollectorDown.rows.at(-1).version,
      "036_bizim_price_tier_job",
    );
    const buyboxCollectorJobAfterDown = await db.query(
      "SELECT name FROM jobs WHERE name='sync-hepsiburada-buybox'",
    );
    assert.equal(buyboxCollectorJobAfterDown.rowCount, 0);

    await migrate("down", db);
    const afterBizimTierDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterBizimTierDown.rowCount, 35);
    assert.equal(
      afterBizimTierDown.rows.at(-1).version,
      "035_rossmann_market_live_sync",
    );
    const bizimTierJobAfterDown = await db.query(
      "SELECT name FROM jobs WHERE name='sync-bizim-price-tiers'",
    );
    assert.equal(bizimTierJobAfterDown.rowCount, 0);

    await migrate("down", db);
    const afterRossmannDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRossmannDown.rowCount, 34);
    assert.equal(
      afterRossmannDown.rows.at(-1).version,
      "034_trendyol_august_2026_shipping_tariffs",
    );
    const rossmannJobAfterDown = await db.query(
      "SELECT name FROM jobs WHERE name='sync-rossmann-market-prices'",
    );
    assert.equal(rossmannJobAfterDown.rowCount, 0);

    await migrate("down", db);
    const afterDown = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterDown.rowCount, 33);
    assert.equal(
      afterDown.rows.at(-1).version,
      "033_hepsiburada_listing_identity",
    );

    const tariffRowsAfterDown = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shipping_costs WHERE marketplace='TRENDYOL') AS rates,
        (SELECT COUNT(*)::int FROM shipping_barems WHERE marketplace='TRENDYOL') AS barems
    `);
    assert.equal(Number(tariffRowsAfterDown.rows[0].rates), 0);
    assert.equal(Number(tariffRowsAfterDown.rows[0].barems), 0);

    await migrate("up", db);
    const afterRoundTrip = await db.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.equal(afterRoundTrip.rowCount, 38);
    assert.equal(
      afterRoundTrip.rows.at(-1).version,
      "038_hepsiburada_seller_portal_metadata",
    );
    const tariffRowsAfterRoundTrip = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shipping_costs WHERE marketplace='TRENDYOL') AS rates,
        (SELECT COUNT(*)::int FROM shipping_barems WHERE marketplace='TRENDYOL') AS barems
    `);
    assert.equal(Number(tariffRowsAfterRoundTrip.rows[0].rates), 0);
    assert.equal(Number(tariffRowsAfterRoundTrip.rows[0].barems), 0);
  } finally {
    await db.end();
  }
});

test("026 production-shaped state HB deploy migrations ile Trendyol datasini korur", async () => {
  const db = await createPglitePool();
  try {
    await migrate("up", db);
    while (
      (
        await db.query(
          "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
        )
      ).rows[0].version !== "026_ai_content_and_listing_health"
    ) {
      await migrate("down", db);
    }

    await db.query(
      `INSERT INTO shipping_costs(
         marketplace,desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate
       )VALUES('TRENDYOL',1,'TRENDYOL_SENTINEL_CARRIER',11.11,13.33,20)`,
    );
    await db.query(
      `INSERT INTO shipping_barems(
         marketplace,min_basket,max_basket,barem_name,carrier,
         cost_ex_vat,cost_inc_vat,vat_rate
       )VALUES('TRENDYOL',0,199.99,'PROD_SENTINEL','TRENDYOL_SENTINEL_CARRIER',22.22,26.66,20)`,
    );
    await db.query(
      `INSERT INTO packaging_rules(
         marketplace,min_desi,max_desi,packaging_cost,note
       )VALUES('TRENDYOL',0,5,3.25,'prod-packaging-sentinel')`,
    );
    await db.query(
      `INSERT INTO cost_items(
         item_code,item_name,unit_cost,unit_desi,price_source,source_checked_at
       )VALUES('MANUAL_SENTINEL','Manual Sentinel',77.77,0.5,'MANUAL','2026-01-01T00:00:00Z')`,
    );
    await db.query(
      `INSERT INTO products(
         marketplace,barcode,product_name,brand,category_name,commission_rate,
         my_price,stock_quantity,is_active,needs_cost_mapping,data_status,
         calculated_product_cost,min_price,auto_update
       )VALUES(
         'TRENDYOL','TY-SENTINEL','Trendyol Sentinel','Sentinel','Kategori',
         17,199,10,TRUE,FALSE,'COMPLETE',77.77,150,FALSE
       )`,
    );
    await db.query(
      `INSERT INTO product_cost_mappings(
         marketplace,barcode,cost_item_code,quantity,effective_unit_cost
       )VALUES('TRENDYOL','TY-SENTINEL','MANUAL_SENTINEL',1,77.77)`,
    );
    await db.query(
      `INSERT INTO jobs(name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone)
       VALUES
         ('sync-rossmann-market-prices','pre-existing disabled Rossmann job',1440,FALSE,'DAILY','00:00','Europe/Istanbul'),
         ('sync-bizim-price-tiers','pre-existing disabled Bizim tier job',1440,FALSE,'DAILY','01:30','Europe/Istanbul')
       ON CONFLICT(name) DO UPDATE SET enabled=FALSE`,
    );

    const snapshot = async () => ({
      shippingCosts: (
        await db.query(
          `SELECT marketplace,desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate
           FROM shipping_costs WHERE marketplace='TRENDYOL' ORDER BY carrier,desi_kg`,
        )
      ).rows,
      shippingBarems: (
        await db.query(
          `SELECT marketplace,min_basket,max_basket,barem_name,carrier,cost_ex_vat,cost_inc_vat,vat_rate
           FROM shipping_barems WHERE marketplace='TRENDYOL' ORDER BY carrier,min_basket`,
        )
      ).rows,
      packagingRules: (
        await db.query(
          `SELECT marketplace,min_desi,max_desi,packaging_cost,note
           FROM packaging_rules WHERE marketplace='TRENDYOL' ORDER BY note`,
        )
      ).rows,
      costItems: (
        await db.query(
          `SELECT item_code,item_name,unit_cost,unit_desi,price_source,source_checked_at
           FROM cost_items WHERE item_code='MANUAL_SENTINEL'`,
        )
      ).rows,
      products: (
        await db.query(
          `SELECT marketplace,barcode,product_name,brand,category_name,commission_rate,
                  my_price,stock_quantity,is_active,needs_cost_mapping,data_status,
                  calculated_product_cost,min_price,auto_update
           FROM products WHERE marketplace='TRENDYOL' AND barcode='TY-SENTINEL'`,
        )
      ).rows,
      mappings: (
        await db.query(
          `SELECT marketplace,barcode,cost_item_code,quantity,effective_unit_cost
           FROM product_cost_mappings
           WHERE marketplace='TRENDYOL' AND barcode='TY-SENTINEL'`,
        )
      ).rows,
    });
    const before = await snapshot();

    await migrate("up", db);

    assert.deepEqual(await snapshot(), before);

    const manualReviewState = (
      await db.query(
        `SELECT manual_review_last_confirmed_at,manual_review_next_due_at,
                manual_review_status
         FROM cost_items WHERE item_code='MANUAL_SENTINEL'`,
      )
    ).rows[0];
    assert.equal(manualReviewState.manual_review_last_confirmed_at, null);
    assert.equal(manualReviewState.manual_review_next_due_at, null);
    assert.equal(manualReviewState.manual_review_status, "OK");

    const supplierJobs = await db.query(
      `SELECT name,enabled FROM jobs
       WHERE name IN('sync-rossmann-market-prices','sync-bizim-price-tiers')
       ORDER BY name`,
    );
    assert.deepEqual(
      supplierJobs.rows.map((row) => [row.name, row.enabled]),
      [
        ["sync-bizim-price-tiers", false],
        ["sync-rossmann-market-prices", false],
      ],
    );

    const hbColumns = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='products'
         AND column_name IN(
           'merchant_sku','hb_sku','listing_id','catalog_gtin',
           'catalog_gtin_source','buybox_seller','second_seller',
           'third_seller','seller_count','buybox_source',
           'product_name_source','brand_source','category_name_source',
           'metadata_refreshed_at'
         )`,
    );
    assert.equal(hbColumns.rowCount, 14);
    const hbTables = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public'
         AND table_name IN(
           'hepsiburada_seller_portal_imports',
           'hepsiburada_seller_portal_metadata'
         )`,
    );
    assert.equal(hbTables.rowCount, 2);
    const hbJobs = await db.query(
      `SELECT name,enabled FROM jobs
       WHERE name IN(
         'sync-hepsiburada-products',
         'sync-hepsiburada-buybox',
         'generate-hepsiburada-repricer-actions'
       )
       ORDER BY name`,
    );
    assert.deepEqual(
      hbJobs.rows.map((row) => [row.name, row.enabled]),
      [
        ["generate-hepsiburada-repricer-actions", false],
        ["sync-hepsiburada-buybox", false],
        ["sync-hepsiburada-products", false],
      ],
    );
  } finally {
    await db.end();
  }
});
