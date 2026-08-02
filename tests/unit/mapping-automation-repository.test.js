const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MappingAutomationRepository,
} = require("../../src/repositories/mapping-automation.repository");

function suggestion(overrides = {}) {
  return {
    marketplace: "HEPSIBURADA",
    barcode: "HB-SKU-1",
    confidence: 0.91,
    base_confidence: 0.9,
    learning_adjustment: 0.01,
    confidence_band: "HIGH",
    learning_key: "learn-1",
    algorithm_version: "test",
    source_type: "SUPPLIER_POOL",
    source_barcode: "TY-SOURCE",
    file_market_item_id: 7,
    supplier_code: "FILE_MARKET",
    update_file_price: true,
    evidence: { reason: "test" },
    product_snapshot: { barcode: "HB-SKU-1" },
    fingerprint: "fingerprint-1",
    items: [
      {
        cost_item_code: "COST_1",
        file_market_item_id: 7,
        supplier_code: "FILE_MARKET",
        quantity: 1,
        current_unit_cost: 10,
        suggested_unit_cost: 12,
        unit_desi: 1,
        selected_price_tier: null,
      },
    ],
    ...overrides,
  };
}

test("mapping önerileri aynı pazaryeri ve barkod için tekilleştirilir", async () => {
  const inserts = [];
  const client = {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT barcode FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT barcode,fingerprint FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("UPDATE mapping_suggestions SET status='STALE'"))
        return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO mapping_suggestions(")) {
        inserts.push(params);
        return { rows: [{ id: inserts.length, barcode: params[1] }] };
      }
      if (sql.includes("INSERT INTO mapping_suggestion_items"))
        return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  };
  const repository = new MappingAutomationRepository({}, async (callback) =>
    callback(client),
  );

  const result = await repository.saveSuggestions(
    [
      suggestion(),
      suggestion({ fingerprint: "fingerprint-2", confidence: 0.85 }),
    ],
    ["HB-SKU-1"],
    "HEPSIBURADA",
  );

  assert.equal(result.created, 1);
  assert.equal(result.skippedDuplicates, 1);
  assert.equal(inserts.length, 1);
});

test("mapping önerisi açık kayıt varsa unique çakışmasına düşmeden atlanır", async () => {
  const inserts = [];
  const client = {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT barcode FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT barcode,fingerprint FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("UPDATE mapping_suggestions SET status='STALE'"))
        return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT id,status,fingerprint FROM mapping_suggestions"))
        return { rows: [{ id: 42, status: "APPROVED", barcode: params[1] }] };
      if (sql.includes("INSERT INTO mapping_suggestions(")) {
        inserts.push(params);
        return { rows: [{ id: inserts.length, barcode: params[1] }] };
      }
      return { rows: [] };
    },
  };
  const repository = new MappingAutomationRepository({}, async (callback) =>
    callback(client),
  );

  const result = await repository.saveSuggestions(
    [suggestion()],
    ["HB-SKU-1"],
    "HEPSIBURADA",
  );

  assert.equal(result.created, 0);
  assert.equal(result.skippedOpen, 1);
  assert.equal(inserts.length, 0);
});

test("ayni PENDING fingerprint korunur ve yeniden olusturulmaz", async () => {
  const mutations = [];
  const client = {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT barcode FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT barcode,fingerprint FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT id,status,fingerprint FROM mapping_suggestions"))
        return {
          rows: [
            {
              id: 42,
              status: "PENDING",
              fingerprint: "fingerprint-1",
              barcode: params[1],
            },
          ],
        };
      if (/UPDATE|INSERT INTO mapping_suggestions/.test(sql))
        mutations.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new MappingAutomationRepository({}, async (callback) =>
    callback(client),
  );

  const result = await repository.saveSuggestions(
    [suggestion()],
    ["HB-SKU-1"],
    "HEPSIBURADA",
  );

  assert.equal(result.created, 0);
  assert.equal(result.skippedSamePending, 1);
  assert.deepEqual(mutations, []);
});

test("farkli PENDING yalniz acik force regeneration ile degistirilir", async () => {
  const mutations = [];
  const client = {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT barcode FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT barcode,fingerprint FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT id,status,fingerprint FROM mapping_suggestions"))
        return {
          rows: [
            { id: "9007199254740993", status: "PENDING", fingerprint: "old" },
          ],
        };
      if (sql.includes("UPDATE mapping_suggestions")) {
        mutations.push(["stale", params[0]]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO mapping_suggestions(")) {
        mutations.push(["insert", params[1]]);
        return { rows: [{ id: "9007199254740994", barcode: params[1] }] };
      }
      if (sql.includes("INSERT INTO mapping_suggestion_items"))
        return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  };
  const repository = new MappingAutomationRepository({}, async (callback) =>
    callback(client),
  );

  const withoutForce = await repository.saveSuggestions(
    [suggestion()],
    ["HB-SKU-1"],
    "HEPSIBURADA",
  );
  assert.equal(withoutForce.created, 0);
  assert.equal(withoutForce.skippedOpen, 1);
  assert.deepEqual(mutations, []);

  const withForce = await repository.saveSuggestions(
    [suggestion()],
    ["HB-SKU-1"],
    "HEPSIBURADA",
    { forceRegeneration: true },
  );
  assert.equal(withForce.created, 1);
  assert.deepEqual(mutations, [
    ["stale", "9007199254740993"],
    ["insert", "HB-SKU-1"],
  ]);
});

test("mapping önerisi insert sırasında unique çakışırsa üretim patlamadan atlanır", async () => {
  const inserts = [];
  const client = {
    query: async (sql, params = []) => {
      if (sql.includes("SELECT barcode FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("SELECT barcode,fingerprint FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("UPDATE mapping_suggestions SET status='STALE'"))
        return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT id,status,fingerprint FROM mapping_suggestions"))
        return { rows: [] };
      if (sql.includes("INSERT INTO mapping_suggestions(")) {
        inserts.push(params);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO mapping_suggestion_items"))
        throw new Error("items should not be inserted without parent");
      return { rows: [] };
    },
  };
  const repository = new MappingAutomationRepository({}, async (callback) =>
    callback(client),
  );

  const result = await repository.saveSuggestions(
    [suggestion()],
    ["HB-SKU-1"],
    "HEPSIBURADA",
  );

  assert.equal(result.created, 0);
  assert.equal(result.skippedConflicts, 1);
  assert.equal(inserts.length, 1);
});
