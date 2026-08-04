const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
test("migrationlar bos veritabaninda calisir ve tekrar calistirilabilir", async () => {
  const memory = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });
  memory.public.registerFunction({
    name: "hashtext",
    args: ["text"],
    returns: "integer",
    implementation: (value) => value.length,
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  await migrate("up", db, { compatibility: "pg-mem" });
  const tables = await db.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    tables.rows.map((x) => x.version),
    [
      "001_core_schema",
      "002_operations_and_learning",
      "003_learning_contracts_and_operations",
      "004_market_price_verification",
      "005_operational_controls",
      "006_special_commission_guard",
      "007_active_product_guard",
      "008_api_commission_source",
      "009_remove_google_sheets_dependency",
      "010_product_images",
      "011_file_market_mapping_automation",
      "012_mapping_feedback_learning",
      "013_file_market_live_sync",
      "014_supplier_price_pools",
      "015_supplier_bulk_price_tiers",
      "016_bim_market_live_sync",
      "017_operations_finance_and_safety",
      "018_hepsiburada_shipping_barems",
      "019_trendyol_finance_history",
      "020_trendyol_cargo_reconciliation",
      "021_product_desi_overrides",
      "022_marketplace_registry",
      "023_pim_and_listing_identity",
      "024_product_publishing_and_channel_transfer",
      "025_product_opportunity_engine",
      "026_ai_content_and_listing_health",
      "027_packaging_profiles",
      "028_hepsiburada_repricer_readiness",
      "029_manual_cost_review",
      "030_hepsiburada_commission_api",
      "031_hepsiburada_catalog_barcode",
      "032_hepsiburada_verified_gtin",
      "033_hepsiburada_listing_identifiers",
      "034_repricer_campaign_adjustments",
    ],
  );
  const safety = await db.query(
    "SELECT value FROM system_settings WHERE key='global_dry_run'",
  );
  assert.equal(safety.rows[0].value, true);
  const sheets = await db.query(
    "SELECT value FROM system_settings WHERE key='google_sheets_sync_enabled'",
  );
  assert.equal(sheets.rowCount, 0);
  const sheetJobs = await db.query(
    "SELECT name FROM jobs WHERE name IN('sheets-import','sheets-export')",
  );
  assert.equal(sheetJobs.rowCount, 0);
  const mappingJob = await db.query(
    "SELECT enabled,schedule_minutes FROM jobs WHERE name='generate-mapping-suggestions'",
  );
  assert.equal(mappingJob.rowCount, 1);
  assert.equal(mappingJob.rows[0].enabled, false);
  assert.equal(Number(mappingJob.rows[0].schedule_minutes), 1440);
  const fileMarketJob = await db.query(
    "SELECT enabled,schedule_minutes FROM jobs WHERE name='sync-file-market-prices'",
  );
  assert.equal(fileMarketJob.rowCount, 1);
  assert.equal(fileMarketJob.rows[0].enabled, true);
  assert.equal(Number(fileMarketJob.rows[0].schedule_minutes), 1440);
  const bizimMarketJob = await db.query(
    "SELECT enabled,schedule_minutes FROM jobs WHERE name='sync-bizim-market-prices'",
  );
  assert.equal(bizimMarketJob.rowCount, 1);
  assert.equal(bizimMarketJob.rows[0].enabled, true);
  assert.equal(Number(bizimMarketJob.rows[0].schedule_minutes), 1440);
  const bimMarketJob = await db.query(
    "SELECT enabled,schedule_minutes FROM jobs WHERE name='sync-bim-market-prices'",
  );
  assert.equal(bimMarketJob.rowCount, 1);
  assert.equal(bimMarketJob.rows[0].enabled, true);
  assert.equal(Number(bimMarketJob.rows[0].schedule_minutes), 1440);
  const hepsiburadaDefaults = await db.query(
    `SELECT key,value FROM system_settings
     WHERE key IN('default_carrier_hepsiburada','service_fee_hepsiburada')
     ORDER BY key`,
  );
  assert.deepEqual(
    hepsiburadaDefaults.rows.map((row) => [row.key, row.value]),
    [
      ["default_carrier_hepsiburada", "hepsiJET"],
      ["service_fee_hepsiburada", 10.5],
    ],
  );
  const hepsiburadaBarems = await db.query(
    "SELECT COUNT(*)::int count FROM shipping_barems WHERE marketplace='HEPSIBURADA'",
  );
  assert.equal(hepsiburadaBarems.rows[0].count, 14);
  const historyJob = await db.query(
    "SELECT enabled FROM jobs WHERE name='backfill-trendyol-finance-history'",
  );
  assert.equal(historyJob.rowCount, 1);
  assert.equal(historyJob.rows[0].enabled, false);
  const cargoJob = await db.query(
    "SELECT enabled FROM jobs WHERE name='sync-trendyol-cargo-invoices'",
  );
  assert.equal(cargoJob.rowCount, 1);
  assert.equal(cargoJob.rows[0].enabled, true);
  const cargoTable = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name='marketplace_cargo_charges'`,
  );
  assert.equal(cargoTable.rowCount, 1);
  const orderShippingColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='marketplace_orders'
       AND column_name IN('package_desi','shipping_source')`,
  );
  assert.equal(orderShippingColumns.rowCount, 2);
  const supplierTierColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name IN('file_market_items','mapping_suggestion_items')
       AND column_name IN('price_tiers','selected_price_tier')`,
  );
  assert.equal(supplierTierColumns.rowCount, 2);
  const mappingLearningTables = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN('mapping_feedback_events','mapping_learning_profiles')
     ORDER BY table_name`,
  );
  assert.deepEqual(
    mappingLearningTables.rows.map((row) => row.table_name),
    ["mapping_feedback_events", "mapping_learning_profiles"],
  );
  const contracts = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN('buybox_history','price_change_outcomes','repricer_results')
     ORDER BY table_name`,
  );
  assert.deepEqual(
    contracts.rows.map((row) => row.table_name),
    ["buybox_history", "price_change_outcomes", "repricer_results"],
  );
  const actionColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='repricer_actions'
       AND column_name IN('target_rank','reverts_action_id','reverted_by_action_id',
                          'market_price_before','market_price_checked_at',
                          'batch_checked_at','verification_error')`,
  );
  assert.equal(actionColumns.rowCount, 7);
  const productSettingColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='product_settings' AND column_name='max_single_change_pct'`,
  );
  assert.equal(productSettingColumns.rowCount, 1);
  const maintenance = await db.query(
    "SELECT value FROM system_settings WHERE key='maintenance_mode'",
  );
  assert.equal(maintenance.rows[0].value, false);
  const specialCommissionColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='products'
       AND column_name IN('trendyol_commission_rate','base_commission_rate',
                          'special_commission_active','special_commission_checked_at',
                          'special_commission_note')`,
  );
  assert.equal(specialCommissionColumns.rowCount, 5);
  const marketplaceRegistry = await db.query(
    `SELECT code,enabled,adapter_status,default_service_fee_minor
     FROM marketplace_registry ORDER BY sort_order`,
  );
  assert.deepEqual(
    marketplaceRegistry.rows.map((row) => row.code),
    ["TRENDYOL", "HEPSIBURADA", "PAZARAMA", "IDEFIX", "N11", "PTTAVM"],
  );
  assert.equal(marketplaceRegistry.rows[0].enabled, true);
  assert.equal(
    Number(marketplaceRegistry.rows[0].default_service_fee_minor),
    1319,
  );
  const publishingFlags = await db.query(
    `SELECT key,value FROM system_settings
     WHERE key IN(
       'product_publishing_enabled',
       'content_auto_update_enabled',
       'opportunity_auto_publish_enabled'
     )`,
  );
  assert.equal(publishingFlags.rowCount, 3);
  assert.equal(
    publishingFlags.rows.every((row) => row.value === false),
    true,
  );
  const pimTables = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN(
       'pim_physical_products','pim_recipes','pim_recipe_components',
       'marketplace_listings','marketplace_catalog_matches',
       'marketplace_listing_identifiers','listing_barcode_pools'
     ) ORDER BY table_name`,
  );
  assert.equal(pimTables.rowCount, 7);
  const pimJob = await db.query(
    "SELECT enabled FROM jobs WHERE name='bootstrap-pim'",
  );
  assert.equal(pimJob.rowCount, 1);
  assert.equal(pimJob.rows[0].enabled, false);
  const publicationTables = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN(
       'marketplace_categories','marketplace_category_attributes','marketplace_brands',
       'internal_category_mappings','attribute_mappings','brand_mappings',
       'product_publication_drafts','channel_transfer_batches','channel_transfer_items'
     )`,
  );
  assert.equal(publicationTables.rowCount, 9);
  const publicationJobs = await db.query(
    `SELECT name,enabled FROM jobs WHERE name IN(
       'marketplace-category-sync','marketplace-attribute-sync','marketplace-brand-sync',
       'catalog-matching','publish-batch-verification','listing-content-verification'
     )`,
  );
  assert.equal(publicationJobs.rowCount, 6);
  assert.equal(
    publicationJobs.rows.every((row) => row.enabled === false),
    true,
  );
  const opportunityTables = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN('product_opportunities','product_opportunity_events')`,
  );
  assert.equal(opportunityTables.rowCount, 2);
  const opportunityJob = await db.query(
    "SELECT enabled FROM jobs WHERE name='opportunity-generation'",
  );
  assert.equal(opportunityJob.rowCount, 1);
  assert.equal(opportunityJob.rows[0].enabled, false);
  const contentTables = await db.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
     WHERE table_name IN(
       'ai_content_drafts','listing_content_snapshots','listing_health_assessments'
     )`,
  );
  assert.equal(contentTables.rowCount, 3);
  const contentJobs = await db.query(
    `SELECT name,enabled FROM jobs
     WHERE name IN('listing-health-scan','content-quality-scan')`,
  );
  assert.equal(contentJobs.rowCount, 2);
  assert.equal(
    contentJobs.rows.every((row) => row.enabled === false),
    true,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO commission_rules(
        marketplace,category_id,commission_rate
      )VALUES('TRENDYOL','INVALID',100)`,
    ),
  );
  await migrate("down", db, { compatibility: "pg-mem" });
  const afterDown = await db.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    afterDown.rows.map((row) => row.version),
    [
      "001_core_schema",
      "002_operations_and_learning",
      "003_learning_contracts_and_operations",
      "004_market_price_verification",
      "005_operational_controls",
      "006_special_commission_guard",
      "007_active_product_guard",
      "008_api_commission_source",
      "009_remove_google_sheets_dependency",
      "010_product_images",
      "011_file_market_mapping_automation",
      "012_mapping_feedback_learning",
      "013_file_market_live_sync",
      "014_supplier_price_pools",
      "015_supplier_bulk_price_tiers",
      "016_bim_market_live_sync",
      "017_operations_finance_and_safety",
      "018_hepsiburada_shipping_barems",
      "019_trendyol_finance_history",
      "020_trendyol_cargo_reconciliation",
      "021_product_desi_overrides",
      "022_marketplace_registry",
      "023_pim_and_listing_identity",
      "024_product_publishing_and_channel_transfer",
      "025_product_opportunity_engine",
      "026_ai_content_and_listing_health",
      "027_packaging_profiles",
      "028_hepsiburada_repricer_readiness",
      "029_manual_cost_review",
      "030_hepsiburada_commission_api",
      "031_hepsiburada_catalog_barcode",
      "032_hepsiburada_verified_gtin",
      "033_hepsiburada_listing_identifiers",
    ],
  );
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  // 028-033 are now executed in pg-mem compatibility mode. Roll them back
  // before continuing the historical schema-down assertions below.
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  const removedSpecialColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='products'
       AND column_name IN('trendyol_commission_rate','base_commission_rate',
                          'special_commission_active','special_commission_checked_at',
                          'special_commission_note')`,
  );
  assert.equal(removedSpecialColumns.rowCount, 0);
  await migrate("down", db, { compatibility: "pg-mem" });
  const removedMaintenance = await db.query(
    "SELECT value FROM system_settings WHERE key='maintenance_mode'",
  );
  assert.equal(removedMaintenance.rowCount, 0);
  await migrate("down", db, { compatibility: "pg-mem" });
  await migrate("down", db, { compatibility: "pg-mem" });
  const removedColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE (table_name='repricer_actions' AND column_name='market_price_before')
        OR (table_name='product_settings' AND column_name='max_single_change_pct')`,
  );
  assert.equal(removedColumns.rowCount, 0);
  await db.end();
});
