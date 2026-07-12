const test = require("node:test");
const assert = require("node:assert/strict");
const { CostRepository } = require("../../src/repositories/cost.repository");

test("toplu maliyet kalemlerini tek transaction icinde upsert eder", async () => {
  const events = [];
  const client = {
    query: async (sql, params) => {
      events.push({ sql, params });
      return { rows: [{ id: events.length, item_code: params[0] }] };
    },
  };
  const repository = new CostRepository({}, async (work) => {
    events.push({ sql: "BEGIN" });
    const result = await work(client);
    events.push({ sql: "COMMIT" });
    return result;
  });

  const result = await repository.saveCostItems([
    {
      item_code: "A",
      item_name: "Kalem A",
      unit_cost: 10,
      unit_desi: 1,
      unit: "adet",
      note: "",
    },
    {
      item_code: "B",
      item_name: "Kalem B",
      unit_cost: 20,
      unit_desi: 2,
      unit: "adet",
      note: "",
    },
  ]);

  assert.equal(result.processed, 2);
  assert.equal(events[0].sql, "BEGIN");
  assert.equal(events.at(-1).sql, "COMMIT");
  assert.equal(
    events.filter((event) => event.sql.includes?.("INSERT INTO cost_items"))
      .length,
    2,
  );
});
