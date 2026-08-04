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
  let productMarketplace;
  let statsMarketplace;
  const actions = {
    findOpen: async () => null,
    todayStats: async (barcode, marketplace) => {
      statsMarketplace = marketplace;
      return { action_count: 0 };
    },
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
    products: {
      get: async (barcode, marketplace) => {
        productMarketplace = marketplace;
        return product;
      },
    },
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
  assert.equal(productMarketplace, "TRENDYOL");
  assert.equal(statsMarketplace, "TRENDYOL");
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
test("bekleyen aksiyon fiyati minimum ustunde duzenlenip onaylanir", async () => {
  const { action, product } = fixture("PENDING");
  let auditEntry;
  const client = {
    query: async (sql, params) => {
      if (sql.includes("SELECT * FROM repricer_actions"))
        return { rows: [action] };
      if (sql.includes("SELECT * FROM products")) return { rows: [product] };
      if (sql.includes("UPDATE repricer_actions"))
        return {
          rows: [
            {
              ...action,
              proposed_price: params[1],
              expected_profit: params[3],
              expected_margin: params[4],
              status: "APPROVED",
              source: "MANUAL_EDIT",
            },
          ],
        };
      return { rows: [] };
    },
  };
  const service = new ActionService({
    withTransaction: async (work) => work(client),
    audit: {
      record: async (entry) => {
        auditEntry = entry;
      },
    },
  });
  const result = await service.editAndApprove(
    action.id,
    { proposedPrice: 900, reason: "Panel karari" },
    "admin",
  );
  assert.equal(result.status, "APPROVED");
  assert.equal(result.proposed_price, 900);
  assert.equal(result.source, "MANUAL_EDIT");
  assert.equal(auditEntry.action, "REPRICER_ACTION_EDITED_AND_APPROVED");
});
test("aksiyon duzenleme minimum fiyat altina izin vermez", async () => {
  const { action, product } = fixture("PENDING");
  const service = new ActionService({
    withTransaction: async (work) =>
      work({
        query: async (sql) => ({
          rows: sql.includes("repricer_actions") ? [action] : [product],
        }),
      }),
    audit: { record: async () => {} },
  });
  await assert.rejects(
    service.editAndApprove(action.id, { proposedPrice: 804.99 }, "admin"),
    (error) => error.code === "BELOW_MINIMUM_PRICE",
  );
});
test("Trendyol kabul yaniti urun fiyatini dogrulama olmadan kesinlestirmez", async () => {
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
    recordMarketPreflight: async () => {},
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
      getProductByBarcode: async () => ({
        barcode: action.barcode,
        salePrice: action.old_price,
        listPrice: action.old_price,
        quantity: 10,
        approved: true,
        archived: false,
        onSale: true,
      }),
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
  assert.equal(result.applied_price, undefined);
  assert.ok(
    !queries.some((sql) => sql.includes("UPDATE products SET my_price")),
  );
  assert.ok(!queries.some((sql) => sql.includes("INSERT INTO price_war_log")));
});

test("Trendyol guncel fiyati beklenen fiyatla uyusmazsa gonderim engellenir", async () => {
  const { action, product } = fixture();
  let apiCalls = 0;
  let staleStatus;
  let preflight;
  const actions = {
    findOpen: async () => null,
    todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
    recordMarketPreflight: async (id, price) => {
      preflight = price;
    },
    updateStatus: async (id, status) => {
      if (status === "STALE") staleStatus = status;
      return { ...action, status };
    },
  };
  const service = new ActionService({
    db: {},
    withTransaction: async (work) =>
      work({ query: async () => ({ rows: [action] }) }),
    actions,
    products: { get: async () => product },
    settings: {},
    trendyol: {
      getProductByBarcode: async () => ({
        barcode: action.barcode,
        salePrice: 945,
        quantity: 10,
        approved: true,
        archived: false,
        onSale: true,
      }),
      updatePrices: async () => {
        apiCalls++;
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
  await assert.rejects(
    service.apply(1, "admin"),
    (error) => error.code === "MARKET_PRICE_MISMATCH",
  );
  assert.equal(preflight, 945);
  assert.equal(apiCalls, 0);
  assert.equal(staleStatus, "STALE");
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
  assert.equal(request.options.marketplace, "TRENDYOL");
  assert.equal(request.options.revertsActionId, action.id);
});

test("Hepsiburada aksiyonu Trendyol fiyat servisine asla gönderilmez", async () => {
  const { action, product } = fixture();
  action.marketplace = "HEPSIBURADA";
  action.approved_by = "admin";
  product.marketplace = "HEPSIBURADA";
  product.merchant_sku = "HB-MERCHANT-1";
  product.hb_sku = "HBV-1";
  let trendyolCalls = 0;
  let failedStatus;
  const actions = {
    findOpen: async () => null,
    todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
    updateStatus: async (id, status) => {
      if (status === "FAILED") failedStatus = status;
      return { ...action, status };
    },
  };
  const service = new ActionService({
    db: {},
    withTransaction: async (work) =>
      work({ query: async () => ({ rows: [action] }) }),
    actions,
    products: { get: async () => product },
    settings: {},
    trendyol: {
      getProductByBarcode: async () => {
        trendyolCalls++;
      },
      updatePrices: async () => {
        trendyolCalls++;
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
    marketplaceRegistry: {
      execute: async () => ({
        ok: false,
        code: "HEPSIBURADA_MUTATIONS_DISABLED",
        message: "Hepsiburada mutasyonları kapalı",
      }),
    },
  });

  await assert.rejects(
    service.apply(action.id, "admin"),
    (error) => error.code === "HEPSIBURADA_PILOT_NOT_ALLOWED",
  );
  assert.equal(trendyolCalls, 0);
  assert.equal(failedStatus, "FAILED");
});

test("Hepsiburada takip numarasi aksiyonu SUCCESS yapmaz", async () => {
  const { env } = require("../../src/config/env");
  const previousPilot = env.hepsiburadaPricePilotBarcodes;
  const { action, product } = fixture();
  action.marketplace = "HEPSIBURADA";
  action.approved_by = "admin";
  action.idempotency_key = "hb-price-action-1";
  product.marketplace = "HEPSIBURADA";
  product.merchant_sku = "HB-MERCHANT-1";
  product.hb_sku = "HBV-1";
  env.hepsiburadaPricePilotBarcodes = [action.barcode];
  const calls = [];
  const actions = {
    findOpen: async () => null,
    todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
    recordMarketPreflight: async () => {},
    updateStatus: async (id, status, fields = {}) => ({
      ...action,
      status,
      batch_id: fields.batchId,
    }),
  };
  try {
    const service = new ActionService({
      db: {},
      withTransaction: async (work) =>
        work({ query: async () => ({ rows: [action] }) }),
      actions,
      products: { get: async () => product },
      settings: {},
      trendyol: {
        getProductByBarcode: async () => assert.fail("Trendyol cagrilmamali"),
        updatePrices: async () => assert.fail("Trendyol cagrilmamali"),
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
      marketplaceRegistry: {
        execute: async (marketplace, operation, input) => {
          calls.push({ marketplace, operation, input });
          if (operation === "getCurrentOffer")
            return {
              merchantSku: "HB-MERCHANT-1",
              hbSku: "HBV-1",
              price: 944,
              stock: 10,
              isSalable: true,
            };
          return { ok: true, trackingId: "hb-tracking-1", response: {} };
        },
      },
    });
    const result = await service.apply(action.id, "admin");
    assert.equal(result.status, "AWAITING_RESULT");
    assert.equal(result.batch_id, "hb-tracking-1");
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["getCurrentOffer", "updatePrice"],
    );
  } finally {
    env.hepsiburadaPricePilotBarcodes = previousPilot;
  }
});

test("Hepsiburada dry-run aksiyonu dis mutasyon cagirmadan tamamlanir", async () => {
  const { action, product } = fixture();
  action.marketplace = "HEPSIBURADA";
  action.approved_by = "admin";
  product.marketplace = "HEPSIBURADA";
  let registryCalls = 0;
  const service = new ActionService({
    db: {},
    withTransaction: async (work) =>
      work({ query: async () => ({ rows: [action] }) }),
    actions: {
      findOpen: async () => null,
      todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
      updateStatus: async (id, status, fields = {}) => ({
        ...action,
        status,
        api_response: fields.apiResponse,
      }),
    },
    products: { get: async () => product },
    settings: {},
    trendyol: {},
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
    marketplaceRegistry: {
      execute: async () => {
        registryCalls++;
        return { ok: true };
      },
    },
  });

  const result = await service.apply(action.id, "admin");
  assert.equal(result.status, "DRY_RUN");
  assert.equal(registryCalls, 0);
});

test("Hepsiburada preflight fiyat uyusmazliginda gonderim yapmaz", async () => {
  const { env } = require("../../src/config/env");
  const previousPilot = env.hepsiburadaPricePilotBarcodes;
  const { action, product } = fixture();
  action.marketplace = "HEPSIBURADA";
  action.approved_by = "admin";
  product.marketplace = "HEPSIBURADA";
  product.merchant_sku = "HB-MERCHANT-1";
  product.hb_sku = "HBV-1";
  env.hepsiburadaPricePilotBarcodes = [action.barcode];
  let updateCalls = 0;
  let finalStatus;
  try {
    const service = new ActionService({
      db: {},
      withTransaction: async (work) =>
        work({ query: async () => ({ rows: [action] }) }),
      actions: {
        findOpen: async () => null,
        todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
        recordMarketPreflight: async () => {},
        updateStatus: async (id, status) => {
          finalStatus = status;
          return { ...action, status };
        },
      },
      products: { get: async () => product },
      settings: {},
      trendyol: {},
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
      marketplaceRegistry: {
        execute: async (marketplace, operation) => {
          assert.equal(marketplace, "HEPSIBURADA");
          if (operation === "getCurrentOffer")
            return {
              merchantSku: "HB-MERCHANT-1",
              hbSku: "HBV-1",
              price: 945,
              stock: 10,
              isSalable: true,
            };
          updateCalls++;
          return { ok: true, trackingId: "should-not-exist" };
        },
      },
    });

    await assert.rejects(
      service.apply(action.id, "admin"),
      (error) => error.code === "MARKET_PRICE_MISMATCH",
    );
    assert.equal(updateCalls, 0);
    assert.equal(finalStatus, "STALE");
  } finally {
    env.hepsiburadaPricePilotBarcodes = previousPilot;
  }
});

test("Hepsiburada AWAITING_RESULT aksiyonu ikinci fiyat istegi gondermez", async () => {
  const { action, product } = fixture("AWAITING_RESULT");
  action.marketplace = "HEPSIBURADA";
  product.marketplace = "HEPSIBURADA";
  let registryCalls = 0;
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
    marketplaceRegistry: {
      execute: async () => {
        registryCalls++;
      },
    },
  });

  await assert.rejects(
    service.apply(action.id, "admin"),
    (error) => error.code === "DUPLICATE_APPLY",
  );
  assert.equal(registryCalls, 0);
});
