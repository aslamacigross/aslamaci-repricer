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
