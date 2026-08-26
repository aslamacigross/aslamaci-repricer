const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../../src/db/migrate");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");
const { createPglitePool } = require("../helpers/pglite-pool");

test("Hepsiburada kimlik teshisi dogrulanmis GTIN ile belirsiz eski alanlari ayirir", async () => {
  const db = await createPglitePool();
  try {
    await migrate("up", db);
    await db.query(
      `INSERT INTO products(
         marketplace,barcode,marketplace_product_id,marketplace_catalog_barcode,
         catalog_gtin,catalog_gtin_source,product_name,brand,is_active
       ) VALUES
         ('TRENDYOL','4006381333931',NULL,NULL,NULL,NULL,
          'Harras Tereyagli Kurabiye 180 g','Harras',TRUE),
         ('HEPSIBURADA','HB-MERCHANT-1','HBV-1','HB-MERCHANT-1',
          '4006381333931','HEPSIBURADA_CATALOG_API:ean',
          'Harras Tereyagli Kurabiye 180 g','Harras',TRUE),
         ('HEPSIBURADA','HB-MERCHANT-2','HBV-2','AMBIGUOUS-BARCODE',
          NULL,NULL,'Actisoft Sivi Deterjan 1500 ml','Actisoft',TRUE)`,
    );

    const repository = new MappingAutomationRepository(db);
    const diagnostics = await repository.hepsiburadaIdentifierDiagnostics(5);

    assert.deepEqual(diagnostics.summary, {
      active_targets: 2,
      verified_gtins: 1,
      identity_only: 1,
      catalog_equals_merchant_sku: 1,
      ambiguous_catalog_values: 1,
      verified_trendyol_matches: 1,
    });
    assert.equal(diagnostics.verifiedPairs.length, 1);
    assert.equal(diagnostics.ambiguousSamples.length, 1);
    assert.equal(diagnostics.merchantSkuSamples.length, 1);
    assert.equal(diagnostics.identityOnlySamples.length, 1);
  } finally {
    await db.end();
  }
});
