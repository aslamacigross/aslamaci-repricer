const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const { merchantId } = require("./hepsiburada-merchant-identity");

const SOURCE = "HEPSIBURADA_COMMISSION_API";
const VERSION = "HB_SKU_COMMISSION_V1";
const MAX_AGE_MS = 5 * 60 * 1000;
const exact = (s) => typeof s === "string" && s.length > 0 && s === s.trim();
function validateCommissionScope(scope) {
  requireEvidence(
    exact(scope?.merchantId) &&
      exact(scope?.merchantSku) &&
      exact(scope?.hbSku),
    "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
  );
}
function requireEvidence(ok, code) {
  if (!ok) throw new AppError(code, 409, code);
}
function values(row, keys) {
  return keys
    .map((key) => key.split(".").reduce((v, k) => v?.[k], row))
    .filter((v) => v !== undefined && v !== null);
}

// Deliberately separate from the legacy sync's permissive/case-folded matching.
// A merchant-scoped GET binds the merchant; its exact HB SKU plus the independent
// own-listing check bind the merchantSku. No names, barcodes or category rates.
function evidenceFromResponse(payload, scope, now = Date.now()) {
  validateCommissionScope(scope);
  const rows = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (
      values(value, ["sku", "hbSku", "hepsiburadaSku", "merchantSku"]).length
    ) {
      rows.push(value);
      return;
    }
    for (const key of [
      "commissions",
      "commissionRates",
      "items",
      "data",
      "content",
      "results",
    ])
      if (value[key] != null) visit(value[key]);
  }
  visit(payload);
  const matches = rows.filter(
    (row) =>
      values(row, ["sku", "hbSku", "hepsiburadaSku"]).includes(scope.hbSku) ||
      values(row, ["merchantSku", "merchantSKU"]).includes(scope.merchantSku),
  );
  requireEvidence(matches.length === 1, "HB_FLOOR_COMMISSION_AMBIGUOUS");
  const row = matches[0];
  const skus = values(row, ["sku", "hbSku", "hepsiburadaSku"]);
  requireEvidence(
    skus.length > 0 &&
      skus.every((s) => s === scope.hbSku) &&
      values(row, ["merchantSku", "merchantSKU"]).every(
        (s) => s === scope.merchantSku,
      ) &&
      values(row, ["merchantId", "sellerId"]).every(
        (id) => merchantId(id) === merchantId(scope.merchantId),
      ),
    "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
  );
  const rates = values(row, [
    "commissionRate",
    "commissionrate",
    "commission_rate",
    "commissionPercentage",
    "commissionPercent",
    "commission.rate",
    "commission.value",
    "commission.percentage",
    "commissionRate.value",
  ]).filter((v) => typeof v !== "object");
  requireEvidence(
    rates.length > 0 &&
      rates.every(
        (v) =>
          (typeof v === "number" ||
            (typeof v === "string" && v.trim() !== "")) &&
          Number.isFinite(Number(v)) &&
          Number(v) > 0 &&
          Number(v) < 100 &&
          Number(v) === Number(rates[0]),
      ),
    "HB_FLOOR_COMMISSION_UNVERIFIED",
  );
  // Generic `vat`/product tax fields do not describe commission VAT. Missing
  // semantics remain UNKNOWN. Never assume that a displayed 17 means 17 gross.
  const flags = values(row, [
    "commissionRateIncludesVat",
    "commissionVatIncluded",
    "commission.vatIncluded",
  ]);
  requireEvidence(
    flags.every((v) => typeof v === "boolean") && new Set(flags).size <= 1,
    "HB_FLOOR_COMMISSION_VAT_UNVERIFIED",
  );
  const vatBasis = flags.length
    ? flags[0]
      ? "INCLUDED"
      : "EXCLUDED"
    : "UNKNOWN";
  return {
    version: VERSION,
    source: SOURCE,
    requestScope: "AUTHENTICATED_MERCHANT_GET",
    merchantId: merchantId(scope.merchantId),
    merchantSku: scope.merchantSku,
    hbSku: scope.hbSku,
    rate: Number(rates[0]),
    vatBasis,
    checkedAt: new Date(now).toISOString(),
  };
}

function verifyCommissionEvidence(
  evidence,
  product,
  ownMerchantId,
  now = Date.now(),
) {
  requireEvidence(
    evidence?.version === VERSION &&
      evidence.source === SOURCE &&
      evidence.requestScope === "AUTHENTICATED_MERCHANT_GET",
    "HB_FLOOR_COMMISSION_UNVERIFIED",
  );
  requireEvidence(
    product.marketplace === "HEPSIBURADA" &&
      exact(product.merchant_sku) &&
      exact(product.hb_sku) &&
      merchantId(ownMerchantId) &&
      evidence.merchantId === merchantId(ownMerchantId) &&
      evidence.merchantSku === product.merchant_sku &&
      evidence.hbSku === product.hb_sku,
    "HB_FLOOR_COMMISSION_IDENTITY_UNVERIFIED",
  );
  const age = now - Date.parse(evidence.checkedAt);
  requireEvidence(
    Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS,
    "HB_FLOOR_COMMISSION_STALE",
  );
  requireEvidence(
    Number.isFinite(evidence.rate) &&
      evidence.rate > 0 &&
      evidence.rate < 100 &&
      evidence.rate === Number(product.commission_rate),
    "HB_FLOOR_COMMISSION_CHANGED",
  );
  // Existing pricing deducts commission as a single percentage. Accept only
  // explicitly VAT-inclusive evidence compatible with that unchanged model.
  // Exclusive/unknown rates need a separate accounting reconciliation, NOT an
  // assumed VAT credit, extra fee, or a category-rule fallback.
  requireEvidence(
    evidence.vatBasis === "INCLUDED",
    "HB_FLOOR_COMMISSION_VAT_UNVERIFIED",
  );
  const content = {
    version: evidence.version,
    source: evidence.source,
    requestScope: evidence.requestScope,
    merchantId: evidence.merchantId,
    merchantSku: evidence.merchantSku,
    hbSku: evidence.hbSku,
    rate: evidence.rate,
    vatBasis: evidence.vatBasis,
  };
  return {
    ...evidence,
    fingerprint: crypto
      .createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex"),
  };
}

module.exports = {
  evidenceFromResponse,
  verifyCommissionEvidence,
  validateCommissionScope,
  MAX_AGE_MS,
};
