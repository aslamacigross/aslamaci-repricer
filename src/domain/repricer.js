const { parseNumber, roundMoney, parseBoolean } = require("../utils/numbers");
const { calculateNetProfit, calculateNetMargin } = require("./pricing");

const STRATEGY_FACTOR = {
  Temkinli: 0.75,
  Normal: 1,
  Agresif: 1.5,
  "Kâr Koru": 1,
  "Buybox Odaklı": 1.25,
  "Öğrenen Pilot": 1,
};

function visibleRankPrice(product, rank) {
  if (rank === 1) return parseNumber(product.buybox_price);
  if (rank === 2) return parseNumber(product.second_price);
  if (rank === 3) return parseNumber(product.third_price);
  return 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function effectiveIncreaseLimit(settings) {
  if (parseBoolean(settings.unlimited_increase)) return Infinity;
  const configured = Math.max(parseNumber(settings.max_increase_tl, 10), 0);
  const learned = parseNumber(settings.learned_max_increase_tl);
  return learned > 0 ? Math.min(configured, learned) : configured;
}

function applyStepLimits(current, target, settings) {
  if (current <= 0 || target === current) return target;
  const singlePct = Math.max(
    parseNumber(
      settings.max_single_change_pct,
      parseNumber(settings.max_daily_change_pct, 15),
    ),
    0,
  );
  const lower = current * (1 - singlePct / 100);
  const upper = current * (1 + singlePct / 100);
  if (target < current) return Math.max(target, lower);
  if (parseBoolean(settings.unlimited_increase)) return target;
  return Math.min(target, upper, current + effectiveIncreaseLimit(settings));
}

function proposePrice(product, settings = {}) {
  const current = parseNumber(product.my_price);
  const minimum = Math.max(
    parseNumber(product.min_price),
    parseNumber(settings.minimum_price),
  );
  const maximum =
    parseNumber(settings.maximum_price, Number.MAX_SAFE_INTEGER) ||
    Number.MAX_SAFE_INTEGER;
  const baseCut = Math.max(
    parseNumber(settings.price_cut_tl, 0.1),
    parseNumber(settings.learned_price_cut_tl),
  );
  const rank = parseNumber(product.rank, 0);
  const strategy = settings.strategy || "Normal";
  const factor = STRATEGY_FACTOR[strategy] || 1;
  const minCut = Math.max(parseNumber(settings.min_undercut_tl, 0.1), 0.01);
  const maxCut = Math.max(parseNumber(settings.max_undercut_tl, 75), minCut);
  const cut = clamp(baseCut * factor, minCut, maxCut);
  let proposed = current;
  let targetRank = rank || null;
  let reason = "Fiyat korunuyor";
  let limitedBy = null;

  if (minimum > 0 && current < minimum) {
    proposed = minimum;
    reason = "Minimum fiyata güvenli toparlama";
  } else if (strategy !== "Manuel" && strategy !== "Sadece İzle" && rank > 0) {
    const firstRankToTry = strategy === "Kâr Koru" ? rank : 1;
    const bestKnownRank = Math.min(rank, 3);
    let upperRankBlocked = false;
    let found = false;
    for (
      let candidateRank = firstRankToTry;
      candidateRank <= bestKnownRank;
      candidateRank++
    ) {
      if (candidateRank === rank) {
        const nextRankPrice = visibleRankPrice(product, rank + 1);
        const currentRankMaximum = nextRankPrice > 0 ? nextRankPrice - cut : 0;
        if (currentRankMaximum > current) {
          proposed = currentRankMaximum;
          reason = upperRankBlocked
            ? `${rank}. sırada mümkün olan en yüksek kâr`
            : "Mevcut sıra korunarak mümkün olan en yüksek kâr";
        } else if (upperRankBlocked) {
          reason = "Üst sıra minimum fiyatın altında; mevcut sıra korunuyor";
        }
        targetRank = rank;
        found = true;
        break;
      }
      const visiblePrice = visibleRankPrice(product, candidateRank);
      if (visiblePrice <= 0) continue;
      const target = visiblePrice - cut;
      if (minimum > 0 && target < minimum) {
        upperRankBlocked = true;
        continue;
      }
      proposed = target;
      targetRank = candidateRank;
      reason = `${candidateRank}. sıraya kontrollü geçiş`;
      found = true;
      break;
    }
    if (!found && upperRankBlocked)
      reason = "Bilinen üst sıralar minimum fiyatın altında";
  }

  if (strategy === "Manuel" || strategy === "Sadece İzle") {
    proposed = current;
    targetRank = rank || null;
  }
  proposed = Math.min(Math.max(proposed, 0), maximum);
  const beforeStepLimit = proposed;
  proposed = applyStepLimits(current, proposed, settings);
  if (roundMoney(beforeStepLimit) !== roundMoney(proposed)) {
    limitedBy = proposed > current ? "KADEMELI_ARTIS" : "KADEMELI_DUSUS";
    reason = `${reason}; tek işlem değişim adımı uygulandı`;
  }
  if (!(current < minimum && proposed > current))
    proposed = Math.max(proposed, minimum || 0);
  proposed = roundMoney(Math.min(proposed, maximum));

  const action =
    proposed < current
      ? "FIYAT_DUSUR"
      : proposed > current
        ? current < minimum
          ? "MIN_FIYATA_TOPARLA"
          : "FIYAT_ARTIR"
        : "KORU";
  const moneyInput = {
    salePrice: proposed,
    commissionRate: product.commission_rate,
    productCost: product.calculated_product_cost,
    shippingCost: product.calculated_shipping_cost,
    packagingCost: product.packaging_cost,
    serviceFee: product.service_fee,
  };

  return {
    action,
    currentPrice: current,
    oldPrice: current,
    proposedPrice: proposed,
    minPrice: minimum,
    maxPrice: maximum === Number.MAX_SAFE_INTEGER ? null : maximum,
    buyboxPrice: parseNumber(product.buybox_price),
    secondPrice: parseNumber(product.second_price),
    thirdPrice: parseNumber(product.third_price),
    rank,
    targetRank,
    baseUndercut: parseNumber(settings.price_cut_tl, 0.1),
    learnedUndercut: parseNumber(settings.learned_price_cut_tl),
    effectiveUndercut: cut,
    effectiveMaxIncrease: effectiveIncreaseLimit(settings),
    expectedProfit: calculateNetProfit(moneyInput),
    expectedMargin: calculateNetMargin(moneyInput),
    difference: roundMoney(proposed - current),
    reason,
    humanReadableReason: reason,
    strategy,
    strategyFactor: factor,
    limitedBy,
    confidence: parseNumber(settings.confidence_score, 0),
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  };
}

function safetyCheck(context) {
  const { product, settings = {}, global = {}, proposal, today = {} } = context;
  const manual = parseBoolean(context.manual);
  const failures = [];
  const current = parseNumber(product.my_price);
  const proposed = parseNumber(proposal.proposedPrice);
  const minimum = Math.max(
    parseNumber(product.min_price),
    parseNumber(settings.minimum_price),
  );
  const recovery = current < minimum && proposed > current;
  const productMaxDaily = parseNumber(settings.max_daily_change_pct, Infinity);
  const productMaxSingle = parseNumber(
    settings.max_single_change_pct,
    productMaxDaily,
  );
  const globalMaxDaily = parseNumber(
    global.maxDailyDecreasePct,
    parseNumber(global.maxChangePct, 5),
  );
  const maxDailyChangePct = Math.min(productMaxDaily, globalMaxDaily);
  const maxSingleChangePct = Math.min(productMaxSingle, globalMaxDaily);
  const changePct =
    current > 0 ? (Math.abs(proposed - current) / current) * 100 : 100;
  const dayStartPrice = parseNumber(today.dayStartPrice, current);
  const dailyNetChangePct =
    dayStartPrice > 0
      ? (Math.abs(proposed - dayStartPrice) / dayStartPrice) * 100
      : changePct;
  const buyboxAgeMs = product.buybox_updated_at
    ? Date.now() - new Date(product.buybox_updated_at).getTime()
    : Infinity;

  if (!parseBoolean(product.is_active)) failures.push("PRODUCT_INACTIVE");
  if (!parseBoolean(product.on_sale)) failures.push("PRODUCT_NOT_ON_SALE");
  if (parseBoolean(product.locked)) failures.push("PRODUCT_LOCKED");
  if (parseNumber(product.stock_quantity) <= 0) failures.push("OUT_OF_STOCK");
  if (!parseBoolean(product.data_complete)) failures.push("COST_INCOMPLETE");
  if (parseNumber(product.commission_rate) <= 0)
    failures.push("COMMISSION_MISSING");
  if (minimum <= 0) failures.push("MIN_PRICE_MISSING");
  if (proposed < minimum && !recovery) failures.push("BELOW_MIN_PRICE");
  if (current <= 0) failures.push("CURRENT_PRICE_INVALID");
  if (parseNumber(product.buybox_price) <= 0 || !parseNumber(product.rank))
    failures.push("BUYBOX_MISSING");
  if (buyboxAgeMs > parseNumber(global.buyboxMaxAgeMinutes, 20) * 60000)
    failures.push("BUYBOX_STALE");
  if (proposed < current && changePct > maxSingleChangePct)
    failures.push("SINGLE_CHANGE_LIMIT");
  if (proposed < dayStartPrice && dailyNetChangePct > maxDailyChangePct)
    failures.push("DAILY_CHANGE_LIMIT");
  if (
    parseNumber(today.actionCount) >=
    parseNumber(settings.daily_action_limit, 3)
  )
    failures.push("DAILY_ACTION_LIMIT");
  if (parseBoolean(settings.blacklisted)) failures.push("BLACKLISTED");
  if (!manual && parseBoolean(settings.learning_paused))
    failures.push("LEARNING_PAUSED");
  const autoUpdate =
    settings.auto_update === undefined
      ? product.auto_update
      : settings.auto_update;
  if (!manual && !parseBoolean(autoUpdate))
    failures.push("AUTO_UPDATE_DISABLED");
  if (!manual && !parseBoolean(global.repricerEnabled))
    failures.push("GLOBAL_REPRICER_DISABLED");
  if (parseBoolean(global.dryRun)) failures.push("DRY_RUN");
  if (Math.abs(proposed - current) < parseNumber(global.minChangeTl, 0.1))
    failures.push("CHANGE_TOO_SMALL");
  if (parseNumber(product.calculated_net_profit) < 0 && proposed < current)
    failures.push("LOSS_MAKING_DECREASE");
  if (parseNumber(proposal.expectedProfit) < 0 && !recovery)
    failures.push("EXPECTED_LOSS");
  if (
    !parseBoolean(settings.unlimited_increase) &&
    proposed > current &&
    proposed - current > effectiveIncreaseLimit(settings) + 0.009
  )
    failures.push("MAX_INCREASE_LIMIT");
  if (
    parseNumber(settings.minimum_profit_tl) > 0 &&
    parseNumber(proposal.expectedProfit) <
      parseNumber(settings.minimum_profit_tl) &&
    !recovery
  )
    failures.push("MIN_PROFIT_TL_VIOLATION");
  const costBase =
    parseNumber(product.calculated_product_cost) +
    parseNumber(product.calculated_shipping_cost) +
    parseNumber(product.packaging_cost) +
    parseNumber(product.service_fee);
  const expectedProfitPct =
    costBase > 0 ? (parseNumber(proposal.expectedProfit) / costBase) * 100 : 0;
  if (
    parseNumber(settings.minimum_profit_pct) > 0 &&
    expectedProfitPct < parseNumber(settings.minimum_profit_pct) &&
    !recovery
  )
    failures.push("MIN_PROFIT_PCT_VIOLATION");
  if (
    parseNumber(settings.minimum_margin_pct) > 0 &&
    parseNumber(proposal.expectedMargin) <
      parseNumber(settings.minimum_margin_pct)
  )
    failures.push("MIN_MARGIN_VIOLATION");
  if (
    parseNumber(settings.maximum_price) > 0 &&
    proposed > parseNumber(settings.maximum_price)
  )
    failures.push("ABOVE_MAX_PRICE");
  if (current < minimum && proposed < current)
    failures.push("BELOW_MIN_DECREASE");
  const cooldownMs =
    parseNumber(settings.min_change_interval_minutes, 30) * 60000;
  if (
    product.last_price_change_at &&
    Date.now() - new Date(product.last_price_change_at).getTime() < cooldownMs
  ) {
    failures.push("COOLDOWN_ACTIVE");
  }
  return {
    safe: failures.length === 0,
    failures,
    changePct: roundMoney(changePct),
    dailyNetChangePct: roundMoney(dailyNetChangePct),
    expectedProfitPct: roundMoney(expectedProfitPct),
    recovery,
    manual,
  };
}

module.exports = {
  proposePrice,
  safetyCheck,
  visibleRankPrice,
  effectiveIncreaseLimit,
};
