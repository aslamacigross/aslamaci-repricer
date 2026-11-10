// Exact identifiers/names only. Logistics account/customer codes are not sellers.
function merchantId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function sellerName(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR")
    : "";
}
function findOwnBuyboxOrder(
  orders,
  { ownMerchantId, ownSellerNames = [] } = {},
) {
  const ownId = merchantId(ownMerchantId);
  const names = new Set([...ownSellerNames].map(sellerName).filter(Boolean));
  const valid = (order) => Number.isInteger(order.rank) && order.rank > 0;
  const byId = ownId
    ? orders.filter(
        (order) =>
          !order.identityConflict && merchantId(order.merchantId) === ownId,
      )
    : [];
  if (byId.length) return byId.length === 1 && valid(byId[0]) ? byId[0] : null;
  const byName = orders.filter(
    (order) =>
      !order.identityConflict &&
      // A conflicting permanent ID always vetoes an otherwise matching name.
      !(ownId && merchantId(order.merchantId)) &&
      names.has(sellerName(order.merchantName)),
  );
  return byName.length === 1 && valid(byName[0]) ? byName[0] : null;
}
function matchesOwnListing(product, listing) {
  const merchant = String(product?.merchant_sku || product?.barcode || "");
  const sku = String(product?.hb_sku || product?.marketplace_product_id || "");
  return Boolean(
    merchant &&
    sku &&
    listing &&
    String(listing.merchantSku || listing.merchantSKU || "") === merchant &&
    String(listing.hbSku || listing.hepsiburadaSku || "") === sku,
  );
}
module.exports = {
  merchantId,
  sellerName,
  findOwnBuyboxOrder,
  matchesOwnListing,
};
