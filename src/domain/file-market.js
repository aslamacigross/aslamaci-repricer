const SUPPLIER_PRICE_MAX_AGE_DAYS = 30;

function isSupplierPriceFresh(value, now = new Date()) {
  const observedAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(observedAt.getTime())) return false;
  return (
    now.getTime() - observedAt.getTime() <=
    SUPPLIER_PRICE_MAX_AGE_DAYS * 86400000
  );
}

module.exports = {
  SUPPLIER_PRICE_MAX_AGE_DAYS,
  isSupplierPriceFresh,
  FILE_PRICE_MAX_AGE_DAYS: SUPPLIER_PRICE_MAX_AGE_DAYS,
  isFilePriceFresh: isSupplierPriceFresh,
};
