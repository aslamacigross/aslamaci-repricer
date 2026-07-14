const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeText,
  extractPackCount,
  extractSizes,
  compareProducts,
  scaleRecipe,
  confidenceBand,
} = require("../../src/domain/product-matching");

test("Türkçe ürün adını karşılaştırma için normalize eder", () => {
  assert.equal(
    normalizeText("Çiçek Rüyası Yumuşatıcı"),
    "cicek ruyasi yumusatici",
  );
});

test("paket adedini farklı Trendyol başlık biçimlerinden çıkarır", () => {
  assert.equal(extractPackCount("Yumuşatıcı 1500 ml X 4 Adet"), 4);
  assert.equal(extractPackCount("Çay 4 Paket x 20 Süzen Poşet"), 4);
  assert.equal(extractPackCount("Meyve Suyu 20 x 200 ml"), 20);
  assert.equal(extractPackCount("Sıvı Sabun 3’lü"), 3);
});

test("ml litre gram ve kilogramı ortak temel birime çevirir", () => {
  assert.deepEqual(extractSizes("Deterjan 1.5 L"), [
    { value: 1500, unit: "ml" },
  ]);
  assert.deepEqual(extractSizes("Çay 1 kg"), [{ value: 1000, unit: "g" }]);
});

test("aynı fiziksel ürünün farklı paket adetlerini yüksek güvenle eşleştirir", () => {
  const result = compareProducts(
    {
      product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 4 Adet",
      brand: "Actisoft",
      category_id: "2354",
    },
    {
      product_name: "Menekşe Konsantre Yumuşatıcı 1500 ml X 2 Adet",
      brand: "Actisoft",
      category_id: "2354",
    },
  );
  assert.ok(result.score >= 0.95);
  assert.equal(result.targetPackCount, 4);
  assert.equal(result.candidatePackCount, 2);
});

test("manuel reçeteyi hedef pakete göre ölçekler", () => {
  const rows = scaleRecipe(
    { product_name: "Yumuşatıcı 1500 ml X 2 Adet" },
    { product_name: "Yumuşatıcı 1500 ml X 4 Adet" },
    [{ cost_item_code: "YUMUSATICI", quantity: 2 }],
  );
  assert.equal(rows[0].quantity, 4);
});

test("güven skoru kullanıcı kontrol bantlarına ayrılır", () => {
  assert.equal(confidenceBand(0.95), "HIGH");
  assert.equal(confidenceBand(0.8), "REVIEW");
  assert.equal(confidenceBand(0.4), "LOW");
});

test("File kısaltmaları ve Dubai çikolatası adını ortak ürün diline çevirir", () => {
  const dubai = compareProducts(
    {
      product_name: "Harras Çikolata HARRAS_DUBAI_CIKOLATASI_200GR",
      brand: "Harras",
    },
    {
      product_name: "Harras Antep F.&Kadayıf Dolg.Çik. 200 g",
      brand: "Harras",
    },
  );
  const perfume = compareProducts(
    { product_name: "Daycare Parfüm Gold", brand: "Daycare" },
    {
      product_name: "Daycare Gold Erkek Edp 100 ml",
      brand: "Daycare",
    },
  );
  assert.ok(dubai.score >= 0.9);
  assert.ok(perfume.score >= 0.7);
});
