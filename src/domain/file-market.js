const FILE_PRICE_MAX_AGE_DAYS = 30;

function isFilePriceFresh(value, now = new Date()) {
  const observedAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(observedAt.getTime())) return false;
  return (
    now.getTime() - observedAt.getTime() <= FILE_PRICE_MAX_AGE_DAYS * 86400000
  );
}

module.exports = { FILE_PRICE_MAX_AGE_DAYS, isFilePriceFresh };
