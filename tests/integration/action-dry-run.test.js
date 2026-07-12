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
    findOpen: async () => null,
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
test("basarili Trendyol yaniti urun fiyatini ve fiyat gecmisini atomik gunceller", async () => {
  const { action, product } = fixture();
  const queries = [];
  let apiCalls = 0;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("SELECT * FROM repricer_actions"))
        return { rows: [action] };
      return { rows: [] };
    },
  };
  const actions = {
    findOpen: async () => null,
    todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
    updateStatus: async (id, status, fields) => ({
      ...action,
      status,
      applied_price: fields.appliedPrice,
    }),
  };
  const service = new ActionService({
    db: {},
    withTransaction: async (work) => work(client),
    actions,
    products: { get: async () => product },
    settings: {},
    trendyol: {
      updatePrices: async () => {
        apiCalls++;
        return { batchRequestId: "mock-batch" };
      },
    },
    audit: { record: async () => {} },
    repricer: {
      globalSettings: async () => ({
        dryRun: false,
        repricerEnabled: true,
        buyboxMaxAgeMinutes: 20,
        maxChangePct: 15,
        minChangeTl: 0.1,
      }),
    },
  });
  const result = await service.apply(1, "admin");
  assert.equal(result.status, "AWAITING_RESULT");
  assert.equal(apiCalls, 1);
  assert.ok(
    queries.some((sql) => sql.includes("UPDATE products SET my_price")),
  );
  assert.ok(queries.some((sql) => sql.includes("INSERT INTO price_war_log")));
});

test("manuel aksiyon otomatik repricer kapaliyken dry-run olarak islenebilir", async () => {
  const { action, product } = fixture();
  action.source = "MANUAL";
  product.auto_update = false;
  product.settings.auto_update = false;
  const actions = {
    findOpen: async () => null,
    todayStats: async () => ({ action_count: 0 }),
    updateStatus: async (id, status) => ({ ...action, status }),
  };
  const service = new ActionService({
    db: {},
    withTransaction: async (work) =>
      work({ query: async () => ({ rows: [action] }) }),
    actions,
    products: { get: async () => product },
    settings: {},
    trendyol: { updatePrices: async () => assert.fail("API cagrilmamali") },
    audit: { record: async () => {} },
    repricer: {
      globalSettings: async () => ({
        dryRun: true,
        repricerEnabled: false,
        buyboxMaxAgeMinutes: 20,
        maxChangePct: 15,
        minChangeTl: 0.1,
      }),
    },
  });
  const result = await service.apply(1, "admin");
  assert.equal(result.status, "DRY_RUN");
});

test("geri alma istegi dogrudan fiyat gondermeden bagli aksiyon olusturur", async () => {
  const { action, product } = fixture("SUCCESS");
  action.applied_price = action.proposed_price;
  product.my_price = action.applied_price;
  let request;
  const service = new ActionService({
    db: {},
    withTransaction: async (work) => work({}),
    actions: {
      get: async () => action,
      findReversal: async () => null,
      findOpen: async () => null,
    },
    products: { get: async () => product },
    settings: {},
    trendyol: {},
    audit: { record: async () => {} },
    repricer: {
      manualAction: async (barcode, price, actor, options) => {
        request = { barcode, price, actor, options };
        return { id: 9, barcode, proposed_price: price, status: "PENDING" };
      },
    },
  });
  const result = await service.requestRevert(action.id, "admin");
  assert.equal(result.status, "PENDING");
  assert.equal(request.price, action.old_price);
  assert.equal(request.options.source, "ROLLBACK");
  assert.equal(request.options.revertsActionId, action.id);
});
