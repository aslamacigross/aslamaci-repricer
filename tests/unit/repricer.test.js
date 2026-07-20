const test = require("node:test");
const assert = require("node:assert/strict");
const { proposePrice, safetyCheck } = require("../../src/domain/repricer");
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
  const down = proposePrice(base, settings);
  assert.equal(down.proposedPrice, 939);
  assert.equal(down.action, "FIYAT_DUSUR");
  const up = proposePrice(
    { ...base, my_price: 900, rank: 1, second_price: 950 },
    { ...settings, price_cut_tl: 1 },
  );
  assert.equal(up.proposedPrice, 949);
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
  assert.equal(result.proposedPrice, 999);
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
test("tek islem ve gunluk toplam degisim limitleri ayri uygulanir", () => {
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
      minChangeTl: 0.1,
    },
    proposal: proposePrice(base, settings),
    today: { actionCount: 0, dayStartPrice: 1000 },
  });
  assert.ok(result.failures.includes("DAILY_CHANGE_LIMIT"));
  assert.ok(!result.failures.includes("SINGLE_CHANGE_LIMIT"));
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
  assert.equal(proposal.proposedPrice, 1299);
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
test("minimum kar ve ogrenme duraklatma guvenlik kapisidir", () => {
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
  assert.ok(result.failures.includes("LEARNING_PAUSED"));
  assert.ok(result.failures.includes("MIN_PROFIT_TL_VIOLATION"));
  assert.ok(result.failures.includes("MIN_PROFIT_PCT_VIOLATION"));
});
