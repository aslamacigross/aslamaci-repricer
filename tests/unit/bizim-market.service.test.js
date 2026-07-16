const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BizimMarketService,
  decodeHtml,
  parseNextUrl,
  parseProductRows,
} = require("../../src/services/bizim-market.service");

const productHtml = `
  <link rel="next" href="/temel-gida?pagenumber=2">
  <!-- Product Box -->
  <div class="product-box-container" data-productid="13856" data-stock="12">
    <a href="/ulker-gofret" class="product-item"
      data-enhanced-productclick='{"item_id":"13856","item_name":"&#220;lker Gofret 36 g 36&apos;lı","item_brand":"&#220;LKER","item_category":"Temel Gıda","item_category2":"Atıştırmalık","item_category3":"Gofret","price":"475.21"}'>
      <img data-src="/gofret.jpg">
    </a>
    <span>6 adet ve üzeri birim fiyat 450,00 TL</span>
  </div>`;

test("Bizim Toptan HTML karakterlerini ve ürün kartını ayrıştırır", () => {
  assert.equal(decodeHtml("&#220;lker"), "Ülker");
  const [row] = parseProductRows(productHtml);
  assert.equal(row.product_name, "Ülker Gofret 36 g 36'lı");
  assert.equal(row.brand, "ÜLKER");
  assert.equal(row.current_price, 475.21);
  assert.equal(row.estimated_unit_desi, 1.296);
  assert.equal(row.desi_confidence, "HIGH");
  assert.equal(row.raw_data.stock, 12);
  assert.deepEqual(row.price_tiers, [
    { min_quantity: 6, unit_price: 450, label: "6+ adet" },
  ]);
});

test("Bizim Toptan sonraki sayfa adresini bulur", () => {
  assert.equal(
    parseNextUrl(productHtml),
    "https://www.bizimtoptan.com.tr/temel-gida?pagenumber=2",
  );
});

test("canlı tarama tekrar eden ürünleri tekilleştirir", async () => {
  const pages = new Map([
    ["https://example.test/temel", productHtml],
    [
      "https://example.test/temel-gida?pagenumber=2",
      productHtml.replace(/<link[^>]+>/, ""),
    ],
  ]);
  const service = new BizimMarketService({
    baseUrl: "https://example.test",
    categoryPaths: ["/temel", "/dondurma"],
    fetchImpl: async (url) => ({
      ok: true,
      text: async () => pages.get(url) || "",
    }),
  });
  const result = await service.livePriceRows();
  assert.equal(service.categoryPaths.length, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.stats.duplicates, 1);
});

test("canlı tarama dondurulmuş kategori satırlarını dışlar", async () => {
  const frozenHtml = productHtml
    .replace(/<link[^>]+>/, "")
    .replace(/Temel Gıda/g, "Dondurulmuş Gıda");
  const service = new BizimMarketService({
    baseUrl: "https://example.test",
    categoryPaths: ["/temel"],
    fetchImpl: async () => ({ ok: true, text: async () => frozenHtml }),
  });
  const result = await service.livePriceRows();
  assert.equal(result.rows.length, 0);
  assert.equal(result.stats.productsSkippedFrozen, 1);
});
