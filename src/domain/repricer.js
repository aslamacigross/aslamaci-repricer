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

function recommendRankPrice({
  minimumPrice,
  competitorPrices = [],
  undercut = 0.1,
  fallbackPrice = 0,
}) {
  const minimum = Math.max(parseNumber(minimumPrice), 0);
  const cut = Math.max(parseNumber(undercut, 0.1), 0.01);
  const ranked = competitorPrices
    .slice(0, 3)
    .map((value) => parseNumber(value))
    .filter((value) => value > 0);
  for (let index = 0; index < ranked.length; index++) {
    const candidate = roundMoney(ranked[index] - cut);
    if (candidate >= minimum)
      return {
        status: "ECONOMIC_RANK_FOUND",
        targetRank: index + 1,
        proposedPrice: candidate,
        referencePrice: ranked[index],
        undercut: cut,
        reason: `${index + 1}. sıra minimum kâr korunarak hedeflenebilir`,
      };
  }
  if (ranked.length)
    return {
      status: "BUYBOX_TARGET_NOT_ECONOMIC",
      targetRank: null,
      proposedPrice: roundMoney(Math.max(minimum, parseNumber(fallbackPrice))),
      referencePrice: null,
      undercut: cut,
      reason: "Bilinen ilk üç sıra minimum fiyatın altında",
    };
  return {
    status: "MARKET_DATA_MISSING",
    targetRank: null,
    proposedPrice: roundMoney(Math.max(minimum, parseNumber(fallbackPrice))),
    referencePrice: null,
    undercut: cut,
    reason: "Buybox verisi yok; minimum fiyat ve referans fiyat kullanıldı",
  };
}

function effectiveIncreaseLimit(settings = {}) {
  if (parseBoolean(settings.unlimited_increase)) return Infinity;
  // Öğrenilen değer geçmiş gözlemdir; gelecekteki artışlar için sert tavan değildir.
  return Math.max(parseNumber(settings.max_increase_tl, 10), 0);
}

function applyStepLimits(current, target, settings = {}, options = {}) {
  if (current <= 0 || target === current) return target;
  const singlePct = Math.max(
    parseNumber(
      settings.max_single_change_pct,
      parseNumber(settings.max_daily_change_pct, 15),
    ),
    0,
  );
  if (target > current && options.directRankOneIncrease) return target;
  if (singlePct <= 0) return target;
  const lower = current * (1 - singlePct / 100);
  const upper = current * (1 + singlePct / 100);
  if (target < current) return Math.max(target, lower);
  if (parseBoolean(settings.unlimited_increase)) return target;
  return Math.min(target, upper, current + effectiveIncreaseLimit(settings));
}

function controlledIncreaseProbe(current, ceiling, settings = {}) {
  const available = Math.max(roundMoney(ceiling - current), 0);
  if (available <= 0) return current;
  const defaultStep = clamp(available * 0.2, 5, 20);
  const configuredPct = parseNumber(settings.max_single_change_pct);
  const reversibleLimit =
    configuredPct > 0 ? (current * configuredPct) / 100 : available;
  return roundMoney(
    Math.min(current + Math.min(defaultStep, reversibleLimit), ceiling),
  );
}

function aggregateSellerDiscount(source = {}) {
  const explicit = parseNumber(source.active_seller_discount);
  if (explicit > 0) return roundMoney(explicit);
  return roundMoney(
    parseNumber(source.product_coupon_discount) +
      parseNumber(source.basket_coupon_discount) +
      parseNumber(source.bundle_discount) +
      parseNumber(source.seller_campaign_discount),
  );
}

function aggregatePlatformDiscount(source = {}) {
  const explicit = parseNumber(source.trendyol_funded_discount);
  if (explicit > 0) return roundMoney(explicit);
  return roundMoney(
    parseNumber(source.platform_coupon_discount) +
      parseNumber(source.platform_campaign_discount),
  );
}

function campaignEconomics(product = {}, settings = {}, listPrice, baseMinimum) {
  const merged = { ...product, ...settings };
  const activeSellerDiscount = aggregateSellerDiscount(merged);
  const trendyolFundedDiscount = aggregatePlatformDiscount(merged);
  const sellerSettlementPrice = roundMoney(
    Math.max(parseNumber(listPrice) - activeSellerDiscount, 0),
  );
  const effectiveCustomerPrice = roundMoney(
    Math.max(sellerSettlementPrice - trendyolFundedDiscount, 0),
  );
  return {
    activeSellerDiscount,
    trendyolFundedDiscount,
    campaignAdjustedMinPrice: roundMoney(
      Math.max(parseNumber(baseMinimum), 0) + activeSellerDiscount,
    ),
    sellerSettlementPrice,
    effectiveCandidatePrice: sellerSettlementPrice,
    effectiveCustomerPrice,
  };
}

function isBuyboxFresh(product = {}, settings = {}) {
  if (!product.buybox_updated_at) return false;
  const observedAt = new Date(product.buybox_updated_at).getTime();
  if (!Number.isFinite(observedAt)) return false;
  const maxAgeMinutes = Math.max(
    parseNumber(
      settings.buybox_max_age_minutes,
      parseNumber(settings.buyboxMaxAgeMinutes, 20),
    ),
    1,
  );
  const ageMs = Date.now() - observedAt;
  return ageMs >= 0 && ageMs <= maxAgeMinutes * 60000;
}

function buildResult({
  product,
  settings,
  current,
  proposed,
  baseMinimum,
  maximum,
  rank,
  targetRank,
  reason,
  obstacle,
  effectiveCut,
  limitedBy,
  strategy,
  factor,
}) {
  const economics = campaignEconomics(
    product,
    settings,
    proposed,
    baseMinimum,
  );
  const moneyInput = {
    salePrice: economics.sellerSettlementPrice,
    commissionRate: product.commission_rate,
    productCost: product.calculated_product_cost,
    shippingCost: product.calculated_shipping_cost,
    packagingCost: product.packaging_cost,
    serviceFee: product.service_fee,
  };
  const expectedProfit = calculateNetProfit(moneyInput);
  const expectedMargin = calculateNetMargin(moneyInput);
  const action =
    proposed < current
      ? "FIYAT_DUSUR"
      : proposed > current
        ? current < economics.campaignAdjustedMinPrice
          ? "MIN_FIYATA_TOPARLA"
          : "FIYAT_ARTIR"
        : "KORU";

  return {
    action,
    currentPrice: current,
    oldPrice: current,
    proposedPrice: proposed,
    minPrice: baseMinimum,
    campaignAdjustedMinPrice: economics.campaignAdjustedMinPrice,
    sellerSettlementPrice: economics.sellerSettlementPrice,
    effectiveCandidatePrice: economics.effectiveCandidatePrice,
    effectiveCustomerPrice: economics.effectiveCustomerPrice,
    activeSellerDiscount: economics.activeSellerDiscount,
    trendyolFundedDiscount: economics.trendyolFundedDiscount,
    maxPrice: maximum === Number.MAX_SAFE_INTEGER ? null : maximum,
    buyboxPrice: parseNumber(product.buybox_price),
    secondPrice: parseNumber(product.second_price),
    thirdPrice: parseNumber(product.third_price),
    buyboxGap: roundMoney(current - parseNumber(product.buybox_price)),
    rank,
    targetRank,
    baseUndercut: parseNumber(settings.price_cut_tl, 0.1),
    learnedUndercut: parseNumber(settings.learned_price_cut_tl),
    effectiveUndercut: effectiveCut,
    effectiveMaxIncrease: effectiveIncreaseLimit(settings),
    expectedProfit,
    estimatedProfitAfterAction: expectedProfit,
    expectedMargin,
    difference: roundMoney(proposed - current),
    actionDelta: roundMoney(proposed - current),
    reason,
    humanReadableReason: reason,
    obstacle,
    strategy,
    strategyFactor: factor,
    limitedBy,
    confidence: parseNumber(settings.confidence_score, 0),
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  };
}

function proposePrice(product, settings = {}) {
  const current = parseNumber(product.my_price);
  const baseMinimum = Math.max(
    parseNumber(product.min_price),
    parseNumber(settings.minimum_price),
  );
  const maximum =
    parseNumber(settings.maximum_price, Number.MAX_SAFE_INTEGER) ||
    Number.MAX_SAFE_INTEGER;
  const rank = parseNumber(product.rank, 0);
  const strategy = settings.strategy || "Normal";
  const factor = STRATEGY_FACTOR[strategy] || 1;
  const minCut = Math.max(parseNumber(settings.min_undercut_tl, 0.1), 0.01);
  const maxCut = Math.max(parseNumber(settings.max_undercut_tl, 75), minCut);
  const acquisitionCut = clamp(
    parseNumber(settings.price_cut_tl, 0.1) * factor,
    minCut,
    maxCut,
  );
  const currentEconomics = campaignEconomics(
    product,
    settings,
    current,
    baseMinimum,
  );
  const adjustedMinimum = currentEconomics.campaignAdjustedMinPrice;
  let proposed = current;
  let targetRank = rank || null;
  let reason = "Fiyat korunuyor";
  let obstacle = null;
  let limitedBy = null;
  let effectiveCut = acquisitionCut;
  let directRankOneIncrease = false;

  if (!parseBoolean(product.data_complete)) {
    obstacle = "COST_INCOMPLETE";
    reason = "Maliyet verisi eksik; buybox aksiyonu engellendi";
  } else if (strategy === "Manuel" || strategy === "Sadece İzle") {
    reason = "Ürün izleme veya manuel modda; fiyat korunuyor";
  } else if (parseNumber(product.buybox_price) <= 0 || rank <= 0) {
    obstacle = "BUYBOX_MISSING";
    reason = "Buybox verisi eksik; fiyat değişikliği yapılmadı";
  } else if (!isBuyboxFresh(product, settings)) {
    obstacle = "BUYBOX_STALE";
    reason = "Buybox verisi yenilenemedi; fiyat değişikliği yapılmadı";
  } else if (current < adjustedMinimum) {
    proposed = adjustedMinimum;
    reason =
      "Aktif satıcı indirimleri sonrası minimum fiyata güvenli toparlama";
  } else if (rank > 1) {
    const buyboxPrice = parseNumber(product.buybox_price);
    if (current <= buyboxPrice + 0.009) {
      obstacle = "BUYBOX_INCONSISTENT";
      reason =
        "Mevcut fiyat buybox fiyatından düşük olmasına rağmen sıra kazanılmadı; fiyat dışı buybox kriterleri kontrol edilmeli";
    } else {
      const candidate = roundMoney(buyboxPrice - acquisitionCut);
      if (candidate < adjustedMinimum) {
        obstacle = "BUYBOX_NOT_ECONOMIC";
        reason =
          "Buybox fiyatı aktif kampanyalar sonrası minimum kârlı fiyatın altında";
      } else {
        proposed = candidate;
        targetRank = 1;
        reason = "Minimum kâr korunarak 1. sıraya geçiş";
      }
    }
  } else if (rank === 1) {
    const secondPrice = parseNumber(product.second_price);
    const holdBuffer = Math.max(
      parseNumber(settings.buybox_hold_buffer_tl, 1),
      0.01,
    );
    const ceiling =
      secondPrice > 0 ? roundMoney(secondPrice - holdBuffer) : current;
    if (ceiling > current) {
      proposed = ceiling;
      targetRank = 1;
      effectiveCut = holdBuffer;
      directRankOneIncrease = true;
      limitedBy = "BUYBOX_PIYASA_DUZELTMESI";
      reason = "Buybox korunarak 2. fiyatın hemen altına kâr artışı";
    }
  }

  proposed = roundMoney(Math.min(Math.max(proposed, 0), maximum));
  const beforeStepLimit = proposed;
  proposed = applyStepLimits(current, proposed, settings, {
    directRankOneIncrease,
  });
  if (roundMoney(beforeStepLimit) !== roundMoney(proposed)) {
    limitedBy = proposed > current ? "KADEMELI_ARTIS" : "KADEMELI_DUSUS";
    reason = `${reason}; tek işlem değişim adımı uygulandı`;
  }
  proposed = roundMoney(Math.min(Math.max(proposed, 0), maximum));

  return buildResult({
    product,
    settings,
    current,
    proposed,
    baseMinimum,
    maximum,
    rank,
    targetRank,
    reason,
    obstacle,
    effectiveCut,
    limitedBy,
    strategy,
    factor,
  });
}

function safetyCheck(context) {
  const { product, settings = {}, global = {}, proposal, today = {} } = context;
  const manual = parseBoolean(context.manual);
  const automaticRecovery = parseBoolean(context.automaticRecovery);
  const failures = [];
  const current = parseNumber(product.my_price);
  const proposed = parseNumber(proposal.proposedPrice);
  const rank = parseNumber(product.rank);
  const economics = campaignEconomics(
    product,
    settings,
    proposed,
    Math.max(
      parseNumber(product.min_price),
      parseNumber(settings.minimum_price),
    ),
  );
  const minimum = Math.max(
    parseNumber(proposal.campaignAdjustedMinPrice),
    economics.campaignAdjustedMinPrice,
  );
  const recovery = current < minimum && proposed > current;
  const productMaxSingle = parseNumber(
    settings.max_single_change_pct,
    parseNumber(global.maxChangePct, Infinity),
  );
  const maxSingleChangePct = productMaxSingle > 0 ? productMaxSingle : Infinity;
  const changePct =
    current > 0 ? (Math.abs(proposed - current) / current) * 100 : 100;
  const dayStartPrice = parseNumber(today.dayStartPrice, current);
  const dailyNetChangePct =
    dayStartPrice > 0
      ? (Math.abs(proposed - dayStartPrice) / dayStartPrice) * 100
      : changePct;

  if (proposal.obstacle) failures.push(proposal.obstacle);
  if (!parseBoolean(product.is_active)) failures.push("PRODUCT_INACTIVE");
  if (!parseBoolean(product.on_sale)) failures.push("PRODUCT_NOT_ON_SALE");
  if (parseBoolean(product.locked)) failures.push("PRODUCT_LOCKED");
  if (parseNumber(product.stock_quantity) <= 0) failures.push("OUT_OF_STOCK");
  if (!parseBoolean(product.data_complete)) failures.push("COST_INCOMPLETE");
  if (parseNumber(product.commission_rate) <= 0)
    failures.push("COMMISSION_MISSING");
  if (minimum <= 0) failures.push("MIN_PRICE_MISSING");
  if (proposed < minimum && proposed !== current && !recovery)
    failures.push("BELOW_MIN_PRICE");
  if (current <= 0) failures.push("CURRENT_PRICE_INVALID");
  if (parseNumber(product.buybox_price) <= 0 || !rank)
    failures.push("BUYBOX_MISSING");
  if (
    !isBuyboxFresh(product, {
      ...settings,
      buyboxMaxAgeMinutes: global.buyboxMaxAgeMinutes,
    })
  )
    failures.push("BUYBOX_STALE");
  if (proposed < current && changePct > maxSingleChangePct)
    failures.push("SINGLE_CHANGE_LIMIT");
  if (
    !automaticRecovery &&
    parseNumber(today.actionCount) >=
      parseNumber(settings.daily_action_limit, 3)
  )
    failures.push("DAILY_ACTION_LIMIT");
  if (parseBoolean(settings.blacklisted)) failures.push("BLACKLISTED");
  const autoUpdate =
    settings.auto_update === undefined
      ? product.auto_update
      : settings.auto_update;
  if (!manual && !parseBoolean(autoUpdate))
    failures.push("AUTO_UPDATE_DISABLED");
  if (!manual && !parseBoolean(global.repricerEnabled))
    failures.push("GLOBAL_REPRICER_DISABLED");
  if (parseBoolean(global.dryRun)) failures.push("DRY_RUN");

  const delta = Math.abs(proposed - current);
  const platformMinimum = Math.max(
    parseNumber(global.platformMinPriceChangeTl, 0.01),
    0.01,
  );
  if (delta > 0 && delta + 0.0001 < platformMinimum)
    failures.push("CHANGE_TOO_SMALL");
  if (rank > 1 && proposed > current)
    failures.push("RANK_OUTSIDE_BUYBOX_INCREASE_FORBIDDEN");
  if (parseNumber(product.calculated_net_profit) < 0 && proposed < current)
    failures.push("LOSS_MAKING_DECREASE");
  if (parseNumber(proposal.expectedProfit) < 0 && !recovery)
    failures.push("EXPECTED_LOSS");
  if (
    proposal.limitedBy !== "BUYBOX_PIYASA_DUZELTMESI" &&
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
    !automaticRecovery &&
    product.last_price_change_at &&
    Date.now() - new Date(product.last_price_change_at).getTime() < cooldownMs
  )
    failures.push("COOLDOWN_ACTIVE");

  const uniqueFailures = [...new Set(failures)];
  return {
    safe: uniqueFailures.length === 0,
    failures: uniqueFailures,
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
  controlledIncreaseProbe,
  recommendRankPrice,
  campaignEconomics,
  isBuyboxFresh,
};
