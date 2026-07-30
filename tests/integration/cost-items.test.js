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

test("manuel maliyet kontrol listesi otomatik tedarikci linklerini haric tutar", async () => {
  const queries = [];
  const repository = new CostRepository(
    {
      query: async (sql, params) => {
        queries.push({ sql, params: [...params] });
        if (sql.includes("COUNT(*)::int")) return { rows: [{ count: 1 }] };
        return {
          rows: [
            {
              id: 10,
              item_code: "MANUEL_KALEM",
              item_name: "Manuel Kalem",
              unit_cost: 42,
              due: true,
            },
          ],
        };
      },
    },
    async () => {},
  );

  const result = await repository.manualCostReviewQueue({
    search: "manuel",
    page: 2,
    limit: 25,
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].item_code, "MANUEL_KALEM");
  assert.match(queries[0].sql, /NOT EXISTS/);
  assert.match(queries[0].sql, /FILE_MARKET','BIZIM_MARKET','BIM/);
  assert.deepEqual(queries[0].params, [30, "%manuel%"]);
  assert.deepEqual(queries[1].params, [30, "%manuel%", 25, 25]);
});

test("manuel maliyet ayni kalsin onayi sonraki kontrol tarihini ayarlar", async () => {
  const queries = [];
  const repository = new CostRepository(
    {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return {
          rows: [{ id: params[0], manual_review_status: "OK" }],
        };
      },
    },
    async () => {},
  );

  const result = await repository.confirmManualCostReview(7, {
    note: "Kontrol edildi",
    intervalDays: 45,
  });

  assert.equal(result.id, 7);
  assert.match(
    queries[0].sql,
    /manual_review_next_due_at=NOW\(\) \+ \(\$2::int/,
  );
  assert.deepEqual(queries[0].params, [7, 45, "Kontrol edildi"]);
});

test("manuel maliyet guncellemesi onceki fiyati ve kontrol tarihini kaydeder", async () => {
  const queries = [];
  const repository = new CostRepository(
    {
      query: async (sql, params) => {
        queries.push({ sql, params });
        return {
          rows: [{ id: params[0], unit_cost: params[1] }],
        };
      },
    },
    async () => {},
  );

  const result = await repository.updateManualCostReview(8, {
    unit_cost: 99.9,
    unit_desi: 1,
    note: "Yeni fiyat",
  });

  assert.equal(result.unit_cost, 99.9);
  assert.match(queries[0].sql, /previous_unit_cost=CASE/);
  assert.match(queries[0].sql, /source_checked_at=NOW\(\)/);
  assert.deepEqual(queries[0].params, [8, 99.9, 1, 30, "Yeni fiyat"]);
});
