const { parseNumber, roundMoney } = require("../utils/numbers");

function calculateMinimumPrice(input) {
  const commissionRate = parseNumber(input.commissionRate);
  const base =
    parseNumber(input.productCost) +
    parseNumber(input.shippingCost) +
    parseNumber(input.packagingCost) +
    parseNumber(input.serviceFee) +
    parseNumber(input.targetProfit);
  if (commissionRate <= 0 || commissionRate >= 100 || base <= 0) return 0;
  return roundMoney(base / (1 - commissionRate / 100));
}

function calculateNetProfit(input) {
  const salePrice = parseNumber(input.salePrice);
  const commission = salePrice * (parseNumber(input.commissionRate) / 100);
  return roundMoney(
    salePrice - commission - parseNumber(input.productCost) - parseNumber(input.shippingCost) -
      parseNumber(input.packagingCost) - parseNumber(input.serviceFee)
  );
}

function calculateNetMargin(input) {
  const salePrice = parseNumber(input.salePrice);
  if (salePrice <= 0) return 0;
  return roundMoney((calculateNetProfit(input) / salePrice) * 100);
}

function selectShippingCost({ salePrice, desi, barems = [], costs = [], carrier }) {
  const price = parseNumber(salePrice);
  const roundedDesi = Math.ceil(parseNumber(desi));
  const barem = barems.find(
    item => item.carrier === carrier && price >= parseNumber(item.min_basket) && price <= parseNumber(item.max_basket)
  );
  if (barem) return parseNumber(barem.cost_inc_vat);
  const cost = costs.find(item => item.carrier === carrier && parseNumber(item.desi_kg) === roundedDesi);
  return cost ? parseNumber(cost.cost_inc_vat) : 0;
}

function selectPackagingCost(desi, rules = []) {
  const roundedDesi = Math.ceil(parseNumber(desi));
  const rule = rules.find(
    item => roundedDesi >= parseNumber(item.min_desi) && roundedDesi <= parseNumber(item.max_desi)
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
  calculateNetProfit,
  calculateNetMargin,
  selectShippingCost,
  selectPackagingCost,
  isCostComplete
};
