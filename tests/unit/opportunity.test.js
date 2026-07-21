const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scoreOpportunity,
  generatePackCandidates,
  generateMixedBundleCandidates,
} = require("../../src/domain/opportunity");
const { bundleFingerprint } = require("../../src/domain/pim");

const menekse = {
  productName: "Menekşe Çamaşır Yumuşatıcısı 1,5 L",
  brand: "Actisoft",
  productFamily: "Çamaşır Yumuşatıcısı",
  variant: "Menekşe",
  costItemCode: "ACTISOFT_MENEKSE_1500",
  unitCostMinor: 11200,
  unitDesi: 1.5,
};
const cicek = {
  ...menekse,
  productName: "Çiçek Rüyası Çamaşır Yumuşatıcısı 1,5 L",
  variant: "Çiçek Rüyası",
  costItemCode: "ACTISOFT_CICEK_RUYASI_1500",
};

test("fırsat puanı sinyal katkılarını açıklanabilir üretir", () => {
  const result = scoreOpportunity({
    minimumPrice: 300,
    buyboxPrice: 360,
    competitorCount: 2,
    familySales: 20,
    supplierFreshnessDays: 3,
    stockAvailable: true,
    shippingRatio: 0.15,
    commissionRate: 17,
  });
  assert.equal(result.confidence, "HIGH");
  assert.equal(result.score > 70, true);
  assert.equal(
    result.signals.every((item) => item.key && item.source),
    true,
  );
});

test("veri yetersiz fırsat kesin satış tahmini gibi sunulmaz", () => {
  const result = scoreOpportunity({ stockAvailable: true, missingPack: true });
  assert.equal(result.confidence, "INSUFFICIENT_DATA");
  assert.equal(result.missing.includes("buyboxPrice"), true);
});

test("Menekşe 1,5 L için eksik 2/3/4/6 paketleri güvenli sınırda üretir", () => {
  const existing = bundleFingerprint([
    { costItemCode: menekse.costItemCode, quantity: 4 },
  ]);
  const candidates = generatePackCandidates([menekse], {
    existingFingerprints: [existing],
  });
  assert.deepEqual(
    candidates.map((item) => item.components[0].quantity),
    [2, 3, 6],
  );
  assert.equal(
    candidates.find((item) => item.components[0].quantity === 3).finalDesi,
    5,
  );
});

test("Menekşe ve Çiçek Rüyası karma paketleri ters sırada duplicate üretmez", () => {
  const candidates = generateMixedBundleCandidates([menekse, cicek]);
  assert.deepEqual(
    candidates.map((item) => item.components.map((part) => part.quantity)),
    [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 3],
      [4, 2],
    ],
  );
  assert.equal(
    new Set(candidates.map((item) => item.bundleFingerprint)).size,
    candidates.length,
  );
  assert.equal(
    candidates.every((item) => item.recipeType === "MIXED_BUNDLE"),
    true,
  );
});

test("bundle üreticisi maksimum adet, desi ve aday sınırını aşmaz", () => {
  const candidates = generateMixedBundleCandidates([menekse, cicek], {
    maxTotalUnits: 2,
    maxDesi: 4,
    maxCandidates: 1,
  });
  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].components.reduce((sum, item) => sum + item.quantity, 0),
    2,
  );
});
