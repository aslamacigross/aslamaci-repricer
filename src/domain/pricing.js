const {
  parseNumber,
  decimalToInteger,
  integerToDecimal,
  divideRounded,
} = require("../utils/numbers");

const RATE_SCALE = 10000n;
const PERCENT_SCALE = 100n * RATE_SCALE;
const cents = (value) => decimalToInteger(value, 2);
const rateUnits = (value) => decimalToInteger(value, 4);
const money = (value) => integerToDecimal(value, 2);
const toMoneyMinor = (value) => Number(cents(value));
const fromMoneyMinor = (value) => money(BigInt(value || 0));

function calculateMinimumPrice(input) {
  const commissionRate = rateUnits(input.commissionRate);
  const base =
    cents(input.productCost) +
    cents(input.shippingCost) +
    cents(input.packagingCost) +
    cents(input.serviceFee) +
    cents(input.targetProfit);
  const denominator = PERCENT_SCALE - commissionRate;
  if (commissionRate <= 0n || denominator <= 0n || base <= 0n) return 0;
  return money(divideRounded(base * PERCENT_SCALE, denominator));
}

function calculateCommissionAmount(input) {
  return money(
    divideRounded(
      cents(input.salePrice) * rateUnits(input.commissionRate),
      PERCENT_SCALE,
    ),
  );
}

function calculateNetProfit(input) {
  const salePrice = cents(input.salePrice);
  const commission = cents(calculateCommissionAmount(input));
  return money(
    salePrice -
      commission -
      cents(input.productCost) -
      cents(input.shippingCost) -
      cents(input.packagingCost) -
      cents(input.serviceFee),
  );
}

function calculateNetMargin(input) {
  const salePrice = cents(input.salePrice);
  if (salePrice <= 0n) return 0;
  const profit = cents(calculateNetProfit(input));
  return integerToDecimal(divideRounded(profit * 100n * 100n, salePrice), 2);
}

function selectShippingCost({
  salePrice,
  desi,
  barems = [],
  costs = [],
  carrier,
}) {
  const price = parseNumber(salePrice);
  const roundedDesi = Math.ceil(parseNumber(desi));
  const barem = barems.find(
    (item) =>
      item.carrier === carrier &&
      price >= parseNumber(item.min_basket) &&
      price <= parseNumber(item.max_basket),
  );
  if (barem) return parseNumber(barem.cost_inc_vat);
  const cost = costs.find(
    (item) =>
      item.carrier === carrier && parseNumber(item.desi_kg) === roundedDesi,
  );
  return cost ? parseNumber(cost.cost_inc_vat) : 0;
}

function selectPackagingCost(desi, rules = []) {
  const roundedDesi = Math.ceil(parseNumber(desi));
  const rule = rules.find(
    (item) =>
      (!item.rule_scope || item.rule_scope === "DESI") &&
      roundedDesi >= parseNumber(item.min_desi) &&
      roundedDesi <= parseNumber(item.max_desi),
  );
  return rule ? parseNumber(rule.packaging_cost) : 0;
}

function isCostComplete(product) {
  return (
    parseNumber(product.calculated_product_cost) > 0 &&
    parseNumber(product.desi) > 0 &&
    parseNumber(product.calculated_shipping_cost) > 0 &&
    parseNumber(product.min_price) > 0 &&
    parseNumber(product.commission_rate) > 0 &&
    !product.has_orphan_mapping
  );
}

module.exports = {
  calculateMinimumPrice,
  calculateCommissionAmount,
  calculateNetProfit,
  calculateNetMargin,
  selectShippingCost,
  selectPackagingCost,
  isCostComplete,
  toMoneyMinor,
  fromMoneyMinor,
};
