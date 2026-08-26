const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMappingLearningKey,
  mappingLearningAdjustment,
} = require("../../src/domain/mapping-learning");

test("aynı marka kategori ve reçete için stabil öğrenme anahtarı üretir", () => {
  const first = buildMappingLearningKey({
    product_snapshot: { brand: "Daycare", category_id: "123" },
    evidence: {
      fileMatches: [
        { costItemCode: "DAYCARE_KOLONYA", priceMode: "SIBLING_VARIANT" },
      ],
    },
    items: [{ cost_item_code: "DAYCARE_KOLONYA" }],
  });
  const second = buildMappingLearningKey({
    product_snapshot: { brand: "DAYCARE", category_id: 123 },
    evidence: {
      fileMatches: [
        { costItemCode: "DAYCARE_KOLONYA", priceMode: "SIBLING_VARIANT" },
      ],
    },
    items: [{ cost_item_code: "DAYCARE_KOLONYA" }],
  });
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("Hepsiburada öğrenme anahtarı Trendyol geçmişinden ayrıdır", () => {
  const shared = {
    product_snapshot: { brand: "Actisoft", category_id: "123" },
    items: [{ cost_item_code: "ACTISOFT_MENEKSE_1500ML" }],
  };
  const trendyol = buildMappingLearningKey({
    ...shared,
    marketplace: "TRENDYOL",
  });
  const hepsiburada = buildMappingLearningKey({
    ...shared,
    marketplace: "HEPSIBURADA",
  });

  assert.notEqual(trendyol, hepsiburada);
  assert.equal(
    hepsiburada,
    buildMappingLearningKey({ ...shared, marketplace: "hepsiburada" }),
  );
});

test("Trendyol onay veya ret profili Hepsiburada guvenine uygulanmaz", () => {
  const baseConfidence = 0.72;
  const trendyolProfile = mappingLearningAdjustment(baseConfidence, {
    accepted_count: 20,
    rejected_count: 0,
  });
  const hepsiburadaWithoutOwnProfile = mappingLearningAdjustment(
    baseConfidence,
    undefined,
  );

  assert.ok(trendyolProfile.confidence > baseConfidence);
  assert.equal(hepsiburadaWithoutOwnProfile.confidence, baseConfidence);
  assert.equal(hepsiburadaWithoutOwnProfile.adjustment, 0);
});

test("Hepsiburada onay veya ret profili Trendyol guvenine uygulanmaz", () => {
  const baseConfidence = 0.72;
  const hepsiburadaProfile = mappingLearningAdjustment(baseConfidence, {
    accepted_count: 0,
    rejected_count: 20,
  });
  const trendyolWithoutOwnProfile = mappingLearningAdjustment(
    baseConfidence,
    undefined,
  );

  assert.ok(hepsiburadaProfile.confidence < baseConfidence);
  assert.equal(trendyolWithoutOwnProfile.confidence, baseConfidence);
  assert.equal(trendyolWithoutOwnProfile.adjustment, 0);
});

test("tekrarlanan onaylar güveni yükseltir, retler düşürür", () => {
  const accepted = mappingLearningAdjustment(0.75, {
    accepted_count: 12,
    rejected_count: 0,
  });
  const rejected = mappingLearningAdjustment(0.75, {
    accepted_count: 0,
    rejected_count: 12,
  });
  assert.ok(accepted.confidence > 0.9);
  assert.ok(accepted.adjustment > 0);
  assert.ok(rejected.confidence < 0.6);
  assert.ok(rejected.adjustment < 0);
});

test("kardeş varyant ancak yeterli ve temiz onay geçmişiyle yüksek güvene çıkar", () => {
  const newPattern = mappingLearningAdjustment(
    0.98,
    {},
    { variantPriceInferred: true },
  );
  const learnedPattern = mappingLearningAdjustment(
    0.8,
    { accepted_count: 10, rejected_count: 0 },
    { variantPriceInferred: true },
  );
  assert.equal(newPattern.confidence, 0.919);
  assert.equal(newPattern.variantPromotionUnlocked, false);
  assert.ok(learnedPattern.confidence >= 0.92);
  assert.equal(learnedPattern.variantPromotionUnlocked, true);
});
