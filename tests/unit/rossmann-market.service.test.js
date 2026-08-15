const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RossmannMarketService,
  parseRossmannPrice,
  effectivePrice,
  productRow,
} = require("../../src/services/rossmann-market.service");

function product(overrides = {}) {
  return {
    id: 219,
    sku: "SRTEST",
    barcode: "4305615000000",
    name: "Isana Test Ürünü 250 ml",
    brand: "Isana",
    price: 219,
    special_price: 219,
    crm_price: "149.000000",
    cmp_20_price: "0.000000",
    cmp_50_price: "0.000000",
    cmp_100_price: "0.000000",
    is_in_stock: 1,
    url_key: "isana-test-urunu-250-ml-p-srtest",
    image: "/x/y/test.jpeg",
    breadcrumb:
      '[{"link":"kisisel-bakim","name":"Kişisel Bakım"},{"link":"","name":"Isana Test Ürünü 250 ml"}]',
    ...overrides,
  };
}

function response(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "FAIL",
    json: async () => body,
  };
}

test("Rossmann Card fiyatı effective current_price olur", () => {
  const row = productRow(product({ price: 219, crm_price: "149.000000" }), {
    observedAt: "2026-08-15T10:00:00.000Z",
  });
  assert.equal(row.current_price, 149);
  assert.equal(row.raw_data.regular_price, 219);
  assert.equal(row.raw_data.rossmann_card_price, 149);
  assert.equal(row.raw_data.effective_price_type, "ROSSMANN_CARD");
});

test("Card fiyatı yoksa koşulsuz satış fiyatı kullanılır", () => {
  const selected = effectivePrice(
    product({ price: 219, special_price: 189, crm_price: "0.000000" }),
  );
  assert.deepEqual(selected, { price: 189, type: "SALE" });
});

test("koşullu alışveriş promosyonu Card fiyatı sanılmaz", () => {
  const row = productRow(
    product({
      price: 395,
      special_price: 395,
      crm_price: "0.000000",
      cmp_20_price: "199.000000",
    }),
    { observedAt: "2026-08-15T10:00:00.000Z" },
  );
  assert.equal(row.current_price, 395);
  assert.equal(row.raw_data.promotion_price, 199);
  assert.equal(row.raw_data.promotion_label, "20 TL üzeri alışverişe");
  assert.equal(row.raw_data.effective_price_type, "REGULAR");
});

test("Card fiyatı koşullu promodan önceliklidir", () => {
  const row = productRow(
    product({
      price: 299,
      special_price: 299,
      crm_price: "249.000000",
      cmp_50_price: "199.000000",
    }),
    { observedAt: "2026-08-15T10:00:00.000Z" },
  );
  assert.equal(row.current_price, 249);
  assert.equal(row.raw_data.promotion_price, 199);
  assert.equal(row.raw_data.effective_price_type, "ROSSMANN_CARD");
});

test("Türkçe fiyat formatları decimal parse edilir", () => {
  assert.equal(parseRossmannPrice("1.699,00 TL"), 1699);
  assert.equal(parseRossmannPrice("99,00 TL"), 99);
});

test("Rossmann ürün alanları kaynak satırına normalize edilir", () => {
  const row = productRow(product(), {
    observedAt: "2026-08-15T10:00:00.000Z",
  });
  assert.equal(row.source_key, "rossmann-api:219");
  assert.equal(row.product_name, "Isana Test Ürünü 250 ml");
  assert.equal(row.brand, "Isana");
  assert.equal(
    row.source_url,
    "https://www.rossmann.com.tr/isana-test-urunu-250-ml-p-srtest",
  );
  assert.equal(row.availability, "AVAILABLE");
});

test("partial crawl fullSnapshot=true üretmez", async () => {
  const service = new RossmannMarketService({
    baseUrl: "https://rossmann.test",
    pageSize: 2,
    fetchImpl: async (url) => {
      if (String(url).includes("from=2")) return response({}, false);
      return response({
        product: {
          hits: {
            total: { value: 3 },
            hits: [
              { _source: product({ id: 1, sku: "A" }) },
              { _source: product({ id: 2, sku: "B" }) },
            ],
          },
        },
      });
    },
  });
  const result = await service.livePriceRows();
  assert.equal(result.rows.length, 2);
  assert.equal(result.fullSnapshot, false);
  assert.equal(result.stats.failedPages.length, 1);
});

test("complete crawl tüm pagination bitince fullSnapshot=true üretir", async () => {
  const pages = [
    [product({ id: 1, sku: "A" }), product({ id: 2, sku: "B" })],
    [product({ id: 3, sku: "C", crm_price: "0.000000" })],
  ];
  const service = new RossmannMarketService({
    baseUrl: "https://rossmann.test",
    pageSize: 2,
    fetchImpl: async (url) => {
      const from = Number(new URL(url).searchParams.get("from") || 0);
      return response({
        product: {
          hits: {
            total: { value: 3 },
            hits: pages[from / 2].map((item) => ({ _source: item })),
          },
        },
      });
    },
  });
  const result = await service.livePriceRows();
  assert.equal(result.rows.length, 3);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.cardPriceProducts, 2);
  assert.equal(result.stats.nonCardPriceProducts, 1);
});
