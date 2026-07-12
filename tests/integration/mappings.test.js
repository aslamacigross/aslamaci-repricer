const test = require("node:test");
const assert = require("node:assert/strict");
const { CostRepository } = require("../../src/repositories/cost.repository");
function queryResult(sql, rows) {
  if (sql.includes("SELECT item_code"))
    return { rows: rows.map((x) => ({ item_code: x.cost_item_code })) };
  if (sql.includes("SELECT barcode"))
    return { rows: rows.map((x) => ({ barcode: x.barcode })) };
  if (sql.includes("RETURNING id"))
    return { rows: rows.map((_, i) => ({ id: i + 1 })), rowCount: rows.length };
  return { rows: [], rowCount: 0 };
}
test("mapping replace once validate edip transaction icinde atomic degistirir", async () => {
  const rows = [
    { barcode: "1", cost_item_code: "A", quantity: 1 },
    { barcode: "2", cost_item_code: "B", quantity: 2 },
  ];
  const calls = [];
  const db = { query: async (sql) => queryResult(sql, rows) };
  let transactions = 0;
  const transaction = async (work) => {
    transactions++;
    const client = {
      query: async (sql) => {
        calls.push(sql);
        return queryResult(sql, rows);
      },
    };
    return work(client);
  };
  const repo = new CostRepository(db, transaction);
  const result = await repo.replaceMappings(rows);
  assert.equal(result.replaced, 2);
  assert.equal(transactions, 1);
  assert.ok(
    calls.findIndex((x) => x.includes("CREATE TEMP TABLE")) <
      calls.findIndex((x) => x.includes("DELETE FROM product_cost_mappings")),
  );
  assert.ok(calls.some((x) => x.includes("INSERT INTO product_cost_mappings")));
});
test("orphan cost code varsa mapping replace transactiona girmez", async () => {
  const rows = [{ barcode: "1", cost_item_code: "UNKNOWN", quantity: 1 }];
  const db = {
    query: async (sql) =>
      sql.includes("SELECT barcode")
        ? { rows: [{ barcode: "1" }] }
        : { rows: [] },
  };
  let transactions = 0;
  const repo = new CostRepository(db, async () => {
    transactions++;
  });
  await assert.rejects(
    repo.replaceMappings(rows),
    (error) => error.code === "MAPPING_VALIDATION_FAILED",
  );
  assert.equal(transactions, 0);
});
test("panel toplu mapping islemi yalnizca gonderilen barkodlari yeniler", async () => {
  const rows = [
    { barcode: "1", cost_item_code: "A", quantity: 1 },
    { barcode: "1", cost_item_code: "B", quantity: 2 },
    { barcode: "2", cost_item_code: "A", quantity: 3 },
  ];
  const calls = [];
  const db = { query: async (sql) => queryResult(sql, rows) };
  const repo = new CostRepository(db, async (work) =>
    work({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    }),
  );
  const result = await repo.replaceMappingsForBarcodes(rows);
  assert.equal(result.replacedBarcodes, 2);
  assert.equal(result.insertedMappings, 3);
  const deletion = calls.find((call) => call.sql.includes("DELETE FROM"));
  assert.deepEqual(deletion.params[0], ["1", "2"]);
  assert.match(deletion.sql, /barcode=ANY/);
});
