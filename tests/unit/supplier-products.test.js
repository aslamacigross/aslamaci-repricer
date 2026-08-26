const test = require("node:test");
const assert = require("node:assert/strict");
const {
  estimatePackageDesi,
  extractTotalPackageSize,
  normalizePriceTiers,
  parsePriceTiersFromText,
  priceTierForQuantity,
  roundProductDesi,
  supplier,
} = require("../../src/domain/supplier-products");

test("ROSSMANN geçerli canlı tedarikçi kodudur", () => {
  assert.deepEqual(supplier("ROSSMANN"), {
    code: "ROSSMANN",
    label: "Rossmann",
    shortLabel: "Rossmann",
    liveSync: true,
  });
});

test("tekli hafif üründe kesirli birim desiyi korur", () => {
  assert.deepEqual(estimatePackageDesi("Çikolata 25 g"), {
    value: 0.025,
    confidence: "HIGH",
    basis: "UNIT_SIZE",
  });
});

test("10 x 25 g paketi toplam 0,25 desi olarak tahmin eder", () => {
  assert.deepEqual(extractTotalPackageSize("Çikolata 10 x 25 g"), {
    value: 250,
    unit: "g",
  });
  assert.equal(estimatePackageDesi("Çikolata 10 x 25 g").value, 0.25);
});

test("gramajdan sonra yazılan koli adedini toplam pakete dahil eder", () => {
  assert.equal(
    estimatePackageDesi("Ülker Çikolatalı Gofret 36 g 36'lı").value,
    1.296,
  );
});

test("farklı eklerle yazılan çoklu paketlerin toplam desisini bulur", () => {
  assert.equal(estimatePackageDesi("Su 500 ml 24'lü").value, 12);
  assert.equal(estimatePackageDesi("Gofret 25 g 24'lü").value, 0.6);
});

test("bebek bezi kilo aralığını ürün ağırlığı saymaz", () => {
  assert.deepEqual(
    estimatePackageDesi("Bebek Bezi Midi 3 Beden 5-9 kg 50'li"),
    { value: 0.25, confidence: "LOW", basis: "BODY_WEIGHT_RANGE" },
  );
  assert.deepEqual(
    estimatePackageDesi("Bebek Bezi Extra Large Beden 17+ kg 30'lu"),
    { value: 0.25, confidence: "LOW", basis: "BODY_WEIGHT_RANGE" },
  );
});

test("kâğıt gramajını paket ağırlığı saymaz", () => {
  assert.deepEqual(estimatePackageDesi("Fotokopi Kağıdı A4 80 gr 500'lü"), {
    value: 0.25,
    confidence: "LOW",
    basis: "MATERIAL_GRAMMAGE",
  });
  assert.deepEqual(
    estimatePackageDesi("Sveto Copy Fotok.Kağıd. A4 80 Gr 500 Lü"),
    { value: 0.25, confidence: "LOW", basis: "MATERIAL_GRAMMAGE" },
  );
});

test("ölçüsüz ürünü düşük güvenle işaretler", () => {
  assert.deepEqual(estimatePackageDesi("Daycare Vücut Ağda Bandı 20'li"), {
    value: 0.25,
    confidence: "LOW",
    basis: "FALLBACK",
  });
});

test("nihai ürün desisini daima bir sonraki tam sayıya yuvarlar", () => {
  assert.equal(roundProductDesi(0.25), 1);
  assert.equal(roundProductDesi(1), 1);
  assert.equal(roundProductDesi(1.5), 2);
  assert.equal(roundProductDesi(2.01), 3);
});

test("çoklu alım fiyat kademesini normalize eder ve adede göre seçer", () => {
  const tiers = normalizePriceTiers([
    { minQuantity: 12, unitPrice: "36,50" },
    { min_quantity: 6, unit_price: "38,90 TL" },
  ]);
  assert.deepEqual(tiers, [
    { min_quantity: 6, unit_price: 38.9, label: "6+ adet" },
    { min_quantity: 12, unit_price: 36.5, label: "12+ adet" },
  ]);
  assert.equal(priceTierForQuantity(42.5, tiers, 1).unitPrice, 42.5);
  assert.equal(priceTierForQuantity(42.5, tiers, 6).unitPrice, 38.9);
  assert.equal(priceTierForQuantity(42.5, tiers, 18).unitPrice, 36.5);
});

test("metinden çoklu fiyat kademesi yakalar", () => {
  assert.deepEqual(
    parsePriceTiersFromText("6 adet ve üzeri birim fiyat 38,90 TL", 42.5),
    [{ min_quantity: 6, unit_price: 38.9, label: "6+ adet" }],
  );
});
