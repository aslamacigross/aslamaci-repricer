const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

function canonicalGtin(value) {
  const digits = String(value || "").trim();
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return "";
  const body = digits.slice(0, -1);
  const expected = Number(digits.at(-1));
  let sum = 0;
  for (let index = body.length - 1, offset = 0; index >= 0; index--, offset++)
    sum += Number(body[index]) * (offset % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === expected ? digits : "";
}

function verifiedCatalogGtin(product) {
  const gtin = canonicalGtin(product?.catalog_gtin);
  const source = String(product?.catalog_gtin_source || "").trim();
  return gtin && source ? { gtin, source } : null;
}

module.exports = { canonicalGtin, verifiedCatalogGtin };
