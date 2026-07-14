const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");

test("mapping geri bildirimi JSONB alanlarını gerçek PostgreSQL uyumlu gönderir", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [{ id: 1 }] };
    },
  };
  const repository = new MappingAutomationRepository(null, null);
  const items = [
    {
      cost_item_code: "DAYCARE_DUS_JELI_750ML",
      file_market_item_id: 42,
      quantity: 2,
      suggested_unit_cost: 154,
    },
  ];

  await repository.recordFeedback(
    client,
    {
      id: 104,
      marketplace: "TRENDYOL",
      barcode: "TYBV9OL6JHWP3NPW75",
      learning_key: "daycare|dus-jeli|direct",
      base_confidence: 0.9745,
      confidence: 0.9745,
      confidence_band: "HIGH",
      learning_adjustment: 0,
      source_type: "MANUAL_HISTORY_AND_FILE",
      product_snapshot: { brand: "Daycare", category_id: "123" },
      evidence: { reasons: ["NAME_MATCH", "SIZE_MATCH"] },
      items,
    },
    "APPROVED",
    "admin",
    { items },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].params[11]), items);
  assert.deepEqual(JSON.parse(calls[0].params[12]), {
    reasons: ["NAME_MATCH", "SIZE_MATCH"],
  });
  assert.deepEqual(JSON.parse(calls[1].params[3]), {
    barcode: "TYBV9OL6JHWP3NPW75",
    brand: "Daycare",
    categoryId: "123",
    sourceType: "MANUAL_HISTORY_AND_FILE",
    costItemCodes: ["DAYCARE_DUS_JELI_750ML"],
  });
});
