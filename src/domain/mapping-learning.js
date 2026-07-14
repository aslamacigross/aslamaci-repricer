const crypto = require("crypto");
const { normalizeText } = require("./product-matching");

const MAX_LEARNING_ADJUSTMENT = 0.25;
const FULL_SUPPORT_DECISIONS = 10;

function buildMappingLearningKey(suggestion) {
  const product = suggestion.product_snapshot || suggestion;
  const priceModes = new Map(
    (suggestion.evidence?.fileMatches || []).map((match) => [
      match.costItemCode,
      match.priceMode || "DIRECT",
    ]),
  );
  const signature = {
    brand: normalizeText(product.brand),
    category: String(product.category_id || ""),
    items: [...(suggestion.items || [])]
      .map((item) => ({
        code: String(item.cost_item_code || ""),
        priceMode: priceModes.get(item.cost_item_code) || "DIRECT",
      }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(signature))
    .digest("hex");
}

function mappingLearningAdjustment(
  baseConfidence,
  profile = {},
  { variantPriceInferred = false } = {},
) {
  const accepted = Math.max(Number(profile.accepted_count) || 0, 0);
  const rejected = Math.max(Number(profile.rejected_count) || 0, 0);
  const decisions = accepted + rejected;
  const posteriorAcceptance = (accepted + 2) / (decisions + 4);
  const support = Math.min(decisions / FULL_SUPPORT_DECISIONS, 1);
  const adjustment = Number(
    (
      (posteriorAcceptance - 0.5) *
      2 *
      MAX_LEARNING_ADJUSTMENT *
      support
    ).toFixed(5),
  );
  let confidence = Math.max(
    0,
    Math.min(1, Number(baseConfidence) + adjustment),
  );
  const variantPromotionUnlocked =
    decisions >= 5 && accepted / decisions >= 0.9;
  if (variantPriceInferred && !variantPromotionUnlocked)
    confidence = Math.min(confidence, 0.919);
  return {
    confidence: Number(confidence.toFixed(5)),
    adjustment,
    accepted,
    rejected,
    decisions,
    acceptanceRate: decisions
      ? Number((accepted / decisions).toFixed(5))
      : null,
    posteriorAcceptance: Number(posteriorAcceptance.toFixed(5)),
    variantPromotionUnlocked,
  };
}

module.exports = {
  buildMappingLearningKey,
  mappingLearningAdjustment,
  MAX_LEARNING_ADJUSTMENT,
};
