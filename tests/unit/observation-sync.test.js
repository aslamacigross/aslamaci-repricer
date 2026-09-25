const test = require("node:test");
const assert = require("node:assert/strict");
const { SyncService } = require("../../src/services/sync.service");
const {
  emptyCounters,
} = require("../../src/services/observation-persistence.service");

test("Trendyol Buybox sync karar girdilerini değiştirmeden batch persistence'a taşır", async () => {
  const updates = [];
  const persisted = [];
  const db = {
    async query(sql, params = []) {
      if (String(sql).includes("FROM products WHERE marketplace='TRENDYOL'"))
        return {
          rows: [
            {
              barcode: "TY-1",
              my_price: 60,
              product_name: "Test ürün",
              min_price: 45,
              calculated_net_profit: 10,
            },
          ],
        };
      updates.push({ sql, params });
      return { rows: [] };
    },
  };
  const sync = new SyncService({
    db,
    audit: { integration: async () => {} },
    hepsiburada: {},
    trendyol: {
      buybox: async () => ({
        buyboxInfo: [
          {
            barcode: "TY-1",
            buyboxPrice: 50,
            secondBuyboxPrice: 55,
            thirdBuyboxPrice: 58,
            buyboxOrder: 2,
            hasMultipleSeller: true,
          },
        ],
      }),
    },
    observations: {
      async persist(marketplace, snapshots) {
        persisted.push({ marketplace, snapshots });
        const counters = emptyCounters();
        counters.buybox_history.written_change = snapshots.length;
        counters.repricer_observations.written_change = snapshots.length;
        counters.competitor_price_observations.written_change = 3;
        return counters;
      },
    },
  });

  const result = await sync.buybox(["TY-1"]);

  assert.equal(result.successful, 1);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].marketplace, "TRENDYOL");
  assert.deepEqual(persisted[0].snapshots[0].repricer, {
    observed_price: 60,
    buybox_price: 50,
    second_price: 55,
    third_price: 58,
    rank: 2,
    has_multiple_seller: true,
  });
  assert.deepEqual(persisted[0].snapshots[0].competitors, [
    { rank: 1, price: 50 },
    { rank: 2, price: 55 },
    { rank: 3, price: 58 },
  ]);
  assert.equal(
    updates.some((entry) => String(entry.sql).includes("UPDATE products SET")),
    true,
  );
});

test("history persistence hatası ana sync tarafından sessizce yutulmaz", async () => {
  const sync = new SyncService({
    db: {
      async query(sql) {
        if (String(sql).includes("FROM products WHERE marketplace='TRENDYOL'"))
          return {
            rows: [
              {
                barcode: "TY-1",
                my_price: 60,
                product_name: "Test ürün",
                min_price: 45,
                calculated_net_profit: 10,
              },
            ],
          };
        return { rows: [] };
      },
    },
    audit: { integration: async () => {} },
    hepsiburada: {},
    trendyol: {
      buybox: async () => ({
        buyboxInfo: [{ barcode: "TY-1", buyboxPrice: 50 }],
      }),
    },
    observations: {
      persist: async () => {
        throw new Error("history write failed");
      },
    },
  });

  const result = await sync.buybox(["TY-1"]);

  assert.equal(result.failed, 1);
  assert.deepEqual(result.failedBarcodes, ["TY-1"]);
});
