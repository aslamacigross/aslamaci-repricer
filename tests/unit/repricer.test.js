const test = require("node:test");
const assert = require("node:assert/strict");
const {
  proposePrice,
  safetyCheck,
  recommendRankPrice,
} = require("../../src/domain/repricer");
const { RepricerService } = require("../../src/services/repricer.service");
const base = {
  is_active: true,
  on_sale: true,
  locked: false,
  stock_quantity: 10,
  data_complete: true,
  commission_rate: 17,
  min_price: 805,
  my_price: 944,
  buybox_price: 950,
  second_price: 949,
  third_price: 960,
  rank: 2,
  buybox_updated_at: new Date().toISOString(),
  calculated_net_profit: 155,
  calculated_product_cost: 448,
  calculated_shipping_cost: 141.96,
  packaging_cost: 25,
  service_fee: 13.19,
  auto_update: true,
};
const settings = {
  strategy: "Normal",
  price_cut_tl: 11,
  max_increase_tl: 100,
  max_single_change_pct: 15,
  max_daily_change_pct: 15,
  daily_action_limit: 3,
  min_change_interval_minutes: 0,
  auto_update: true,
};
test("fiyat yonu etiketi matematikle daima uyumludur", () => {
  const down = proposePrice({ ...base, second_price: base.my_price }, settings);
  assert.equal(down.proposedPrice, 939);
  assert.equal(down.action, "FIYAT_DUSUR");
  const up = proposePrice(
    { ...base, my_price: 900, rank: 1, second_price: 950 },
    { ...settings, price_cut_tl: 1 },
  );
  assert.equal(up.proposedPrice, 909.98);
  assert.equal(up.action, "FIYAT_ARTIR");
  const keep = proposePrice(base, { ...settings, strategy: "Manuel" });
  assert.equal(keep.proposedPrice, 944);
  assert.equal(keep.action, "KORU");
});
test("minimum fiyat altina onermez", () => {
  const result = proposePrice(
    { ...base, min_price: 940, buybox_price: 930 },
    settings,
  );
  assert.ok(result.proposedPrice >= 940);
});
test("birinci sira minimum altindaysa mevcut sirada maksimum kari arar", () => {
  const result = proposePrice(
    {
      ...base,
      my_price: 944,
      min_price: 940,
      buybox_price: 930,
      second_price: 944,
      third_price: 1000,
      rank: 2,
    },
    { ...settings, price_cut_tl: 1 },
  );
  assert.equal(result.targetRank, 2);
  assert.equal(result.proposedPrice, 955.18);
  assert.equal(result.action, "FIYAT_ARTIR");
});
test("ucuncu siradan ekonomik olan en iyi bilinen siraya cikar", () => {
  const result = proposePrice(
    {
      ...base,
      my_price: 950,
      min_price: 940,
      buybox_price: 930,
      second_price: 970,
      third_price: 980,
      rank: 3,
    },
    { ...settings, price_cut_tl: 1 },
  );
  assert.equal(result.targetRank, 2);
  assert.equal(result.proposedPrice, 969);
});
test("gorunen buybox altinda kalip sira alamazsa ek kontrollu fiyat kirar", () => {
  const result = proposePrice(
    {
      ...base,
      my_price: 831.07,
      min_price: 733.61,
      buybox_price: 836.07,
      second_price: 831.07,
      third_price: 1742.5,
      rank: 2,
    },
    { ...settings, price_cut_tl: 5 },
  );
  assert.equal(result.targetRank, 1);
  assert.equal(result.proposedPrice, 826.07);
  assert.equal(result.action, "FIYAT_DUSUR");
  assert.match(result.reason, /görünmeyen avantaj/);
});
test("buybox fiyati ustte gorunse bile rank alinmadiysa mevcut fiyattan kirar", () => {
  const result = proposePrice(
    {
      ...base,
      my_price: 769.95,
      min_price: 733.61,
      buybox_price: 794.43,
      second_price: 849.99,
      third_price: 1259.99,
      rank: 2,
    },
    { ...settings, price_cut_tl: 5 },
  );
  assert.equal(result.targetRank, 2);
  assert.equal(result.proposedPrice, 769.95);
  assert.equal(result.action, "KORU");
  assert.equal(result.blockerCode, "RANK_PRICE_INCONSISTENT");
  assert.match(result.reason, /fiyatı mevcut fiyatla tutarsız/);
});
test("artis ve dusus tek turda guvenli adimlarla sinirlanir", () => {
  const increase = proposePrice(
    { ...base, my_price: 900, rank: 1, second_price: 1000 },
    { ...settings, price_cut_tl: 1, max_increase_tl: 10 },
  );
  assert.equal(increase.proposedPrice, 910);
  assert.equal(increase.limitedBy, "KADEMELI_ARTIS");
  const decrease = proposePrice(
    { ...base, my_price: 1000, min_price: 500, rank: 2, buybox_price: 700 },
    { ...settings, price_cut_tl: 1, max_daily_change_pct: 15 },
  );
  assert.equal(decrease.proposedPrice, 850);
  assert.equal(decrease.limitedBy, "KADEMELI_DUSUS");
});
test("tek islem limiti sifirsa minimum fiyat korunarak hedefe tek seferde gider", () => {
  const product = {
    ...base,
    my_price: 1000,
    min_price: 500,
    rank: 2,
    buybox_price: 700,
  };
  const proposal = proposePrice(product, {
    ...settings,
    price_cut_tl: 1,
    max_single_change_pct: 0,
  });
  assert.equal(proposal.proposedPrice, 699);
  assert.equal(proposal.limitedBy, null);
  const safety = safetyCheck({
    product,
    settings: { ...settings, max_single_change_pct: 0 },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 0,
      minChangeTl: 0.1,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 1000 },
  });
  assert.ok(!safety.failures.includes("SINGLE_CHANGE_LIMIT"));
});
test("tek islem limiti uygulanir, gunluk toplam degisim limiti bloklamaz", () => {
  const stepped = proposePrice(
    { ...base, my_price: 1000, min_price: 500, rank: 2, buybox_price: 700 },
    {
      ...settings,
      price_cut_tl: 1,
      max_single_change_pct: 5,
      max_daily_change_pct: 20,
    },
  );
  assert.equal(stepped.proposedPrice, 950);

  const result = safetyCheck({
    product: base,
    settings: {
      ...settings,
      max_single_change_pct: 15,
      max_daily_change_pct: 5,
    },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      maxDailyDecreasePct: 5,
      minChangeTl: 0.1,
    },
    proposal: proposePrice(base, settings),
    today: { actionCount: 0, dayStartPrice: 1000 },
  });
  assert.ok(!result.failures.includes("DAILY_CHANGE_LIMIT"));
  assert.ok(!result.failures.includes("SINGLE_CHANGE_LIMIT"));

  const wideMoveProposal = proposePrice(
    { ...base, my_price: 1000, min_price: 500, rank: 2, buybox_price: 850 },
    { ...settings, price_cut_tl: 1, max_single_change_pct: 20 },
  );
  const wideMove = safetyCheck({
    product: { ...base, my_price: 1000, min_price: 500, buybox_price: 850 },
    settings: { ...settings, max_single_change_pct: 20 },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 20,
      maxDailyDecreasePct: 5,
      minChangeTl: 0.1,
    },
    proposal: wideMoveProposal,
    today: { actionCount: 0, dayStartPrice: 1000 },
  });
  assert.ok(!wideMove.failures.includes("DAILY_CHANGE_LIMIT"));
  assert.ok(!wideMove.failures.includes("SINGLE_CHANGE_LIMIT"));
});
test("yukari yonlu fiyat artisi limitsiz ayarda yuzde limitine takilmaz", () => {
  const product = {
    ...base,
    my_price: 900,
    rank: 1,
    buybox_price: 900,
    second_price: 1300,
  };
  const proposal = proposePrice(product, {
    ...settings,
    price_cut_tl: 1,
    max_single_change_pct: 5,
    max_daily_change_pct: 5,
    unlimited_increase: true,
  });
  assert.equal(proposal.proposedPrice, 920);
  const result = safetyCheck({
    product,
    settings: { ...settings, unlimited_increase: true },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 5,
      maxDailyDecreasePct: 5,
      unlimitedIncrease: true,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 900 },
  });
  assert.ok(!result.failures.includes("DAILY_CHANGE_LIMIT"));
  assert.ok(!result.failures.includes("SINGLE_CHANGE_LIMIT"));
});
test("buybox bizdeyken limitsiz artis eski sifir urun limitine takilmaz", () => {
  const proposal = proposePrice(
    {
      ...base,
      my_price: 638.44,
      min_price: 500,
      buybox_price: 638.44,
      second_price: 713.44,
      rank: 1,
    },
    {
      ...settings,
      price_cut_tl: 5,
      max_increase_tl: 0,
      max_single_change_pct: 0,
      unlimited_increase: true,
    },
  );
  assert.equal(proposal.proposedPrice, 653.42);
  assert.equal(proposal.action, "FIYAT_ARTIR");
  assert.equal(proposal.difference, 14.98);
  assert.equal(proposal.limitedBy, "BUYBOX_KAR_YOKLAMASI");
});
test("buybox bizdeyken eski yuksek fiyat kirma degeri kar artisini engellemez", () => {
  const proposal = proposePrice(
    {
      ...base,
      my_price: 492.89,
      min_price: 449.68,
      buybox_price: 492.89,
      second_price: 499,
      rank: 1,
    },
    { ...settings, price_cut_tl: 75, min_undercut_tl: 0.1 },
  );
  assert.equal(proposal.proposedPrice, 497.89);
  assert.equal(proposal.action, "FIYAT_ARTIR");
  assert.equal(proposal.effectiveUndercut, 0.1);
});
test("rank1 +4 TL kontrollu kar yoklamasi change too small engeline takilmaz", () => {
  const product = {
    ...base,
    my_price: 500,
    min_price: 400,
    buybox_price: 500,
    second_price: 520,
    rank: 1,
  };
  const proposal = {
    ...proposePrice(product, { ...settings, price_cut_tl: 5 }),
    proposedPrice: 504,
    targetRank: 1,
    expectedProfit: 100,
    expectedMargin: 10,
    limitedBy: "BUYBOX_KAR_YOKLAMASI",
  };
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("rank1 mikro kontrollu kar yoklamasi change too small engeline takilir", () => {
  const product = {
    ...base,
    my_price: 500,
    min_price: 400,
    buybox_price: 500,
    second_price: 520,
    rank: 1,
  };
  const proposal = {
    ...proposePrice(product, { ...settings, price_cut_tl: 5 }),
    proposedPrice: 500.5,
    targetRank: 1,
    expectedProfit: 100,
    expectedMargin: 10,
    limitedBy: "BUYBOX_KAR_YOKLAMASI",
  };
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.ok(safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("rank2 kontrollu kar yoklamasi recovery olmadigi icin change too small engeline takilir", () => {
  const product = {
    ...base,
    my_price: 500,
    min_price: 400,
    buybox_price: 490,
    second_price: 500,
    third_price: 530,
    rank: 2,
  };
  const proposal = {
    ...proposePrice(product, { ...settings, price_cut_tl: 5 }),
    proposedPrice: 504,
    targetRank: 2,
    expectedProfit: 100,
    expectedMargin: 10,
    limitedBy: "BUYBOX_KAR_YOKLAMASI",
  };
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.ok(safety.failures.includes("CHANGE_TOO_SMALL"));
});
test("buybox disindayken hedef siraya kucuk fiyat kirma change too small engeline takilmaz", () => {
  const product = {
    ...base,
    my_price: 831.07,
    min_price: 733.61,
    buybox_price: 832.5,
    second_price: 831.07,
    rank: 2,
  };
  const proposal = {
    ...proposePrice(product, { ...settings, price_cut_tl: 1 }),
    proposedPrice: 827.5,
    targetRank: 1,
    expectedProfit: 120,
    expectedMargin: 10,
  };
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: product.my_price },
  });
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("KORU aksiyonu fiyat degisimi olmadigi icin change too small uretmez", () => {
  const product = {
    ...base,
    my_price: 500,
    min_price: 450,
    buybox_price: 500,
    rank: 1,
  };
  const proposal = {
    ...proposePrice(product, { ...settings, strategy: "Manuel" }),
    expectedProfit: 100,
    expectedMargin: 10,
  };
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.equal(proposal.action, "KORU");
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("minimum fiyat toparlamasi kucuk olsa bile change too small ile engellenmez", () => {
  const product = {
    ...base,
    my_price: 497,
    min_price: 500,
    buybox_price: 520,
    rank: 2,
  };
  const proposal = proposePrice(product, settings);
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 497 },
  });
  assert.equal(proposal.action, "MIN_FIYATA_TOPARLA");
  assert.equal(proposal.proposedPrice, 500);
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("5263747828182828 kontrollu kar yoklamasi uygulanabilir kalir", () => {
  const product = {
    ...base,
    my_price: 485,
    min_price: 446.33,
    buybox_price: 485,
    second_price: 500.4,
    third_price: 551.08,
    rank: 1,
  };
  const proposal = proposePrice(product, {
    ...settings,
    price_cut_tl: 5,
    max_single_change_pct: (4 / 485) * 100,
  });
  assert.equal(proposal.proposedPrice, 489);
  assert.equal(proposal.action, "FIYAT_ARTIR");
  assert.equal(proposal.limitedBy, "BUYBOX_KAR_YOKLAMASI");
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 485 },
  });
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("6248309297217 tutarsiz rank fiyati otomatik fiyat kirmayi engeller", () => {
  const product = {
    ...base,
    my_price: 769.95,
    min_price: 758.06,
    buybox_price: 794.43,
    second_price: 849.99,
    third_price: 1259.99,
    rank: 2,
  };
  const proposal = proposePrice(product, { ...settings, price_cut_tl: 75 });
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: product.my_price },
  });
  assert.equal(proposal.action, "KORU");
  assert.equal(proposal.proposedPrice, 769.95);
  assert.ok(safety.failures.includes("RANK_PRICE_INCONSISTENT"));
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("ogrenilmis kirma minimum altina tasarsa minimum fiyat fallback denenir", () => {
  const product = {
    ...base,
    my_price: 271.08,
    min_price: 266.9,
    buybox_price: 275.08,
    second_price: 271.08,
    third_price: 0,
    rank: 2,
  };
  const proposal = proposePrice(product, {
    ...settings,
    price_cut_tl: 5,
    learned_price_cut_tl: 17,
  });
  assert.equal(proposal.action, "FIYAT_DUSUR");
  assert.equal(proposal.proposedPrice, 266.9);
  assert.equal(proposal.limitedBy, "BUYBOX_MIN_PRICE_FALLBACK");
});

test("buybox minimum fiyat altindaysa ekonomik limit nedeniyle korunur", () => {
  const product = {
    ...base,
    my_price: 500,
    min_price: 475,
    buybox_price: 450,
    second_price: 500,
    third_price: 0,
    rank: 2,
  };
  const proposal = proposePrice(product, { ...settings, price_cut_tl: 5 });
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.equal(proposal.action, "KORU");
  assert.equal(proposal.blockerCode, "BUYBOX_MIN_PRICE_LIMIT");
  assert.ok(safety.failures.includes("BUYBOX_MIN_PRICE_LIMIT"));
  assert.ok(!safety.failures.includes("CHANGE_TOO_SMALL"));
});

test("normal kucuk fiyat oynatma change too small kuralini korur", () => {
  const product = {
    ...base,
    my_price: 500,
    min_price: 450,
    buybox_price: 520,
    rank: 2,
  };
  const proposal = {
    ...proposePrice(product, settings),
    proposedPrice: 498,
    targetRank: 2,
    expectedProfit: 100,
    expectedMargin: 10,
    limitedBy: null,
  };
  const safety = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 5,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: 500 },
  });
  assert.ok(safety.failures.includes("CHANGE_TOO_SMALL"));
});
test("auto update kapali urun safety gate gecemez", () => {
  const proposal = proposePrice(base, settings);
  const result = safetyCheck({
    product: base,
    settings: { ...settings, auto_update: false },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 0.1,
    },
    proposal,
    today: { actionCount: 0 },
  });
  assert.equal(result.safe, false);
  assert.ok(result.failures.includes("AUTO_UPDATE_DISABLED"));
});
test("manuel onay otomasyon kapilarini asar ama dry-run korumasini asamaz", () => {
  const proposal = proposePrice(base, settings);
  const result = safetyCheck({
    product: { ...base, auto_update: false },
    settings: {
      ...settings,
      auto_update: false,
      learning_paused: true,
    },
    global: {
      repricerEnabled: false,
      dryRun: true,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 0.1,
    },
    proposal,
    manual: true,
    today: { actionCount: 0 },
  });
  assert.ok(!result.failures.includes("AUTO_UPDATE_DISABLED"));
  assert.ok(!result.failures.includes("GLOBAL_REPRICER_DISABLED"));
  assert.ok(!result.failures.includes("LEARNING_PAUSED"));
  assert.ok(result.failures.includes("DRY_RUN"));
});
test("dry-run ve eski buybox verisi gercek uygulamayi engeller", () => {
  const product = {
    ...base,
    buybox_updated_at: new Date(Date.now() - 30 * 60000).toISOString(),
  };
  const proposal = proposePrice(product, settings);
  const result = safetyCheck({
    product,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: true,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 0.1,
    },
    proposal,
    today: { actionCount: 0 },
  });
  assert.ok(result.failures.includes("DRY_RUN"));
  assert.ok(result.failures.includes("BUYBOX_STALE"));
});
test("gunluk aksiyon limiti uygulanir", () => {
  const proposal = proposePrice(base, settings);
  const result = safetyCheck({
    product: base,
    settings,
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 0.1,
    },
    proposal,
    today: { actionCount: 3 },
  });
  assert.ok(result.failures.includes("DAILY_ACTION_LIMIT"));
});

test("otomatik buybox geri donusu cooldown ve gunluk limiti beklemez", () => {
  const product = {
    ...base,
    my_price: 510,
    min_price: 450,
    rank: 2,
    buybox_price: 500,
    last_price_change_at: new Date().toISOString(),
  };
  const proposal = proposePrice(product, { ...settings, price_cut_tl: 5 });
  proposal.proposedPrice = 500;
  const safety = safetyCheck({
    product,
    settings: { ...settings, daily_action_limit: 1 },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 0.1,
    },
    proposal,
    today: { actionCount: 1, dayStartPrice: 500 },
    automaticRecovery: true,
  });
  assert.ok(!safety.failures.includes("COOLDOWN_ACTIVE"));
  assert.ok(!safety.failures.includes("DAILY_ACTION_LIMIT"));
});
test("minimum kar guvenlik kapisidir ama ogrenme duraklatma fiyat aksiyonunu engellemez", () => {
  const proposal = proposePrice(base, settings);
  const result = safetyCheck({
    product: base,
    settings: {
      ...settings,
      learning_paused: true,
      minimum_profit_tl: proposal.expectedProfit + 1,
      minimum_profit_pct: 99,
    },
    global: {
      repricerEnabled: true,
      dryRun: false,
      buyboxMaxAgeMinutes: 20,
      maxChangePct: 15,
      minChangeTl: 0.1,
    },
    proposal,
    today: { actionCount: 0, dayStartPrice: base.my_price },
  });
  assert.ok(!result.failures.includes("LEARNING_PAUSED"));
  assert.ok(result.failures.includes("MIN_PROFIT_TL_VIOLATION"));
  assert.ok(result.failures.includes("MIN_PROFIT_PCT_VIOLATION"));
});

test("yayın fiyatı birinci sıra ekonomik değilse ikinci sırayı hedefler", () => {
  const result = recommendRankPrice({
    minimumPrice: 100,
    competitorPrices: [90, 120, 140],
    undercut: 0.1,
  });
  assert.equal(result.targetRank, 2);
  assert.equal(result.proposedPrice, 119.9);
  assert.equal(result.status, "ECONOMIC_RANK_FOUND");
});

test("ilk üç sıra ekonomik değilse açık sonuç verir", () => {
  const result = recommendRankPrice({
    minimumPrice: 150,
    competitorPrices: [90, 120, 140],
  });
  assert.equal(result.targetRank, null);
  assert.equal(result.proposedPrice, 150);
  assert.equal(result.status, "BUYBOX_TARGET_NOT_ECONOMIC");
});

test("Hepsiburada repricer onizlemesi DB verisiyle calisir", async () => {
  const service = new RepricerService({
    settings: {
      getAll: async () => ({
        global_dry_run: true,
        global_repricer_enabled: false,
        default_price_cut_tl: 1,
      }),
    },
    actions: {
      todayStats: async () => ({ action_count: 0 }),
    },
    db: {
      query: async (sql, params) => {
        assert.equal(params[0], "HEPSIBURADA");
        return {
          rows: [
            {
              ...base,
              marketplace: "HEPSIBURADA",
              barcode: "HB-SKU-1",
              product_name: "Hepsiburada Ürünü",
              strategy: "Normal",
              setting_auto_update: true,
              mode: "AUTOMATIC",
              price_cut_tl: 1,
              min_undercut_tl: 0.1,
              max_undercut_tl: 75,
            },
          ],
        };
      },
    },
  });
  const [preview] = await service.preview("HB-SKU-1", "HEPSIBURADA");
  assert.equal(preview.barcode, "HB-SKU-1");
  assert.equal(preview.productName, "Hepsiburada Ürünü");
});

test("desteklenmeyen pazaryeri repricer tarafinda fail-closed reddedilir", async () => {
  const service = new RepricerService({
    db: {},
    settings: {},
    actions: {},
  });
  await assert.rejects(
    service.preview(undefined, "N11"),
    (error) => error.code === "MARKETPLACE_NOT_SUPPORTED",
  );
});
