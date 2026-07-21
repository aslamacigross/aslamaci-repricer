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

function catalogMatch(source, candidate) {
  const evidence = [];
  let score = 0;
  let availablePoints = 0;
  let possible = true;
  const missingRequired = [];
  const signals = [
    ["brand", 20, true],
    ["productFamily", 20, true],
    ["variant", 15, true],
    ["unitVolumeMl", 15, true],
    ["unitWeightG", 15, true],
    ["packCount", 15, true],
    ["category", 5, false],
  ];
  for (const [field, points, hard] of signals) {
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
    const numeric = typeof left === "number" || typeof right === "number";
    const matches = numeric
      ? sameNumber(left, right)
      : normalized(left) === normalized(right);
    evidence.push({ field, status: matches ? "MATCH" : "MISMATCH", points: matches ? points : 0 });
    if (matches) score += points;
    else if (hard) possible = false;
  }
  const sourceComponents = source.components || [];
  const candidateComponents = candidate.components || [];
  if (sourceComponents.length || candidateComponents.length) {
    availablePoints += 10;
    const componentMatch =
      sourceComponents.length === candidateComponents.length &&
      bundleFingerprint(sourceComponents) === bundleFingerprint(candidateComponents);
    evidence.push({ field: "components", status: componentMatch ? "MATCH" : "MISMATCH", points: componentMatch ? 10 : 0 });
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
  componentSignature,
  bundleFingerprint,
  recipeType,
  catalogMatch,
  listingBarcodeCandidate,
};
