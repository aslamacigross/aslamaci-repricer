const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { migrate } = require("../../src/db/migrate");
const { CostRepository } = require("../../src/repositories/cost.repository");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");
const {
  MappingAutomationService,
} = require("../../src/services/mapping-automation.service");

test("File fiyatından üretilen öneri onay ve önizleme sonrası atomik uygulanır", async () => {
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
  memory.public.registerFunction({
    name: "btrim",
    args: ["text"],
    returns: "text",
    implementation: (value) => String(value || "").trim(),
  });
  memory.public.registerFunction({
    name: "nullif",
    args: ["text", "text"],
    returns: "text",
    implementation: (left, right) => (left === right ? null : left),
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_id,is_active,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES
      ('TRENDYOL','SOURCE','Menekşe Konsantre Yumuşatıcı 1500 ml X 2 Adet',
       'Actisoft','2354',TRUE,'COMPLETE',10,600,17),
      ('TRENDYOL','TARGET','Menekşe Konsantre Yumuşatıcı 1500 ml X 4 Adet',
       'Actisoft','2354',TRUE,'MAPPING_MISSING',10,900,17)`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('YUMUSATICI_ACTISOFT_1500ML','Actisoft Menekşe Yumuşatıcı 1500 ml',110,1.5)`,
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
      marketplace,barcode,cost_item_code,quantity
    )VALUES('TRENDYOL','SOURCE','YUMUSATICI_ACTISOFT_1500ML',2)`,
  );

  const repository = new MappingAutomationRepository(db, withTransaction);
  const costs = new CostRepository(db, withTransaction);
  let recalculated = false;
  const costEngine = {
    recalculate: async (barcode, queryable) => {
      recalculated = true;
      await queryable.query(
        `UPDATE products SET needs_cost_mapping=FALSE,data_status='COMPLETE'
         WHERE barcode='TARGET'`,
      );
      return { processed: 1 };
    },
  };
  const service = new MappingAutomationService({
    repository,
    costs,
    costEngine,
  });
  assert.deepEqual(
    service.normalizeFileRows([
      {
        product_name: "Actisoft Menekşe Bahçesi Konsantre 1500 ml",
        current_price: 112,
        price_tiers: [{ min_quantity: 4, unit_price: 108 }],
        brand: "Actisoft",
      },
    ])[0].price_tiers,
    [],
  );
  await service.importSupplierItems("BIZIM_MARKET", [
    {
      product_name: "Actisoft Menekşe Bahçesi Konsantre 1500 ml",
      current_price: 112,
      price_tiers: [{ min_quantity: 4, unit_price: 108 }],
      brand: "Actisoft",
    },
  ]);
  const generated = await service.generate({ limit: 20 });
  assert.equal(generated.created, 1);
  const rawSuggestionItems = await db.query(
    "SELECT * FROM mapping_suggestion_items",
  );
  assert.equal(rawSuggestionItems.rowCount, 1);
  const pending = await service.listSuggestions({ status: "PENDING" });
  assert.equal(pending.total, 1);
  assert.equal(Number(pending.items[0].items[0].quantity), 4);

  const approved = await service.approve(pending.items[0].id, "admin", {
    update_file_price: true,
  });
  assert.equal(approved.status, "APPROVED");
  const feedback = await service.listLearningFeedback({});
  assert.equal(feedback.total, 1);
  assert.equal(feedback.items[0].decision, "APPROVED");
  assert.equal(feedback.items[0].actor, "admin");
  assert.equal(Number(feedback.items[0].accepted_count), 1);
  assert.equal(Number(feedback.items[0].rejected_count), 0);
  const preview = await service.bulkPreview([approved.id]);
  assert.equal(preview.productCount, 1);
  assert.equal(preview.priceUpdateCount, 1);
  await db.query(
    "UPDATE products SET data_status='COST_ITEM_INCOMPLETE' WHERE barcode='TARGET'",
  );
  const applied = await service.bulkApply(
    [approved.id],
    preview.token,
    "admin",
  );
  assert.equal(applied.applied, 1);
  assert.equal(recalculated, true);

  const mapping = await db.query(
    `SELECT cost_item_code,quantity,effective_unit_cost,supplier_price_tier
     FROM product_cost_mappings
     WHERE barcode='TARGET'`,
  );
  assert.equal(mapping.rows[0].cost_item_code, "YUMUSATICI_ACTISOFT_1500ML");
  assert.equal(Number(mapping.rows[0].quantity), 4);
  assert.equal(Number(mapping.rows[0].effective_unit_cost), 108);
  assert.equal(Number(mapping.rows[0].supplier_price_tier.unit_price), 108);
  const cost = await db.query(
    `SELECT unit_cost,previous_unit_cost,price_source FROM cost_items
     WHERE item_code='YUMUSATICI_ACTISOFT_1500ML'`,
  );
  assert.equal(Number(cost.rows[0].unit_cost), 112);
  assert.equal(Number(cost.rows[0].previous_unit_cost), 110);
  assert.equal(cost.rows[0].price_source, "BIZIM_MARKET");
  const status = await db.query(
    "SELECT status FROM mapping_suggestions WHERE id=$1",
    [approved.id],
  );
  assert.equal(status.rows[0].status, "APPLIED");
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_id,is_active,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES(
      'TRENDYOL','TARGET_REJECT','Menekşe Konsantre Yumuşatıcı 1500 ml X 6 Adet',
      'Actisoft','2354',TRUE,'MAPPING_MISSING',10,1200,17
    )`,
  );
  await service.generate({ limit: 20 });
  const nextPending = await service.listSuggestions({ status: "PENDING" });
  assert.equal(nextPending.total, 1);
  const learnedProfile = await db.query(
    "SELECT learning_key FROM mapping_learning_profiles",
  );
  assert.equal(
    nextPending.items[0].learning_key,
    learnedProfile.rows[0].learning_key,
  );
  assert.equal(nextPending.items[0].evidence.learning.accepted, 1);
  assert.ok(Number(nextPending.items[0].learning_adjustment) > 0);
  const rejected = await service.reject(nextPending.items[0].id, "admin", {
    reason: "Varyant yanlış",
  });
  assert.equal(rejected.status, "REJECTED");
  const feedbackAfterReject = await service.listLearningFeedback({});
  assert.equal(feedbackAfterReject.total, 2);
  assert.equal(feedbackAfterReject.items[0].decision, "REJECTED");
  assert.equal(feedbackAfterReject.items[0].reason, "Varyant yanlış");
  assert.equal(Number(feedbackAfterReject.items[0].accepted_count), 1);
  assert.equal(Number(feedbackAfterReject.items[0].rejected_count), 1);
  const repeated = await service.generate({ limit: 20 });
  assert.equal(repeated.created, 1);
  const pendingAfterReject = await service.listSuggestions({
    status: "PENDING",
  });
  assert.equal(pendingAfterReject.total, 1);
  assert.equal(
    pendingAfterReject.items[0].source_type,
    "FILE_DIRECT_COST_ITEM",
  );
  const directApproved = await service.approve(
    pendingAfterReject.items[0].id,
    "admin",
    { update_file_price: true },
  );
  await db.query(
    "UPDATE mapping_suggestion_items SET unit_desi=NULL WHERE suggestion_id=$1",
    [directApproved.id],
  );
  const directPreview = await service.bulkPreview([directApproved.id]);
  await service.bulkApply([directApproved.id], directPreview.token, "admin");
  const directCostItem = await db.query(
    "SELECT unit_cost,unit_desi,price_source FROM cost_items WHERE item_code=$1",
    [pendingAfterReject.items[0].items[0].cost_item_code],
  );
  assert.equal(directCostItem.rowCount, 1);
  assert.equal(Number(directCostItem.rows[0].unit_cost), 112);
  assert.equal(Number(directCostItem.rows[0].unit_desi), 1.5);
  assert.equal(directCostItem.rows[0].price_source, "BIZIM_MARKET");
  await db.end();
});

test("Hepsiburada onayli mapping apply marketplace scoped kalir ve Trendyol urune sizmaz", async () => {
  const memory = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: true,
  });
  memory.public.registerFunction({
    name: "hashtext",
    args: ["text"],
    returns: "integer",
    implementation: (value) => String(value || "").length,
  });
  const adapter = memory.adapters.createPg();
  const db = new adapter.Pool();
  await migrate("up", db, { compatibility: "pg-mem" });
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,is_active,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES
      ('HEPSIBURADA','SAME-CODE','Actisoft Çamaşır Suyu 1000 ml',
       'Actisoft',TRUE,'MAPPING_MISSING',10,120,17),
      ('TRENDYOL','SAME-CODE','Trendyol Aynı Kod Ürünü',
       'Actisoft',TRUE,'MAPPING_MISSING',10,120,17)`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi)
     VALUES('ACTISOFT_CAMASIR_SUYU_1000ML','Actisoft Çamaşır Suyu 1000 ml',55,1)`,
  );
  const suggestion = (
    await db.query(
      `INSERT INTO mapping_suggestions(
        marketplace,barcode,status,confidence,base_confidence,confidence_band,
        learning_key,algorithm_version,source_type,evidence,product_snapshot,
        fingerprint,reviewed_by,reviewed_at
      )VALUES(
        'HEPSIBURADA','SAME-CODE','APPROVED',0.92,0.92,'HIGH',
        'HEPSIBURADA:actisoft-camasir-suyu','test','FILE_DIRECT_COST_ITEM',
        '{}'::jsonb,'{}'::jsonb,'hb-same-code','admin',NOW()
      ) RETURNING id`,
    )
  ).rows[0];
  await db.query(
    `INSERT INTO mapping_suggestion_items(
      suggestion_id,cost_item_code,quantity,current_unit_cost,
      suggested_unit_cost,unit_desi
    )VALUES($1,'ACTISOFT_CAMASIR_SUYU_1000ML',1,55,55,1)`,
    [suggestion.id],
  );

  const recalculated = [];
  const service = new MappingAutomationService({
    repository: new MappingAutomationRepository(db, withTransaction),
    costs: new CostRepository(db, withTransaction),
    costEngine: {
      recalculate: async (barcode, queryable, marketplace) => {
        recalculated.push([barcode, marketplace]);
        await queryable.query(
          `UPDATE products SET needs_cost_mapping=FALSE,data_status='COMPLETE'
           WHERE marketplace=$1 AND barcode='SAME-CODE'`,
          [marketplace],
        );
        return { processed: 1 };
      },
    },
  });

  const preview = await service.bulkPreview([suggestion.id]);
  const applied = await service.bulkApply([suggestion.id], preview.token, "admin");

  assert.equal(applied.applied, 1);
  assert.deepEqual(recalculated, [[undefined, "HEPSIBURADA"]]);
  const mappings = await db.query(
    `SELECT marketplace,barcode,cost_item_code,quantity
     FROM product_cost_mappings
     WHERE barcode='SAME-CODE'
     ORDER BY marketplace`,
  );
  assert.deepEqual(
    mappings.rows.map((row) => [
      row.marketplace,
      row.barcode,
      row.cost_item_code,
      Number(row.quantity),
    ]),
    [["HEPSIBURADA", "SAME-CODE", "ACTISOFT_CAMASIR_SUYU_1000ML", 1]],
  );
  const ty = (
    await db.query(
      `SELECT data_status,needs_cost_mapping
       FROM products WHERE marketplace='TRENDYOL' AND barcode='SAME-CODE'`,
    )
  ).rows[0];
  assert.equal(ty.data_status, "MAPPING_MISSING");
  assert.equal(ty.needs_cost_mapping, true);

  await db.end();
});

test("Bizim çoklu alım fiyatı sonradan eklenince uygulanmış mapping maliyetini marketplace bazinda günceller", async () => {
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
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_id,is_active,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES(
      'TRENDYOL','HSTOBA6202101','Teno Ekonomik Peçete 100lü X 32 Adet',
      'Teno','123',TRUE,'COMPLETE',10,999,17
    ),(
      'HEPSIBURADA','HB-TENO-PECETE','Teno Ekonomik Peçete 100lü X 32 Adet',
      'Teno','123',TRUE,'COMPLETE',10,999,17
    )`,
  );
  await db.query(
    `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,price_source)
     VALUES('BIZIM_TENO_PECETE_100LU','Teno Ekonomik Peçete 100lü',249,1,'BIZIM_MARKET')`,
  );
  const item = (
    await db.query(
      `INSERT INTO file_market_items(
        source_key,product_name,normalized_name,brand,current_price,
        supplier_code,price_tiers
      )VALUES(
        'bizim:teno-pecete-100','Teno Ekonomik Peçete 100lü',
        'teno ekonomik pecete 100lu','Teno',249,'BIZIM_MARKET','[]'::jsonb
      ) RETURNING id`,
    )
  ).rows[0];
  await db.query(
    `INSERT INTO cost_item_file_links(
      cost_item_code,file_market_item_id,confidence,status,approved_by,approved_at
    )VALUES('BIZIM_TENO_PECETE_100LU',$1,0.95,'APPROVED','admin',NOW())`,
    [item.id],
  );
  await db.query(
    `INSERT INTO product_cost_mappings(
      marketplace,barcode,cost_item_code,quantity
    )VALUES
      ('TRENDYOL','HSTOBA6202101','BIZIM_TENO_PECETE_100LU',6),
      ('HEPSIBURADA','HB-TENO-PECETE','BIZIM_TENO_PECETE_100LU',6)`,
  );

  const repository = new MappingAutomationRepository(db, withTransaction);
  const recalculated = [];
  const service = new MappingAutomationService({
    repository,
    costs: new CostRepository(db, withTransaction),
    costEngine: {
      recalculate: async (barcode, queryable, marketplace) => {
        recalculated.push([barcode, marketplace]);
        return { processed: 1 };
      },
    },
  });

  const updated = await service.updateSupplierItemPricing(
    "BIZIM_MARKET",
    item.id,
    {
      current_price: 249,
      price_tiers: [{ min_quantity: 6, unit_price: 230 }],
    },
  );

  assert.deepEqual(updated.recalculated_barcodes.sort(), [
    "HB-TENO-PECETE",
    "HSTOBA6202101",
  ]);
  assert.deepEqual(
    recalculated.sort((left, right) => left[0].localeCompare(right[0])),
    [
      ["HB-TENO-PECETE", "HEPSIBURADA"],
      ["HSTOBA6202101", "TRENDYOL"],
    ],
  );
  const cost = await db.query(
    `SELECT unit_cost,previous_unit_cost,price_source FROM cost_items
     WHERE item_code='BIZIM_TENO_PECETE_100LU'`,
  );
  assert.equal(Number(cost.rows[0].unit_cost), 249);
  assert.equal(cost.rows[0].price_source, "BIZIM_MARKET");
  const mapping = await db.query(
    `SELECT effective_unit_cost,supplier_price_tier
     FROM product_cost_mappings
     WHERE cost_item_code='BIZIM_TENO_PECETE_100LU'
     ORDER BY marketplace`,
  );
  assert.equal(mapping.rowCount, 2);
  assert.deepEqual(
    mapping.rows.map((row) => Number(row.effective_unit_cost)),
    [230, 230],
  );
  assert.deepEqual(
    mapping.rows.map((row) => Number(row.supplier_price_tier.unit_price)),
    [230, 230],
  );
  assert.equal(Number(updated.tier_price_updates[0].quantity), 6);
  assert.equal(Number(updated.tier_price_updates[0].min_quantity), 6);

  await db.end();
});

test("Bizim import PDP provenance olmadan legacy tier silmez, verified sonuçla replace eder", async () => {
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
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  await db.query(
    `INSERT INTO file_market_items(
      source_key,product_name,normalized_name,brand,current_price,
      supplier_code,availability,price_tiers,raw_data
    )VALUES(
      'bizim-web:tier-safe','Bizim Tier Ürünü',
      'bizim tier urunu','Teno',44.90,'BIZIM_MARKET','AVAILABLE',
      '[{"min_quantity":16,"unit_price":82,"label":"16+ adet"}]'::jsonb,
      '{
        "provider":"bizim-toptan-web",
        "catalog_marker":"old",
        "price_tiers":[{"min_quantity":16,"unit_price":82,"label":"16+ adet"}],
        "price_tiers_source":"BIZIM_PRODUCT_DETAIL",
        "price_tiers_verified":true,
        "price_tiers_verified_at":"2026-08-09T00:00:00.000Z",
        "product_detail_url":"https://example.test/old-detail",
        "product_detail_badges":["16 Adet üzeri 82 TL"],
        "package_prices":[{"package_quantity":16,"unit_price":82,"package_total_price":1312}]
      }'::jsonb
    )`,
  );

  const service = new MappingAutomationService({
    repository: new MappingAutomationRepository(db, withTransaction),
    costs: new CostRepository(db, withTransaction),
    costEngine: {
      recalculate: async () => ({ processed: 1 }),
    },
  });
  const row = (raw_data, price_tiers, current_price = 45.9) => ({
    source_key: "bizim-web:tier-safe",
    product_name: "Bizim Tier Ürünü",
    normalized_name: "bizim tier urunu",
    brand: "Teno",
    current_price,
    currency: "TRY",
    availability: "AVAILABLE",
    raw_data,
    observed_at: "2026-08-10T00:00:00.000Z",
    price_tiers,
  });

  await service.importSupplierItems("BIZIM_MARKET", [
    row(
      {
        provider: "bizim-toptan-web",
        catalog_marker: "new",
        category: "Temel Gıda",
        price_tiers: [],
      },
      [],
    ),
  ]);
  let stored = await db.query(
    "SELECT current_price,price_tiers,raw_data FROM file_market_items WHERE source_key='bizim-web:tier-safe'",
  );
  assert.equal(Number(stored.rows[0].current_price), 45.9);
  assert.equal(Number(stored.rows[0].price_tiers[0].unit_price), 82);
  assert.equal(stored.rows[0].raw_data.catalog_marker, "new");
  assert.equal(stored.rows[0].raw_data.category, "Temel Gıda");
  assert.equal(
    stored.rows[0].raw_data.price_tiers_source,
    "BIZIM_PRODUCT_DETAIL",
  );
  assert.equal(stored.rows[0].raw_data.price_tiers_verified, true);
  assert.equal(
    stored.rows[0].raw_data.price_tiers_verified_at,
    "2026-08-09T00:00:00.000Z",
  );
  assert.equal(
    stored.rows[0].raw_data.product_detail_url,
    "https://example.test/old-detail",
  );
  assert.deepEqual(stored.rows[0].raw_data.product_detail_badges, [
    "16 Adet üzeri 82 TL",
  ]);
  assert.equal(Number(stored.rows[0].raw_data.package_prices[0].unit_price), 82);

  await service.importSupplierItems("BIZIM_MARKET", [
    row(
      {
        provider: "bizim-toptan-web",
        catalog_marker: "failure-kept",
        category: "Temel Gıda",
      },
      [],
    ),
  ]);
  stored = await db.query(
    "SELECT price_tiers,raw_data FROM file_market_items WHERE source_key='bizim-web:tier-safe'",
  );
  assert.equal(Number(stored.rows[0].price_tiers[0].unit_price), 82);
  assert.equal(stored.rows[0].raw_data.catalog_marker, "failure-kept");
  assert.equal(
    stored.rows[0].raw_data.price_tiers_verified_at,
    "2026-08-09T00:00:00.000Z",
  );

  await service.importSupplierItems("BIZIM_MARKET", [
    row(
      {
        price_tiers_source: "BIZIM_PRODUCT_DETAIL",
        price_tiers_verified: true,
        price_tiers_verified_at: "2026-08-10T00:00:00.000Z",
        product_detail_url: "https://example.test/today-detail",
        product_detail_badges: ["16 Adet üzeri 79 TL"],
        package_prices: [
          { package_quantity: 16, unit_price: 79, package_total_price: 1264 },
        ],
      },
      [{ min_quantity: 16, unit_price: 79, label: "16+ adet" }],
    ),
  ]);
  stored = await db.query(
    "SELECT price_tiers,raw_data FROM file_market_items WHERE source_key='bizim-web:tier-safe'",
  );
  assert.equal(Number(stored.rows[0].price_tiers[0].unit_price), 79);
  assert.equal(
    stored.rows[0].raw_data.price_tiers_verified_at,
    "2026-08-10T00:00:00.000Z",
  );
  assert.equal(
    stored.rows[0].raw_data.product_detail_url,
    "https://example.test/today-detail",
  );
  assert.equal(Number(stored.rows[0].raw_data.package_prices[0].unit_price), 79);

  await service.importSupplierItems("BIZIM_MARKET", [
    row(
      {
        price_tiers_source: "BIZIM_PRODUCT_DETAIL",
        price_tiers_verified: true,
        price_tiers_verified_at: "2026-08-11T00:00:00.000Z",
        product_detail_url: "https://example.test/no-tier-detail",
        product_detail_badges: [],
        package_prices: [],
      },
      [],
    ),
  ]);
  stored = await db.query(
    "SELECT price_tiers,raw_data FROM file_market_items WHERE source_key='bizim-web:tier-safe'",
  );
  assert.deepEqual(stored.rows[0].price_tiers, []);
  assert.deepEqual(stored.rows[0].raw_data.product_detail_badges, []);
  assert.deepEqual(stored.rows[0].raw_data.package_prices, []);
  assert.equal(
    stored.rows[0].raw_data.price_tiers_verified_at,
    "2026-08-11T00:00:00.000Z",
  );

  await db.end();
});

test("stok durumu olmayan tedarikçi ürünü fiyatı varsa mapping aday havuzuna girer", async () => {
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
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  await db.query(
    `INSERT INTO file_market_items(
      source_key,product_name,normalized_name,brand,current_price,
      supplier_code,availability
    )VALUES(
      'bizim:ulker-kakao-1kg','Ülker Toz Kakao 1 kg',
      'ulker toz kakao 1 kg','Ülker',899,'BIZIM_MARKET','UNAVAILABLE'
    )`,
  );

  const repository = new MappingAutomationRepository(db, withTransaction);
  const items = await repository.fileItemsForMatching();

  assert.equal(items.length, 1);
  assert.equal(items[0].product_name, "Ülker Toz Kakao 1 kg");
  assert.equal(items[0].availability, "UNAVAILABLE");
  await db.end();
});

test("uygulanmamış onaylı öneri iptal edilip reddedilebilir", async () => {
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
  const withTransaction = async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  await db.query(
    `INSERT INTO products(
      marketplace,barcode,product_name,brand,category_id,is_active,data_status,
      stock_quantity,my_price,commission_rate
    )VALUES(
      'TRENDYOL','WRONG_APPROVED','Yanlış Onaylı Ürün',
      'Test','123',TRUE,'MAPPING_MISSING',10,100,17
    )`,
  );
  const inserted = (
    await db.query(
      `INSERT INTO mapping_suggestions(
        marketplace,barcode,status,confidence,base_confidence,confidence_band,
        algorithm_version,source_type,product_snapshot,evidence,fingerprint
      )VALUES(
        'TRENDYOL','WRONG_APPROVED','APPROVED',0.7,0.7,'REVIEW',
        'test','TEST','{}'::jsonb,'{}'::jsonb,'wrong-approved'
      ) RETURNING id`,
    )
  ).rows[0];

  const repository = new MappingAutomationRepository(db, withTransaction);
  const cancelled = await repository.cancelApproval(inserted.id, "admin", {
    reason: "Yanlışlıkla onaylandı",
  });

  assert.equal(cancelled.status, "REJECTED");
  assert.equal(cancelled.rejection_reason, "Yanlışlıkla onaylandı");
  await db.end();
});
