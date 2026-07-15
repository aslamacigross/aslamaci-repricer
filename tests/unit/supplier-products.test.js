const test = require("node:test");
const assert = require("node:assert/strict");
const {
  estimatePackageDesi,
  extractTotalPackageSize,
  roundProductDesi,
} = require("../../src/domain/supplier-products");

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
