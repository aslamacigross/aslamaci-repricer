const { extractSizes, normalizeText } = require("./product-matching");

const SUPPLIERS = Object.freeze({
  FILE_MARKET: {
    code: "FILE_MARKET",
    label: "File Market",
    shortLabel: "File",
  },
  BIZIM_MARKET: {
    code: "BIZIM_MARKET",
    label: "Bizim Toptan",
    shortLabel: "Bizim",
  },
  BIM: { code: "BIM", label: "BİM", shortLabel: "BİM" },
  OTHER: {
    code: "OTHER",
    label: "Diğer maliyet havuzu",
    shortLabel: "Diğer",
  },
});

const SUPPLIER_CODES = Object.keys(SUPPLIERS);

function supplier(code) {
  return SUPPLIERS[String(code || "").toUpperCase()] || null;
}

function hasBodyWeightRange(value) {
  const text = String(value || "").toLocaleLowerCase("tr-TR");
  return /\b(?:\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*\+)\s*kg\b/.test(
    text,
  );
}

function hasMaterialGrammage(value) {
  const text = normalizeText(value);
  return (
    /\b(?:fotok|fotokopi|kagit|kagid)\b/.test(text) &&
    /\b\d+(?:[.,]\d+)?\s*(?:gr|g)\s+\d+(?:[.,]\d+)?\s*(?:li|lu|adet|paket)\b/.test(
      text,
    )
  );
}

function extractTotalPackageSize(value) {
  const text = normalizeText(value);
  const prefixed = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|lt|l|gr|g|kg)\b/,
  );
  const suffixed = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*(ml|lt|l|gr|g|kg)\s+(\d+(?:[.,]\d+)?)\s*(?:li|lu|adet|paket)\b/,
  );
  const count = Number(
    (prefixed?.[1] || suffixed?.[3] || "").replace(",", "."),
  );
  const amount = Number(
    (prefixed?.[2] || suffixed?.[1] || "").replace(",", "."),
  );
  if (!Number.isFinite(count) || !Number.isFinite(amount)) return null;
  const unit = prefixed?.[3] || suffixed?.[2];
  const baseAmount =
    unit === "kg" || unit === "l" || unit === "lt" ? amount * 1000 : amount;
  if (count <= 0 || baseAmount <= 0) return null;
  return {
    value: count * baseAmount,
    unit: unit === "ml" || unit === "l" || unit === "lt" ? "ml" : "g",
  };
}

function estimatePackageDesi(value, explicitDesi = null) {
  const current = Number(explicitDesi);
  if (Number.isFinite(current) && current > 0)
    return {
      value: Number(current.toFixed(4)),
      confidence: "HIGH",
      basis: "SOURCE",
    };

  if (hasBodyWeightRange(value))
    return { value: 0.25, confidence: "LOW", basis: "BODY_WEIGHT_RANGE" };

  if (hasMaterialGrammage(value))
    return { value: 0.25, confidence: "LOW", basis: "MATERIAL_GRAMMAGE" };

  const bundled = extractTotalPackageSize(value);
  if (bundled)
    return {
      value: Number(Math.max(bundled.value / 1000, 0.02).toFixed(4)),
      confidence: "HIGH",
      basis: "BUNDLE_SIZE",
    };

  const [size] = extractSizes(value);
  if (size)
    return {
      value: Number(Math.max(Number(size.value) / 1000, 0.02).toFixed(4)),
      confidence: "HIGH",
      basis: "UNIT_SIZE",
    };

  return { value: 0.25, confidence: "LOW", basis: "FALLBACK" };
}

function roundProductDesi(value) {
  const desi = Number(value);
  return Number.isFinite(desi) && desi > 0 ? Math.ceil(desi) : 0;
}

function parseSupplierPrice(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "")
    .replace(/\s/g, "")
    .replace(/₺|TL|TRY/gi, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  return Number(normalized);
}

function normalizePriceTiers(tiers = []) {
  if (!Array.isArray(tiers)) return [];
  const normalized = tiers
    .map((tier) => {
      const minQuantity = Number(
        tier.min_quantity ?? tier.minQuantity ?? tier.quantity ?? tier.qty,
      );
      const unitPrice = parseSupplierPrice(
        tier.unit_price ?? tier.unitPrice ?? tier.price,
      );
      if (
        !Number.isFinite(minQuantity) ||
        minQuantity <= 1 ||
        !Number.isFinite(unitPrice) ||
        unitPrice <= 0
      )
        return null;
      return {
        min_quantity: Number(minQuantity.toFixed(4)),
        unit_price: Number(unitPrice.toFixed(2)),
        label:
          String(tier.label || "").trim() ||
          `${Number(minQuantity.toFixed(4)).toLocaleString("tr-TR")}+ adet`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.min_quantity - right.min_quantity);
  const byQuantity = new Map();
  for (const tier of normalized)
    byQuantity.set(String(tier.min_quantity), tier);
  return [...byQuantity.values()];
}

function priceTierForQuantity(basePrice, tiers = [], quantity = 1) {
  const currentPrice = Number(basePrice);
  const qty = Number(quantity);
  const normalizedTiers = normalizePriceTiers(tiers);
  const defaultResult = {
    unitPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
    tier: null,
    tiers: normalizedTiers,
  };
  if (!Number.isFinite(qty) || qty <= 0 || !normalizedTiers.length)
    return defaultResult;
  const matching = normalizedTiers
    .filter((tier) => qty >= tier.min_quantity)
    .sort((left, right) => right.min_quantity - left.min_quantity)[0];
  if (!matching) return defaultResult;
  return {
    unitPrice: matching.unit_price,
    tier: matching,
    tiers: normalizedTiers,
  };
}

function parsePriceTiersFromText(value, basePrice = null) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];
  const tiers = [];
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:adet|ad|paket)?\s*(?:ve\s*uzeri|ve\s*üzeri|\+|üstü|ustu|sonrasi|sonrası)\D{0,80}?(\d+(?:[.,]\d{1,2})?)\s*(?:₺|tl|try)/giu,
    /(\d+(?:[.,]\d+)?)\s*(?:adet|ad|paket)\D{0,80}?(?:birim|adet)\s*fiyat\D{0,40}?(\d+(?:[.,]\d{1,2})?)\s*(?:₺|tl|try)/giu,
    /(\d+(?:[.,]\d+)?)\s*(?:adet|ad|paket)\D{0,40}?(\d+(?:[.,]\d{1,2})?)\s*(?:₺|tl|try)\s*(?:\/\s*)?(?:adet|ad|birim)/giu,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const minQuantity = Number(String(match[1]).replace(",", "."));
      const unitPrice = parseSupplierPrice(match[2]);
      if (!Number.isFinite(minQuantity) || !Number.isFinite(unitPrice))
        continue;
      if (Number(basePrice) > 0 && unitPrice >= Number(basePrice)) continue;
      tiers.push({
        min_quantity: minQuantity,
        unit_price: unitPrice,
        label: `${minQuantity.toLocaleString("tr-TR")}+ adet`,
      });
    }
  }
  return normalizePriceTiers(tiers);
}

module.exports = {
  SUPPLIERS,
  SUPPLIER_CODES,
  supplier,
  hasBodyWeightRange,
  hasMaterialGrammage,
  extractTotalPackageSize,
  estimatePackageDesi,
  roundProductDesi,
  normalizePriceTiers,
  parsePriceTiersFromText,
  priceTierForQuantity,
};
