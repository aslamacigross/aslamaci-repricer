const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BimMarketService,
  attributesObject,
  productRow,
} = require("../../src/services/bim-market.service");

function graphqlResponse(categoryId) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      data: {
        categoryProductList: {
          categoryProducts: [
            {
              id: `${categoryId}-sub`,
              name: "Çikolata",
              items: [
                {
                  productID: "217921110",
                  name: "Ülker Sütlü Kare Çikolata 60 g",
                  price: 45,
                  originalPrice: 69,
                  isAvailable: true,
                  stockAmount: 0,
                  attributes: [
                    { key: "sku", value: "8690504013256" },
                    { key: "baseContentValue", value: "60" },
                    { key: "baseUnit", value: "g" },
                  ],
                  urls: ["https://image.test/ulker.jpg"],
                },
              ],
            },
          ],
        },
      },
    }),
  };
}

test("BİM ürün alanlarını fiyat havuzu satırına dönüştürür", () => {
  assert.deepEqual(
    attributesObject([
      { key: "sku", value: "8690504013256" },
      { key: "baseUnit", value: "g" },
    ]),
    { sku: "8690504013256", baseUnit: "g" },
  );
  const row = productRow(
    {
      productID: "217921110",
      name: "Ülker Sütlü Kare Çikolata 60 g",
      price: 45,
      originalPrice: 69,
      isAvailable: true,
      attributes: [{ key: "sku", value: "8690504013256" }],
      urls: ["https://image.test/ulker.jpg"],
    },
    {
      category: { id: "snack", name: "Atıştırmalık" },
      group: { id: "chocolate", name: "Çikolata" },
      observedAt: "2026-07-20T19:00:00.000Z",
    },
  );
  assert.equal(row.source_key, "bim-yemeksepeti:217921110");
  assert.equal(row.product_name, "Ülker Sütlü Kare Çikolata 60 g");
  assert.equal(row.current_price, 45);
  assert.equal(row.brand, "Ülker");
  assert.equal(row.availability, "AVAILABLE");
  assert.equal(row.estimated_unit_desi, 0.06);
  assert.equal(row.desi_confidence, "HIGH");
  assert.equal(row.raw_data.original_price, 69);
  assert.equal(row.raw_data.attributes.sku, "8690504013256");
});

test("BİM canlı katalog kategori sonuçlarını tekilleştirir", async () => {
  const calls = [];
  const service = new BimMarketService({
    apiUrl: "https://api.test/graphql",
    categories: [
      { id: "snack", name: "Atıştırmalık" },
      { id: "food", name: "Temel Gıda" },
    ],
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, variables: body.variables });
      return graphqlResponse(body.variables.categoryId);
    },
  });

  const result = await service.livePriceRows();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.test/graphql");
  assert.equal(calls[0].options.headers.cookie, undefined);
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(calls[0].variables.vendorID, "fu9o");
  assert.equal(result.rows.length, 1);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.categoriesScanned, 2);
  assert.equal(result.stats.productsScanned, 2);
  assert.equal(result.stats.duplicates, 1);
});

test("BİM kargoya uygun olmayan kategorilere GraphQL request atmaz", async () => {
  const calls = [];
  const service = new BimMarketService({
    apiUrl: "https://api.test/graphql",
    categories: [
      { id: "fruit", name: "Meyve & Sebze" },
      { id: "meat", name: "Et, Tavuk & Şarküteri" },
      { id: "icecream", name: "Dondurma" },
      { id: "bakery", name: "Fırından" },
      { id: "food", name: "Temel Gıda" },
      { id: "home", name: "Ev Bakım" },
    ],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.variables.categoryId);
      return graphqlResponse(body.variables.categoryId);
    },
  });

  const result = await service.livePriceRows();

  assert.deepEqual(calls.sort(), ["food", "home"]);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.stats.categoriesRequested, 2);
  assert.equal(result.stats.categoriesSkipped, 4);
  assert.deepEqual(result.stats.excludedCategories, [
    "Meyve & Sebze",
    "Et, Tavuk & Şarküteri",
    "Dondurma",
    "Fırından",
  ]);
});

test("BİM canlı katalog tek kategori hatasında çalışan kategorileri korur", async () => {
  const service = new BimMarketService({
    apiUrl: "https://api.test/graphql",
    categories: [
      { id: "snack", name: "Atıştırmalık" },
      { id: "broken", name: "Geçici Bozuk Kategori" },
    ],
    retries: 0,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.variables.categoryId === "broken")
        return {
          ok: true,
          json: async () => ({ data: {} }),
        };
      return graphqlResponse(body.variables.categoryId);
    },
  });

  const result = await service.livePriceRows();

  assert.equal(result.rows.length, 1);
  assert.equal(result.fullSnapshot, false);
  assert.equal(result.stats.categoriesRequested, 2);
  assert.equal(result.stats.categoriesScanned, 1);
  assert.equal(result.stats.categoriesFailed, 1);
  assert.equal(
    result.stats.failedCategories[0].category,
    "Geçici Bozuk Kategori",
  );
});

test("BİM excluded kategori failures listesine girmez", async () => {
  const service = new BimMarketService({
    apiUrl: "https://api.test/graphql",
    categories: [
      { id: "icecream", name: "Dondurma" },
      { id: "food", name: "Temel Gıda" },
    ],
    retries: 0,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.variables.categoryId, "food");
      return graphqlResponse("food");
    },
  });

  const result = await service.livePriceRows();

  assert.equal(result.fullSnapshot, true);
  assert.deepEqual(result.stats.failedCategories, []);
});

test("BİM canlı katalog eksik ürün cevabında mevcut havuzu değiştirmeden hata verir", async () => {
  const service = new BimMarketService({
    categories: [{ id: "broken", name: "Bozuk" }],
    retries: 0,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: {} }),
    }),
  });

  await assert.rejects(
    service.livePriceRows(),
    /BİM katalog API ürün listesi geçersiz/,
  );
});
