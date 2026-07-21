const crypto = require("crypto");

function normalized(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function componentSignature(component) {
  const identity =
    component.physicalProductId ||
    component.physical_product_id ||
    component.costItemCode ||
    component.cost_item_code ||
    component.canonicalKey ||
    component.canonical_key;
  const quantity = Number(component.quantity || 0);
  return `${normalized(identity)}:${quantity.toFixed(4)}`;
}

function bundleFingerprint(components = []) {
  if (!components.length) throw new Error("Reçete en az bir bileşen içermeli");
  const signature = components.map(componentSignature).sort().join("|");
  return crypto.createHash("sha256").update(signature).digest("hex");
}

function recipeType(components = []) {
  if (components.length > 1) return "MIXED_BUNDLE";
  return Number(components[0]?.quantity || 0) > 1 ? "PACK" : "SINGLE";
}

function sameNumber(a, b, tolerance = 0.0001) {
  if (a == null || b == null) return null;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function normalizedMeasure(value, field) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().toLowerCase().replace(",", ".");
  const amount = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(amount)) return null;
  if (field === "unitVolumeMl")
    return /\bl\b|litre|liter/.test(text) ? amount * 1000 : amount;
  if (field === "unitWeightG")
    return /\bkg\b|kilogram/.test(text) ? amount * 1000 : amount;
  return amount;
}

function normalizedName(value) {
  return normalized(value)
    .replace(/\bYUMUSATICISI\b/g, "YUMUSATICI")
    .replace(/\bCAMASIR\b/g, "")
    .replace(/\bKONSANTRE\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textSimilarity(left, right) {
  const a = normalizedName(left);
  const b = normalizedName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const leftTokens = new Set(a.split(" "));
  const rightTokens = new Set(b.split(" "));
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function catalogMatch(source, candidate) {
  const evidence = [];
  let score = 0;
  let availablePoints = 0;
  let possible = true;
  const missingRequired = [];
  let fuzzySignalUsed = false;
  const signals = [
    ["brand", 20, true, "TEXT_EXACT"],
    ["variant", 15, true, "TEXT_EXACT"],
    ["unitVolumeMl", 15, true, "MEASURE"],
    ["unitWeightG", 15, true, "MEASURE"],
    ["packCount", 15, true, "MEASURE"],
    ["productFamily", 20, false, "TEXT_FUZZY"],
    ["productName", 10, false, "TEXT_FUZZY"],
    ["category", 5, false, "TEXT_FUZZY"],
  ];
  for (const [field, points, hard, comparison] of signals) {
    const left = source[field];
    const right = candidate[field];
    const sourceHasValue = left != null && left !== "";
    const candidateHasValue = right != null && right !== "";
    if (!sourceHasValue) {
      evidence.push({ field, status: "MISSING", points: 0 });
      continue;
    }
    availablePoints += points;
    if (!candidateHasValue) {
      evidence.push({ field, status: "MISSING", points: 0 });
      if (hard) missingRequired.push(field);
      continue;
    }
    const similarity =
      comparison === "TEXT_FUZZY" ? textSimilarity(left, right) : null;
    const matches =
      comparison === "MEASURE"
        ? sameNumber(
            normalizedMeasure(left, field),
            normalizedMeasure(right, field),
          )
        : comparison === "TEXT_FUZZY"
          ? similarity >= 0.65
          : normalized(left) === normalized(right);
    const exact =
      comparison === "TEXT_FUZZY" &&
      normalizedName(left) === normalizedName(right);
    const awardedPoints = matches
      ? comparison === "TEXT_FUZZY"
        ? Math.round(points * similarity * 100) / 100
        : points
      : 0;
    if (matches && comparison === "TEXT_FUZZY" && !exact)
      fuzzySignalUsed = true;
    evidence.push({
      field,
      status: matches ? (exact ? "MATCH" : "FUZZY_MATCH") : "MISMATCH",
      similarity,
      points: awardedPoints,
    });
    if (matches) score += awardedPoints;
    else if (hard) possible = false;
  }
  const sourceComponents = source.components || [];
  const candidateComponents = candidate.components || [];
  if (sourceComponents.length || candidateComponents.length) {
    availablePoints += 10;
    const componentMatch =
      sourceComponents.length === candidateComponents.length &&
      bundleFingerprint(sourceComponents) ===
        bundleFingerprint(candidateComponents);
    evidence.push({
      field: "components",
      status: componentMatch ? "MATCH" : "MISMATCH",
      points: componentMatch ? 10 : 0,
    });
    if (componentMatch) score += 10;
    else possible = false;
  }
  const normalizedScore = availablePoints
    ? Math.round((score / availablePoints) * 10000) / 100
    : 0;
  let confidence = possible
    ? Math.min(normalizedScore, 100)
    : Math.min(normalizedScore, 69);
  if (missingRequired.length) confidence = Math.min(confidence, 84);
  return {
    isMatch: possible && confidence >= 70,
    confidence,
    level:
      confidence >= 90 && !missingRequired.length
        ? "HIGH"
        : confidence >= 70
          ? "REVIEW"
          : "LOW",
    status: possible && confidence >= 70 ? "REVIEW_REQUIRED" : "REJECTED",
    exactMatch: possible && !fuzzySignalUsed,
    automaticConfirmationEligible:
      possible &&
      confidence >= 90 &&
      !missingRequired.length &&
      !fuzzySignalUsed,
    fuzzySignalUsed,
    insufficientData: missingRequired.length > 0,
    missingRequired,
    evidence,
  };
}

function listingBarcodeCandidate(marketplace, recipeId, fingerprint) {
  const digest = crypto
    .createHash("sha256")
    .update(`${String(marketplace).toUpperCase()}:${recipeId}:${fingerprint}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `ASL-${String(marketplace).toUpperCase().slice(0, 3)}-${digest}`;
}

module.exports = {
  normalized,
  normalizedMeasure,
  normalizedName,
  textSimilarity,
  componentSignature,
  bundleFingerprint,
  recipeType,
  catalogMatch,
  listingBarcodeCandidate,
};
