const { parseNumber, roundMoney, parseBoolean } = require("../utils/numbers");
const { calculateNetProfit, calculateNetMargin } = require("./pricing");

const STRATEGY_FACTOR = {
  "Temkinli": 0.5,
  "Normal": 1,
  "Agresif": 1.5,
  "Kâr Koru": 0.5,
  "Buybox Odaklı": 1.25
};

function proposePrice(product, settings = {}) {
  const current = parseNumber(product.my_price);
  const minimum = Math.max(parseNumber(product.min_price), parseNumber(settings.minimum_price));
  const maximum = parseNumber(settings.maximum_price, Number.MAX_SAFE_INTEGER) || Number.MAX_SAFE_INTEGER;
  const cut = Math.max(parseNumber(settings.price_cut_tl, 0.1), parseNumber(settings.learned_price_cut_tl));
  const rank = parseNumber(product.rank, 0);
  let proposed = current;
  let reason = "Fiyat korunuyor";

  if (minimum > 0 && current < minimum) {
    const maxStep = Math.max(parseNumber(settings.max_increase_tl, 10), 0);
    proposed = Math.min(minimum, current + maxStep);
    reason = "Minimum fiyata güvenli toparlama";
  } else if (rank === 1 && parseNumber(product.second_price) > current) {
    proposed = parseNumber(product.second_price) - cut;
    reason = "Buybox korunarak ikinci fiyatın altına çıkış";
  } else if (rank > 1 && parseNumber(product.buybox_price) > 0) {
    proposed = parseNumber(product.buybox_price) - cut;
    reason = "Buybox fiyatının altına kontrollü iniş";
  }

  const strategy = settings.strategy || "Normal";
  if (strategy === "Manuel" || strategy === "Sadece İzle") proposed = current;
  proposed = Math.min(Math.max(roundMoney(proposed), minimum || 0), maximum);

  const action = proposed < current ? "FIYAT_DUSUR" : proposed > current
    ? (current < minimum ? "MIN_FIYATA_TOPARLA" : "FIYAT_ARTIR") : "KORU";
  const moneyInput={salePrice:proposed,commissionRate:product.commission_rate,productCost:product.calculated_product_cost,
    shippingCost:product.calculated_shipping_cost,packagingCost:product.packaging_cost,serviceFee:product.service_fee};

  return {
    action,
    currentPrice: current,
    oldPrice: current,
    proposedPrice: proposed,
    minPrice: minimum,
    maxPrice: maximum===Number.MAX_SAFE_INTEGER?null:maximum,
    buyboxPrice: parseNumber(product.buybox_price),
    secondPrice: parseNumber(product.second_price),
    thirdPrice: parseNumber(product.third_price),
    rank,
    baseUndercut: parseNumber(settings.price_cut_tl,0.1),
    learnedUndercut: parseNumber(settings.learned_price_cut_tl),
    effectiveUndercut: cut,
    expectedProfit: calculateNetProfit(moneyInput),
    expectedMargin: calculateNetMargin(moneyInput),
    difference: roundMoney(proposed - current),
    reason,
    humanReadableReason: reason,
    strategy,
    strategyFactor: STRATEGY_FACTOR[strategy] || 1,
    confidence: parseNumber(settings.confidence_score,0),
    expiresAt:new Date(Date.now()+15*60000).toISOString()
  };
}

function safetyCheck(context) {
  const { product, settings = {}, global = {}, proposal, today = {} } = context;
  const failures = [];
  const current = parseNumber(product.my_price);
  const proposed = parseNumber(proposal.proposedPrice);
  const minimum = Math.max(parseNumber(product.min_price), parseNumber(settings.minimum_price));
  const changePct = current > 0 ? (Math.abs(proposed - current) / current) * 100 : 100;
  const buyboxAgeMs = product.buybox_updated_at ? Date.now() - new Date(product.buybox_updated_at).getTime() : Infinity;

  if (!parseBoolean(product.is_active)) failures.push("PRODUCT_INACTIVE");
  if (!parseBoolean(product.on_sale)) failures.push("PRODUCT_NOT_ON_SALE");
  if (parseBoolean(product.locked)) failures.push("PRODUCT_LOCKED");
  if (parseNumber(product.stock_quantity) <= 0) failures.push("OUT_OF_STOCK");
  if (!parseBoolean(product.data_complete)) failures.push("COST_INCOMPLETE");
  if (parseNumber(product.commission_rate) <= 0) failures.push("COMMISSION_MISSING");
  if (minimum <= 0) failures.push("MIN_PRICE_MISSING");
  if (proposed < minimum) failures.push("BELOW_MIN_PRICE");
  if (current <= 0) failures.push("CURRENT_PRICE_INVALID");
  if (parseNumber(product.buybox_price)<=0 || !parseNumber(product.rank)) failures.push("BUYBOX_MISSING");
  if (buyboxAgeMs > parseNumber(global.buyboxMaxAgeMinutes, 20) * 60000) failures.push("BUYBOX_STALE");
  if (changePct > parseNumber(settings.max_daily_change_pct, global.maxChangePct || 15)) failures.push("DAILY_CHANGE_LIMIT");
  if (parseNumber(today.actionCount) >= parseNumber(settings.daily_action_limit, 3)) failures.push("DAILY_ACTION_LIMIT");
  if (parseBoolean(settings.blacklisted)) failures.push("BLACKLISTED");
  const autoUpdate=settings.auto_update===undefined?product.auto_update:settings.auto_update;
  if (!parseBoolean(autoUpdate)) failures.push("AUTO_UPDATE_DISABLED");
  if (!parseBoolean(global.repricerEnabled)) failures.push("GLOBAL_REPRICER_DISABLED");
  if (parseBoolean(global.dryRun)) failures.push("DRY_RUN");
  if (Math.abs(proposed - current) < parseNumber(global.minChangeTl, 0.1)) failures.push("CHANGE_TOO_SMALL");
  if (parseNumber(product.calculated_net_profit) < 0 && proposed < current) failures.push("LOSS_MAKING_DECREASE");
  if (parseNumber(proposal.expectedProfit)<0) failures.push("EXPECTED_LOSS");
  if (parseNumber(settings.minimum_margin_pct)>0&&parseNumber(proposal.expectedMargin)<parseNumber(settings.minimum_margin_pct))failures.push("MIN_MARGIN_VIOLATION");
  if(parseNumber(settings.maximum_price)>0&&proposed>parseNumber(settings.maximum_price))failures.push("ABOVE_MAX_PRICE");
  if (current < minimum && proposed < current) failures.push("BELOW_MIN_DECREASE");
  const cooldownMs = parseNumber(settings.min_change_interval_minutes, 30) * 60000;
  if (product.last_price_change_at && Date.now() - new Date(product.last_price_change_at).getTime() < cooldownMs) {
    failures.push("COOLDOWN_ACTIVE");
  }
  return { safe: failures.length === 0, failures, changePct: roundMoney(changePct) };
}

module.exports = { proposePrice, safetyCheck };
