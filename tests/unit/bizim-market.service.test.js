const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BizimMarketService,
  decodeHtml,
  parseBizimPrice,
  parseNextUrl,
  parseProductDetailPriceTiers,
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

const detailHtml = `
  <h1 class="product-detail-name" data-stock-quantity="12"
    data-enhanced-productdetail='{"item_id":"13856","item_name":"&#220;lker Gofret","price":"475.21"}'>
    &#220;lker Gofret
  </h1>
  <span class="badge-other">6 Adet &#252;zeri 450,00 TL</span>
  <table class="table-responsive price-table productdetail-price-table mb-4">
    <tr>
      <td>Paket Fiyatı (6 <span>Adet</span>) :</td>
      <td class="detail-price"><span class="product-detail-price">2.700,00 TL</span></td>
    </tr>
    <tr><td></td><td colspan="2"><span class="product-detail-comment-line">Adet: 450,00 TL</span></td></tr>
  </table>`;

const noTierDetailHtml = `
  <h1 class="product-detail-name" data-enhanced-productdetail='{"item_id":"13856"}'>Ürün</h1>
  <table class="table-responsive price-table productdetail-price-table mb-4">
    <tr>
      <td>Adet Fiyatı :</td>
      <td class="detail-price"><span class="product-detail-price">475,21 TL</span></td>
    </tr>
  </table>`;

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
      text: async () =>
        String(url).includes("/ulker-gofret") ? detailHtml : pages.get(url) || "",
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
  assert.equal(result.stats.productsSkippedShippingExcluded, 1);
  assert.equal(result.stats.productDetailRequests, 0);
});

test("Bizim product detail fiyat kademelerini authoritative olarak ayrıştırır", () => {
  const parsed = parseProductDetailPriceTiers(detailHtml, 475.21);
  assert.deepEqual(parsed.price_tiers, [
    { min_quantity: 6, unit_price: 450, label: "6+ adet" },
  ]);
  assert.deepEqual(parsed.package_prices, [
    { package_quantity: 6, unit_price: 450, package_total_price: 2700 },
  ]);
});

test("Bizim product detail başarılı ama kademesiz sonucu boş authoritative tier döndürür", () => {
  const parsed = parseProductDetailPriceTiers(noTierDetailHtml, 475.21);
  assert.deepEqual(parsed.price_tiers, []);
  assert.equal(parsed.price_tiers_verified, true);
});

test("Bizim product detail birden fazla fiyat kademesini okur", () => {
  const parsed = parseProductDetailPriceTiers(
    `<h1 data-enhanced-productdetail='{}'>Ürün</h1>
     <span class="badge-other">4 Adet üzeri 95 TL</span>
     <span class="badge-other">6 Adet üzeri 90 TL</span>
     <span class="badge-other">16 Adet üzeri 82 TL</span>`,
    100,
  );
  assert.deepEqual(parsed.price_tiers, [
    { min_quantity: 4, unit_price: 95, label: "4+ adet" },
    { min_quantity: 6, unit_price: 90, label: "6+ adet" },
    { min_quantity: 16, unit_price: 82, label: "16+ adet" },
  ]);
});

test("Bizim product detail package total fiyatını unit price ile karıştırmaz", () => {
  const parsed = parseProductDetailPriceTiers(
    `<h1 data-enhanced-productdetail='{}'>Ürün</h1>
     <span class="badge-other">24 Adet üzeri 8,90 TL</span>
     <table class="productdetail-price-table">
       <tr><td>Paket Fiyatı (24 Adet) :</td><td><span class="product-detail-price">213,60 TL</span></td></tr>
       <tr><td></td><td><span class="product-detail-comment-line">Adet: 8,90 TL</span></td></tr>
     </table>`,
    9.9,
  );
  assert.equal(parsed.price_tiers[0].unit_price, 8.9);
  assert.equal(parsed.package_prices[0].package_total_price, 213.6);
});

test("Bizim Türk fiyat formatını ayrıştırır", () => {
  assert.equal(parseBizimPrice("1.099,90 TL"), 1099.9);
  assert.equal(parseBizimPrice("99,90"), 99.9);
  assert.equal(parseBizimPrice("8,90"), 8.9);
});

test("Bizim detail fetch failure empty tier sayılmaz ve snapshot partial olur", async () => {
  const service = new BizimMarketService({
    baseUrl: "https://example.test",
    categoryPaths: ["/temel"],
    retries: 0,
    fetchImpl: async (url) => {
      if (String(url).includes("/ulker-gofret"))
        return { ok: false, status: 500, statusText: "FAIL", text: async () => "" };
      return { ok: true, text: async () => productHtml.replace(/<link[^>]+>/, "") };
    },
  });
  const result = await service.livePriceRows();
  assert.equal(result.rows.length, 0);
  assert.equal(result.fullSnapshot, false);
  assert.equal(result.stats.productDetailsFailed, 1);
});

test("Bizim duplicate ürün için product detail tek kez fetch edilir", async () => {
  let detailCalls = 0;
  const service = new BizimMarketService({
    baseUrl: "https://example.test",
    categoryPaths: ["/temel"],
    fetchImpl: async (url) => {
      if (String(url).includes("/ulker-gofret")) {
        detailCalls++;
        return { ok: true, text: async () => detailHtml };
      }
      return {
        ok: true,
        text: async () => `${productHtml}${productHtml.replace(/<link[^>]+>/, "")}`,
      };
    },
  });
  const result = await service.livePriceRows();
  assert.equal(result.rows.length, 1);
  assert.equal(detailCalls, 1);
});
