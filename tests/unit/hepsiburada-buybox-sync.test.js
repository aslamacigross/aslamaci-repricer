const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { SyncService } = require("../../src/services/sync.service");

function fakeDb(products, calls = []) {
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const text = String(sql);
      if (text.includes("FROM products p")) {
        const sorted = [...products].sort((left, right) =>
          String(left.barcode).localeCompare(String(right.barcode)),
        );
        if (text.includes("p.barcode>$")) {
          const limit = Number(params.at(-1));
          const cursor = String(params.at(-2) || "");
          return {
            rows: sorted
              .filter((product) => String(product.barcode) > cursor)
              .slice(0, limit),
          };
        }
        const limit = Number(params.at(-1));
        return {
          rows: Number.isFinite(limit) ? products.slice(0, limit) : products,
        };
      }
      return { rows: [] };
    },
  };
}

function product(index, overrides = {}) {
  return {
    barcode: `SKU${String(index).padStart(4, "0")}`,
    hb_sku: `HBV${String(index).padStart(4, "0")}`,
    merchant_sku: `SKU${String(index).padStart(4, "0")}`,
    product_name: `HB Ürün ${index}`,
    my_price: 100 + index,
    min_price: 80,
    calculated_net_profit: 20,
    ...overrides,
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
    assert.equal(update.params.length, 12);
    assert.equal(update.params[0], 95);
    assert.equal(update.params[1], 99);
    assert.equal(update.params[2], null);
    assert.equal(update.params[3], 1);
    assert.equal(update.params[4], true);
    assert.equal(update.params[5], "SKU1");
    assert.equal(update.params[6] instanceof Date, true);
    assert.equal(update.params[7], "AŞLAMACI GROSS");
    assert.equal(update.params[8], "Rakip");
    assert.equal(update.params[9], null);
    assert.equal(update.params[10], 2);
    assert.equal(update.params[11], "HEPSIBURADA_OFFICIAL_API");
    assert.equal(update.params.includes(100), false);
    assert.match(String(update.sql), /buybox_price=\$1/);
    assert.match(String(update.sql), /second_price=\$2/);
    assert.match(String(update.sql), /third_price=\$3/);
    assert.match(String(update.sql), /rank=\$4/);
    assert.match(String(update.sql), /has_multiple_seller=\$5/);
    assert.match(String(update.sql), /buybox_updated_at=\$7/);
    assert.match(String(update.sql), /buybox_seller=\$8/);
    assert.match(String(update.sql), /second_seller=\$9/);
    assert.match(String(update.sql), /third_seller=\$10/);
    assert.match(String(update.sql), /seller_count=\$11/);
    assert.match(String(update.sql), /buybox_source=\$12/);
    assert.match(String(update.sql), /buybox_error_code=NULL/);
    assert.equal(String(update.sql).includes("my_price"), false);
    const observation = calls.find((call) =>
      String(call.sql || "").includes("INSERT INTO repricer_observations"),
    );
    assert.ok(observation);
    assert.equal(observation.params.length, 8);
    assert.equal(String(observation.sql).includes("$13"), false);
  });

  test("verified Hepsiburada seller alias ranks as own merchant", async () => {
    const { sync, calls } = syncWith({
      products: [
        {
          barcode: "SKU1",
          hb_sku: "HBV1",
          merchant_sku: "SKU1",
          product_name: "HB Ürün",
          my_price: 100,
          min_price: 80,
        },
      ],
      getBuyboxOrders: async ({ skuList }) => ({
        variants: [
          {
            sku: skuList[0],
            buyboxOrders: [
              { rank: 1, merchantName: "Aşlamacı Bakliyat", price: 95 },
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
    assert.equal(update.params[3], 1);
    assert.equal(update.params[7], "Aşlamacı Bakliyat");
  });

  test("unrelated and blank Hepsiburada seller names do not fabricate rank", async () => {
    const { sync, calls } = syncWith({
      products: [
        product(1, { barcode: "SKU1", hb_sku: "HBV1" }),
        product(2, { barcode: "SKU2", hb_sku: "HBV2" }),
      ],
      getBuyboxOrders: async ({ skuList }) => ({
        variants: skuList.map((sku) => ({
          sku,
          buyboxOrders: [
            {
              rank: 1,
              merchantName: sku === "HBV1" ? "Rakip Market" : "",
              price: 95,
            },
          ],
        })),
      }),
    });

    const result = await sync.hepsiburadaBuybox(["SKU1", "SKU2"], {
      limit: 2,
      batchSize: 2,
    });

    assert.equal(result.successful, 2);
    const updates = calls.filter((call) =>
      String(call.sql || "").includes("buybox_seller=$8"),
    );
    assert.equal(updates.length, 2);
    assert.equal(updates[0].params[3], null);
    assert.equal(updates[1].params[3], null);
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

  test("full sync 120 eski tavanina takilmadan 250+ urunu isler", async () => {
    const products = Array.from({ length: 253 }, (_, index) =>
      product(index + 1),
    );
    const requestSizes = [];
    const { sync } = syncWith({
      products,
      getBuyboxOrders: async ({ skuList }) => {
        requestSizes.push(skuList.length);
        return {
          variants: skuList.map((sku) => ({
            sku,
            buyboxOrders: [
              { rank: 1, merchantName: "AŞLAMACI GROSS", price: 95 },
            ],
          })),
        };
      },
    });
    const result = await sync.hepsiburadaBuybox(null, {
      batchSize: 10,
      pageSize: 100,
      requestDelayMs: 0,
    });
    assert.equal(result.metadata.totalProducts, 253);
    assert.equal(result.successful, 253);
    assert.equal(result.metadata.requests, 26);
    assert.ok(requestSizes.every((size) => size <= 10));
  });

  test("722 urunluk populasyonu sayfali olarak tamamen dolasir", async () => {
    const products = Array.from({ length: 722 }, (_, index) =>
      product(index + 1),
    );
    const { sync, calls } = syncWith({
      products,
      getBuyboxOrders: async ({ skuList }) => ({
        variants: skuList.map((sku) => ({
          sku,
          buyboxOrders: [
            { rank: 1, merchantName: "AŞLAMACI GROSS", price: 95 },
          ],
        })),
      }),
    });
    const result = await sync.hepsiburadaBuybox(null, {
      batchSize: 10,
      pageSize: 200,
      requestDelayMs: 0,
    });
    assert.equal(result.metadata.totalProducts, 722);
    assert.equal(result.metadata.totalSkus, 722);
    assert.equal(result.successful, 722);
    assert.equal(result.metadata.productPages, 4);
    assert.equal(
      calls.filter((call) => String(call.sql || "").includes("p.barcode>$"))
        .length,
      4,
    );
  });
});
