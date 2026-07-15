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
});

const SUPPLIER_CODES = Object.keys(SUPPLIERS);

function supplier(code) {
  return SUPPLIERS[String(code || "").toUpperCase()] || null;
}

function extractTotalPackageSize(value) {
  const text = normalizeText(value);
  const prefixed = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|lt|l|gr|g|kg)\b/,
  );
  const suffixed = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*(ml|lt|l|gr|g|kg)\s+(\d+(?:[.,]\d+)?)\s*(?:li|adet|paket)\b/,
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

module.exports = {
  SUPPLIERS,
  SUPPLIER_CODES,
  supplier,
  extractTotalPackageSize,
  estimatePackageDesi,
  roundProductDesi,
};
