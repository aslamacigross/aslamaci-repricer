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

test("maliyet kalemi tekrar raporu benzer kayıtları aday gösterir", async () => {
  const repository = new CostRepository(
    {
      query: async () => ({
        rows: [
          {
            id: 1,
            item_code: "HARRAS_CAY_1",
            item_name: "Harras Bergamot Aromalı Çay 500 g",
            unit_cost: 230,
            unit_desi: 1,
            product_count: 2,
          },
          {
            id: 2,
            item_code: "HARRAS_CAY_2",
            item_name: "Harras Bergamot Aromali Cay 500 gr",
            unit_cost: 230,
            unit_desi: 1,
            product_count: 0,
          },
          {
            id: 3,
            item_code: "BASKA_URUN",
            item_name: "Teno Ekonomik Peçete 100lü",
            unit_cost: 16.9,
            unit_desi: 1,
            product_count: 1,
          },
        ],
      }),
    },
    async () => {},
  );

  const result = await repository.duplicateCostItemCandidates();

  assert.equal(result.total, 1);
  assert.equal(result.items[0].left.item_code, "HARRAS_CAY_1");
  assert.equal(result.items[0].right.item_code, "HARRAS_CAY_2");
  assert.ok(result.items[0].reasons.includes("SAME_UNIT_COST"));
});
