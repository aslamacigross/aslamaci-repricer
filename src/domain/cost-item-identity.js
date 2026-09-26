const { normalizeText } = require("./product-matching");

function generatedCostCode(supplierOffer) {
  const raw = normalizeText(
    `${supplierOffer.brand || ""} ${supplierOffer.product_name}`,
  )
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("_")
    .toUpperCase();
  const size =
    supplierOffer.size_value && supplierOffer.size_unit
      ? `_${Number(supplierOffer.size_value).toLocaleString("tr-TR", {
          maximumFractionDigits: 0,
          useGrouping: false,
        })}${String(supplierOffer.size_unit).toUpperCase()}`
      : "";
  const supplierPrefix =
    supplierOffer.supplier_code &&
    supplierOffer.supplier_code !== "FILE_MARKET"
      ? `${supplierOffer.supplier_code}_`
      : "";
  return `${supplierPrefix}${raw || "TEDARIKCI_URUN"}${size}`.replace(
    /[^A-Z0-9_]/g,
    "_",
  );
}

function uniqueCostCode(baseCode, supplierOffer, index = 0) {
  const offerId =
    supplierOffer.file_market_item_id || supplierOffer.id || null;
  const suffix = offerId ? `_F${offerId}` : `_${index + 1}`;
  const clean = `${baseCode}${suffix}`.replace(/[^A-Z0-9_]/g, "_");
  return clean.length > 120 ? clean.slice(0, 120) : clean;
}

module.exports = { generatedCostCode, uniqueCostCode };
