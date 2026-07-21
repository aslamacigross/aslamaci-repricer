const { bundleFingerprint } = require("./pim");

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

function scoreOpportunity(input = {}) {
  const signals = [];
  const add = (key, label, rawValue, weight, normalizedValue, source) => {
    if (rawValue == null || Number.isNaN(Number(rawValue))) return;
    const normalized = clamp(normalizedValue);
    signals.push({
      key,
      label,
      value: rawValue,
      weight,
      normalized,
      contribution: Math.round(normalized * weight * 100) / 100,
      source,
    });
  };
  const minimumPrice = Number(input.minimumPrice || 0);
  const buyboxPrice = Number(input.buyboxPrice || 0);
  if (minimumPrice > 0 && buyboxPrice > 0)
    add(
      "margin_gap",
      "Minimum fiyat / buybox boşluğu",
      (buyboxPrice - minimumPrice) / minimumPrice,
      25,
      (buyboxPrice - minimumPrice) / minimumPrice / 0.5,
      "LIVE_OR_SNAPSHOT",
    );
  if (input.competitorCount != null) {
    const count = Number(input.competitorCount);
    add("competition", "Rakip yoğunluğu", count, 12, count <= 2 ? 1 : count <= 5 ? 0.7 : count <= 10 ? 0.4 : 0.1, "MARKETPLACE");
  }
  add("family_sales", "Ürün ailesi satış geçmişi", input.familySales, 15, Number(input.familySales) / 20, "ORDER_HISTORY");
  if (input.supplierFreshnessDays != null) {
    const days = Number(input.supplierFreshnessDays);
    add("supplier_freshness", "Tedarikçi fiyat güncelliği", days, 10, days <= 7 ? 1 : days <= 30 ? 0.7 : days <= 60 ? 0.3 : 0, "SUPPLIER_POOL");
  }
  if (input.stockAvailable != null)
    add("availability", "Tedarik edilebilirlik", Boolean(input.stockAvailable), 8, input.stockAvailable ? 1 : 0.2, "SUPPLIER_POOL");
  add("shipping_efficiency", "Kargo verimliliği", input.shippingRatio, 10, 1 - Number(input.shippingRatio) / 0.4, "PRICING_ENGINE");
  add("commission", "Komisyon verimliliği", input.commissionRate, 8, 1 - Number(input.commissionRate) / 30, "MARKETPLACE");
  add("returns", "İade riski", input.returnRate, 7, 1 - Number(input.returnRate) / 0.2, "ORDER_HISTORY");
  add("listing_quality", "Benzer listing kalitesi", input.listingQuality, 5, Number(input.listingQuality) / 100, "LISTING_HEALTH");
  if (input.missingPack != null)
    add("assortment_gap", "Eksik paket adedi", Boolean(input.missingPack), 10, input.missingPack ? 1 : 0, "PIM");
  const weight = signals.reduce((total, signal) => total + signal.weight, 0);
  const contribution = signals.reduce((total, signal) => total + signal.contribution, 0);
  const score = weight ? Math.round((contribution / weight) * 10000) / 100 : 0;
  const confidence =
    signals.length < 3
      ? "INSUFFICIENT_DATA"
      : signals.length >= 7
        ? "HIGH"
        : signals.length >= 5
          ? "MEDIUM"
          : "LOW";
  return {
    score,
    confidence,
    signals,
    missing: [
      !minimumPrice && "minimumPrice",
      !buyboxPrice && "buyboxPrice",
      input.competitorCount == null && "competitorCount",
      input.familySales == null && "familySales",
      input.supplierFreshnessDays == null && "supplierFreshnessDays",
      input.returnRate == null && "returnRate",
    ].filter(Boolean),
  };
}

function recipeCandidate(name, components, productsByCode, type) {
  const fingerprint = bundleFingerprint(components);
  const totalCostMinor = components.reduce(
    (sum, item) => sum + Number(productsByCode.get(item.costItemCode)?.unitCostMinor || 0) * Number(item.quantity),
    0,
  );
  const fractionalDesi = components.reduce(
    (sum, item) => sum + Number(productsByCode.get(item.costItemCode)?.unitDesi || 0) * Number(item.quantity),
    0,
  );
  return {
    recipeName: name,
    recipeType: type,
    components,
    bundleFingerprint: fingerprint,
    totalCostMinor: Math.round(totalCostMinor),
    fractionalDesi: Math.round(fractionalDesi * 10000) / 10000,
    finalDesi: Math.ceil(fractionalDesi),
  };
}

function allowedCandidate(candidate, options) {
  const totalUnits = candidate.components.reduce((sum, item) => sum + Number(item.quantity), 0);
  return (
    totalUnits <= options.maxTotalUnits &&
    candidate.finalDesi > 0 &&
    candidate.finalDesi <= options.maxDesi &&
    candidate.totalCostMinor > 0 &&
    !options.existingFingerprints.has(candidate.bundleFingerprint)
  );
}

function generatePackCandidates(products = [], input = {}) {
  const options = {
    quantities: input.quantities || [2, 3, 4, 6],
    maxTotalUnits: Number(input.maxTotalUnits || 6),
    maxDesi: Number(input.maxDesi || 30),
    maxCandidates: Number(input.maxCandidates || 100),
    existingFingerprints: new Set(input.existingFingerprints || []),
  };
  const productsByCode = new Map(products.map((item) => [item.costItemCode, item]));
  const results = [];
  for (const product of products) {
    if (product.unsafeBundle || !product.costItemCode) continue;
    for (const quantity of options.quantities) {
      const candidate = recipeCandidate(
        `${product.productName} x ${quantity}`,
        [{ costItemCode: product.costItemCode, quantity }],
        productsByCode,
        "PACK",
      );
      if (allowedCandidate(candidate, options)) {
        results.push(candidate);
        options.existingFingerprints.add(candidate.bundleFingerprint);
      }
      if (results.length >= options.maxCandidates) return results;
    }
  }
  return results;
}

function generateMixedBundleCandidates(products = [], input = {}) {
  const options = {
    combinations: input.combinations || [[1, 1], [2, 1], [2, 2], [3, 3], [4, 2]],
    maxTotalUnits: Number(input.maxTotalUnits || 6),
    maxDesi: Number(input.maxDesi || 30),
    maxCandidates: Number(input.maxCandidates || 100),
    existingFingerprints: new Set(input.existingFingerprints || []),
  };
  const productsByCode = new Map(products.map((item) => [item.costItemCode, item]));
  const groups = new Map();
  for (const product of products) {
    if (product.unsafeBundle || !product.costItemCode || !product.productFamily) continue;
    const key = `${product.brand || ""}:${product.productFamily}`.toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  const results = [];
  for (const group of groups.values()) {
    for (let left = 0; left < group.length; left++) {
      for (let right = left + 1; right < group.length; right++) {
        if (String(group[left].variant || "") === String(group[right].variant || "")) continue;
        for (const [leftQuantity, rightQuantity] of options.combinations) {
          const candidate = recipeCandidate(
            `${group[left].productName} x ${leftQuantity} + ${group[right].productName} x ${rightQuantity}`,
            [
              { costItemCode: group[left].costItemCode, quantity: leftQuantity },
              { costItemCode: group[right].costItemCode, quantity: rightQuantity },
            ],
            productsByCode,
            "MIXED_BUNDLE",
          );
          if (allowedCandidate(candidate, options)) {
            results.push(candidate);
            options.existingFingerprints.add(candidate.bundleFingerprint);
          }
          if (results.length >= options.maxCandidates) return results;
        }
      }
    }
  }
  return results;
}

module.exports = {
  scoreOpportunity,
  generatePackCandidates,
  generateMixedBundleCandidates,
};
