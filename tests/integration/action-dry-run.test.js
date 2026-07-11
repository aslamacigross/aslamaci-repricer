const test = require("node:test");
const assert = require("node:assert/strict");
const { ActionService } = require("../../src/services/action.service");
function fixture(status = "APPROVED") {
  const action = {
    id: 1,
    marketplace: "TRENDYOL",
    barcode: "8695077036402",
    status,
    old_price: 944,
    proposed_price: 939,
    min_price: 805,
    expected_profit: 151,
    expected_margin: 16,
    buybox_before: 950,
    rank_before: 2,
    expires_at: new Date(Date.now() + 60000),
  };
  const product = {
    marketplace: "TRENDYOL",
    barcode: action.barcode,
    my_price: 944,
    min_price: 805,
    is_active: true,
    on_sale: true,
    locked: false,
    stock_quantity: 10,
    data_complete: true,
    commission_rate: 17,
    buybox_price: 950,
    second_price: 949,
    third_price: 960,
    rank: 2,
    buybox_updated_at: new Date(),
    calculated_net_profit: 155,
    calculated_product_cost: 448,
    calculated_shipping_cost: 141.96,
    packaging_cost: 25,
    service_fee: 13.19,
    auto_update: true,
    settings: {
      auto_update: true,
      strategy: "Normal",
      max_daily_change_pct: 15,
      daily_action_limit: 3,
      min_change_interval_minutes: 0,
    },
  };
  return { action, product };
}
test("dry-run onayli aksiyonda Trendyol cagrisi yapmaz", async () => {
  const { action, product } = fixture();
  let calls = 0;
  const actions = {
    findOpen: async () => action,
    todayStats: async () => ({ action_count: 0 }),
    updateStatus: async (id, status, fields) => ({
      ...action,
      status,
      api_response: fields.apiResponse,
    }),
  };
  const service = new ActionService({
    db: {},
    withTransaction: async (work) =>
      work({ query: async () => ({ rows: [action] }) }),
    actions,
    products: { get: async () => product },
    settings: {},
    trendyol: {
      updatePrices: async () => {
        calls++;
      },
    },
    audit: { record: async () => {} },
    repricer: {
      globalSettings: async () => ({
        dryRun: true,
        repricerEnabled: true,
        buyboxMaxAgeMinutes: 20,
        maxChangePct: 15,
        minChangeTl: 0.1,
      }),
    },
  });
  const result = await service.apply(1, "admin");
  assert.equal(result.status, "DRY_RUN");
  assert.equal(calls, 0);
});
test("ayni aksiyon ikinci kez uygulanamaz", async () => {
  const { action, product } = fixture("DRY_RUN");
  const service = new ActionService({
    db: {},
    withTransaction: async (work) =>
      work({ query: async () => ({ rows: [action] }) }),
    actions: {},
    products: { get: async () => product },
    settings: {},
    trendyol: {},
    audit: {},
    repricer: {},
  });
  await assert.rejects(
    service.apply(1, "admin"),
    (error) => error.code === "DUPLICATE_APPLY",
  );
});
