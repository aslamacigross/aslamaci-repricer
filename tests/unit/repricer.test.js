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
