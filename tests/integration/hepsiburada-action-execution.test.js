const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HepsiburadaActionService,
} = require("../../src/services/hepsiburada-action.service");

function fixture(overrides = {}) {
  const action = {
    id: 81,
    marketplace: "HEPSIBURADA",
    barcode: "HB-MERCHANT-SKU",
    status: "APPROVED",
    old_price: 944,
    proposed_price: 939,
    min_price: 805,
    expected_profit: 151,
    expected_margin: 16,
    buybox_before: 950,
    rank_before: 2,
    expires_at: new Date(Date.now() + 60000),
    source: "AUTO",
    ...overrides.action,
  };
  const product = {
    marketplace: "HEPSIBURADA",
    barcode: action.barcode,
    merchant_sku: action.barcode,
    hb_sku: "HBCV0000TEST",
    my_price: 944,
    min_price: 805,
    is_active: true,
    on_sale: true,
    locked: false,
    stock_quantity: 10,
    data_complete: true,
    commission_rate: 17,
    buybox_price: 950,
    second_price: 944,
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
      mode: "AUTOMATIC",
      auto_update: true,
      strategy: "Normal",
      max_daily_change_pct: 15,
      daily_action_limit: 3,
      min_change_interval_minutes: 0,
    },
    ...overrides.product,
  };
  return { action, product };
}

function serviceFixture(overrides = {}) {
  const { action, product } = fixture(overrides);
  const statuses = [];
  let submissions = 0;
  const actions = {
    findOpen: async () => null,
    todayStats: async () => ({ action_count: 0, day_start_price: 944 }),
    recordMarketPreflight: async () => {},
    updateStatus: async (id, status, fields = {}) => {
      statuses.push(status);
      return { ...action, status, batch_id: fields.batchId || action.batch_id };
    },
    ...overrides.actions,
  };
  const hepsiburada = {
    livePriceUpdatesEnabled: () => true,
    readListingForPrice: async () => ({
      merchantSku: product.merchant_sku,
      hepsiburadaSku: product.hb_sku,
      price: product.my_price,
      availableStock: product.stock_quantity,
      isSalable: true,
    }),
    submitPriceUpdate: async () => {
      submissions++;
      return { uploadId: "hb-upload-81", response: { id: "hb-upload-81" } };
    },
    getListingUploadStatus: async () => ({ status: "Done" }),
    ...overrides.hepsiburada,
  };
  const service = new HepsiburadaActionService({
    withTransaction: async (work) =>
      work({
        query: async (sql) =>
          sql.includes("SELECT * FROM repricer_actions")
            ? { rows: [action] }
            : { rows: [] },
      }),
    actions,
    products: { get: async () => product },
    hepsiburada,
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
  return {
    service,
    action,
    product,
    statuses,
    submissions: () => submissions,
  };
}

test("HB executor resmi async yuklemeyi baslatir ve sonucu bekler", async () => {
  const { service, statuses, submissions } = serviceFixture();
  const result = await service.apply(81, "system");
  assert.equal(result.status, "AWAITING_RESULT");
  assert.equal(result.batch_id, "hb-upload-81");
  assert.deepEqual(statuses, ["SENDING", "AWAITING_RESULT"]);
  assert.equal(submissions(), 1);
});

test("HB executor Trendyol aksiyonunu tuketmez", async () => {
  const { service, submissions } = serviceFixture({
    action: { marketplace: "TRENDYOL" },
  });
  await assert.rejects(
    service.apply(81, "system"),
    (error) => error.code === "MARKETPLACE_EXECUTOR_MISMATCH",
  );
  assert.equal(submissions(), 0);
});

test("HB mutasyon kapilari kapaliyken marketplace yazimi yapilmaz", async () => {
  const { service, statuses, submissions } = serviceFixture({
    hepsiburada: { livePriceUpdatesEnabled: () => false },
  });
  await assert.rejects(
    service.apply(81, "system"),
    (error) => error.code === "HEPSIBURADA_PRICE_MUTATION_DISABLED",
  );
  assert.deepEqual(statuses, []);
  assert.equal(submissions(), 0);
});

test("HB stale fiyat ve acik aksiyon marketplace yazimini engeller", async () => {
  const mismatch = serviceFixture({ product: { my_price: 945 } });
  await assert.rejects(
    mismatch.service.apply(81, "system"),
    (error) => error.code === "PRICE_MISMATCH",
  );
  assert.equal(mismatch.submissions(), 0);

  const duplicate = serviceFixture({
    actions: { findOpen: async () => ({ id: 82 }) },
  });
  await assert.rejects(
    duplicate.service.apply(81, "system"),
    (error) => error.code === "OPEN_ACTION_EXISTS",
  );
  assert.equal(duplicate.submissions(), 0);
});

test("ayni HB aksiyonu eszamanli olarak iki kez gonderilemez", async () => {
  let releaseSubmission;
  let submissions = 0;
  const state = serviceFixture({
    hepsiburada: {
      submitPriceUpdate: async () => {
        submissions++;
        await new Promise((resolve) => {
          releaseSubmission = resolve;
        });
        return { uploadId: "hb-upload-81", response: { id: "hb-upload-81" } };
      },
    },
  });
  state.service.actions.updateStatus = async (id, status, fields = {}) => {
    state.action.status = status;
    state.action.batch_id = fields.batchId || state.action.batch_id;
    state.statuses.push(status);
    return { ...state.action };
  };

  const first = state.service.apply(81, "system");
  while (!releaseSubmission)
    await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    state.service.apply(81, "system"),
    (error) => error.code === "DUPLICATE_APPLY",
  );
  assert.equal(submissions, 1);
  releaseSubmission();
  await first;
  assert.equal(submissions, 1);
});

test("HB Listing API fiyat uyusmazligi aksiyonu STALE yapar", async () => {
  const { service, statuses, submissions } = serviceFixture({
    hepsiburada: {
      readListingForPrice: async () => ({
        price: 945,
        availableStock: 10,
        isSalable: true,
      }),
    },
  });
  await assert.rejects(
    service.apply(81, "system"),
    (error) => error.code === "MARKET_PRICE_MISMATCH",
  );
  assert.deepEqual(statuses, ["SENDING", "STALE"]);
  assert.equal(submissions(), 0);
});

test("HB basarisiz istek aksiyonu FAILED yapar ve yeniden gondermez", async () => {
  const { service, statuses, submissions } = serviceFixture({
    hepsiburada: {
      submitPriceUpdate: async () => {
        const error = new Error("upstream failed");
        error.code = "HB_UPLOAD_FAILED";
        throw error;
      },
    },
  });
  await assert.rejects(service.apply(81, "system"), /upstream failed/);
  assert.deepEqual(statuses, ["SENDING", "FAILED"]);
  assert.equal(submissions(), 0);
  await assert.rejects(service.apply(81, "system"), /upstream failed/);
});

test("HB upload sonucu ve Listing fiyati birlikte dogrulanir", async () => {
  const { service, action } = serviceFixture({
    hepsiburada: {
      readListingForPrice: async () => ({ price: 939, isSalable: true }),
    },
  });
  const result = await service.verifyPriceAction({
    ...action,
    status: "AWAITING_RESULT",
    batch_id: "hb-upload-81",
  });
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.observedPrice, 939);
});

test("HB executor minimum fiyat guvenligini Trendyol semantigiyle uygular", async () => {
  const { service, submissions } = serviceFixture({
    action: { proposed_price: 700 },
  });
  await assert.rejects(service.apply(81, "system"), {
    code: "SAFETY_BLOCKED",
    message: /BELOW_MIN_PRICE/,
  });
  assert.equal(submissions(), 0);
});
