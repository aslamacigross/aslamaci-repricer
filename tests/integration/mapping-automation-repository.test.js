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
  await service.importFileItems([
    {
      product_name: "Actisoft Menekşe Bahçesi Konsantre 1500 ml",
      current_price: 112,
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
    `SELECT cost_item_code,quantity FROM product_cost_mappings
     WHERE barcode='TARGET'`,
  );
  assert.equal(mapping.rows[0].cost_item_code, "YUMUSATICI_ACTISOFT_1500ML");
  assert.equal(Number(mapping.rows[0].quantity), 4);
  const cost = await db.query(
    `SELECT unit_cost,previous_unit_cost,price_source FROM cost_items
     WHERE item_code='YUMUSATICI_ACTISOFT_1500ML'`,
  );
  assert.equal(Number(cost.rows[0].unit_cost), 112);
  assert.equal(Number(cost.rows[0].previous_unit_cost), 110);
  assert.equal(cost.rows[0].price_source, "FILE_MARKET");
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
  assert.equal(directCostItem.rows[0].price_source, "FILE_MARKET");
  await db.end();
});
