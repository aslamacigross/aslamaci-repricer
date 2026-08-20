const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { SyncService } = require("../../src/services/sync.service");

function fakeDb(products, calls = []) {
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (String(sql).includes("FROM products p")) return { rows: products };
      return { rows: [] };
    },
  };
}

function syncWith({ products, getBuyboxOrders, fetchPublicBuybox }) {
  const calls = [];
  return {
    calls,
    sync: new SyncService({
      db: fakeDb(products, calls),
      trendyol: {},
      hepsiburada: { getBuyboxOrders, fetchPublicBuybox },
      audit: { integration: async (entry) => calls.push({ audit: entry }) },
    }),
  };
}

describe("Hepsiburada official buybox sync", () => {
  test("HTTP 403 eski buybox timestampini yenilemez", async () => {
    const { sync, calls } = syncWith({
      products: [
        {
          barcode: "SKU1",
          hb_sku: "HBV1",
          merchant_sku: "SKU1",
          my_price: 100,
          min_price: 80,
        },
      ],
      getBuyboxOrders: async () => {
        const error = new Error("Forbidden");
        error.status = 403;
        throw error;
      },
    });
    const result = await sync.hepsiburadaBuybox(["SKU1"], {
      limit: 1,
      batchSize: 1,
    });
    assert.equal(result.failed, 1);
    assert.equal(result.metadata.http403, 1);
    assert.equal(
      calls.some((call) =>
        String(call.sql || "").includes("buybox_updated_at=$7"),
      ),
      false,
    );
    assert.equal(
      calls.some((call) =>
        String(call.sql || "").includes("buybox_error_code=$2"),
      ),
      true,
    );
  });

  test("official 401/403/429 gorunce kalan batchleri dovmeden durur", async () => {
    let fetchCount = 0;
    const { sync } = syncWith({
      products: [
        {
          barcode: "SKU1",
          hb_sku: "HBV1",
          merchant_sku: "SKU1",
          my_price: 100,
        },
        {
          barcode: "SKU2",
          hb_sku: "HBV2",
          merchant_sku: "SKU2",
          my_price: 120,
        },
      ],
      getBuyboxOrders: async () => {
        fetchCount++;
        const error = new Error("Too many requests");
        error.status = 429;
        throw error;
      },
    });
    const result = await sync.hepsiburadaBuybox(null, {
      limit: 2,
      batchSize: 1,
      requestDelayMs: 0,
    });
    assert.equal(fetchCount, 1);
    assert.equal(result.metadata.failFast, true);
    assert.equal(result.metadata.http429, 1);
    assert.equal(result.metadata.requests, 1);
  });

  test("basarili official veri buybox alanlarini yazar", async () => {
    const { sync, calls } = syncWith({
      products: [
        {
          barcode: "SKU1",
          hb_sku: "HBV1",
          merchant_sku: "SKU1",
          product_name: "HB Ürün",
          my_price: 100,
          min_price: 80,
          calculated_net_profit: 20,
        },
      ],
      getBuyboxOrders: async ({ skuList }) => ({
        variants: [
          {
            sku: skuList[0],
            buyboxOrders: [
              { rank: 1, merchantName: "AŞLAMACI GROSS", price: 95 },
              { rank: 2, merchantName: "Rakip", price: 99 },
            ],
          },
        ],
      }),
    });
    const result = await sync.hepsiburadaBuybox(["SKU1"], {
      limit: 1,
      batchSize: 1,
    });
    assert.equal(result.successful, 1);
    const update = calls.find((call) =>
      String(call.sql || "").includes("buybox_seller=$8"),
    );
    assert.ok(update);
    assert.equal(update.params[0], 95);
    assert.equal(update.params[3], 1);
    assert.equal(update.params[7], "AŞLAMACI GROSS");
    assert.equal(update.params[11], "HEPSIBURADA_OFFICIAL_API");
  });

  test("variants bos donerse eski timestamp yenilenmez", async () => {
    const { sync, calls } = syncWith({
      products: [
        {
          barcode: "SKU1",
          hb_sku: "HBV1",
          merchant_sku: "SKU1",
          my_price: 100,
        },
      ],
      getBuyboxOrders: async () => ({ variants: [] }),
    });
    const result = await sync.hepsiburadaBuybox(["SKU1"], {
      limit: 1,
      batchSize: 1,
    });
    assert.equal(result.failed, 1);
    assert.equal(result.metadata.emptyVariants, 1);
    assert.equal(
      calls.some((call) =>
        String(call.sql || "").includes("buybox_updated_at=$7"),
      ),
      false,
    );
    assert.equal(calls.find((call) => call.params?.[1] === "BUYBOX_NOT_RETURNED")?.params[1], "BUYBOX_NOT_RETURNED");
  });

  test("official veri public collector tarafindan overwrite edilmez", async () => {
    let publicCalled = false;
    const { sync, calls } = syncWith({
      products: [
        {
          barcode: "SKU1",
          hb_sku: "HBV1",
          merchant_sku: "SKU1",
          my_price: 100,
        },
      ],
      getBuyboxOrders: async () => ({
        variants: [
          {
            sku: "HBV1",
            buyboxOrders: [
              { rank: 1, merchantName: "Rakip", price: 90 },
              { rank: 2, merchantName: "AŞLAMACI GROSS", price: 100 },
              { rank: 3, merchantName: "Ucuncu", price: 110 },
            ],
          },
        ],
      }),
      fetchPublicBuybox: async () => {
        publicCalled = true;
        return {
          ok: true,
          buyboxPrice: 1,
          rank: 1,
          source: "PUBLIC",
        };
      },
    });
    const result = await sync.hepsiburadaBuybox(["SKU1"], {
      limit: 1,
      batchSize: 1,
    });
    assert.equal(publicCalled, false);
    assert.equal(result.successful, 1);
    const update = calls.find((call) =>
      String(call.sql || "").includes("buybox_seller=$8"),
    );
    assert.equal(update.params[0], 90);
    assert.equal(update.params[3], 2);
    assert.equal(update.params[7], "Rakip");
    assert.equal(update.params[9], "Ucuncu");
  });
});
