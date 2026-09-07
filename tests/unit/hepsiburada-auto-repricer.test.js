const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HepsiburadaAutoRepricerService,
} = require("../../src/services/hepsiburada-auto-repricer.service");

function fixture({
  gatesOpen = true,
  actions: generatedActions,
  ...options
} = {}) {
  const applied = [];
  const approved = [];
  const requestedMarketplaces = [];
  const generatedInputs = [];
  const hbAction = {
    id: 1,
    marketplace: "HEPSIBURADA",
    barcode: "HB1",
    status: "PENDING",
  };
  const trendyolAction = {
    id: 2,
    marketplace: "TRENDYOL",
    barcode: "TY1",
    status: "PENDING",
  };
  const actionItems = generatedActions || [hbAction, trendyolAction];
  const service = new HepsiburadaAutoRepricerService({
    repricer: {
      globalSettings: async () => ({ dryRun: false, repricerEnabled: true }),
      generate: async (input) => {
        generatedInputs.push(input);
        return {
          processed: 2,
          created: 1,
          skipped: 0,
          items: actionItems,
        };
      },
    },
    actions: {
      openAutomationActions: async (marketplace) => {
        requestedMarketplaces.push(marketplace);
        return [];
      },
      get: async () => null,
    },
    products: {
      get: async (barcode, marketplace) => ({
        barcode,
        marketplace,
        settings: { mode: "AUTOMATIC", auto_update: true },
      }),
    },
    actionService: {
      approve: async (id) => approved.push(id),
    },
    hepsiburadaActionService: {
      apply: async (id) => applied.push(id),
    },
    hepsiburadaLearning: {
      verifyPendingActions: async () => ({ processed: 0 }),
    },
    hepsiburada: { livePriceUpdatesEnabled: () => gatesOpen },
    sleep: options.sleep,
    now: options.now,
    submissionIntervalMs: options.submissionIntervalMs,
    rateLimitCooldownMs: options.rateLimitCooldownMs,
  });
  return {
    service,
    applied,
    approved,
    requestedMarketplaces,
    generatedInputs,
    hbAction,
  };
}

test("HB otomatik job yalniz HEPSIBURADA aksiyonunu tuketir", async () => {
  const state = fixture();
  const result = await state.service.run();
  assert.equal(result.successful, 1);
  assert.deepEqual(state.approved, [1]);
  assert.deepEqual(state.applied, [1]);
  assert.deepEqual(state.requestedMarketplaces, ["HEPSIBURADA"]);
  assert.deepEqual(state.generatedInputs, [
    { source: "AUTO", marketplace: "HEPSIBURADA" },
  ]);
});

test("HB otomatik job mutasyon kapilari kapaliyken action uygulamaz", async () => {
  const state = fixture({ gatesOpen: false });
  const result = await state.service.run();
  assert.equal(result.successful, 0);
  assert.equal(result.metadata.mutationGatesOpen, false);
  assert.deepEqual(state.approved, []);
  assert.deepEqual(state.applied, []);
  assert.deepEqual(state.requestedMarketplaces, []);
});

test("HB otomatik job uygulama baslangiclarini pazar yeri hizinda araliklar", async () => {
  let now = 1000;
  const waits = [];
  const actions = [1, 2, 3].map((id) => ({
    id,
    marketplace: "HEPSIBURADA",
    barcode: `HB${id}`,
    status: "PENDING",
  }));
  const state = fixture({
    actions,
    submissionIntervalMs: 2000,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });
  const result = await state.service.run();
  assert.deepEqual(state.applied, [1, 2, 3]);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(result.metadata.attempted, 3);
  assert.equal(result.metadata.pacingWaitMs, 4000);
});

test("HB otomatik job eszamanli ikinci kosuyu atlar", async () => {
  let release;
  const state = fixture();
  state.service.hepsiburadaActionService.apply = async (id) => {
    state.applied.push(id);
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = state.service.run();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const overlapping = await state.service.run();
  assert.equal(overlapping.metadata.overlapSkipped, true);
  assert.deepEqual(state.applied, [1]);
  release();
  await first;
});

test("HB otomatik job ilk 429 sonrasinda kalan aksiyonlari gondermez", async () => {
  let now = 1000;
  const actions = [1, 2, 3].map((id) => ({
    id,
    marketplace: "HEPSIBURADA",
    barcode: `HB${id}`,
    status: "PENDING",
  }));
  const state = fixture({
    actions,
    submissionIntervalMs: 0,
    rateLimitCooldownMs: 600000,
    now: () => now,
  });
  state.service.hepsiburadaActionService.apply = async (id) => {
    state.applied.push(id);
    const error = new Error("rate limited");
    error.status = 429;
    error.code = "HTTP_429";
    error.retryAfterMs = 90000;
    throw error;
  };
  const result = await state.service.run();
  assert.deepEqual(state.applied, [1]);
  assert.equal(result.failed, 1);
  assert.equal(result.metadata.rateLimited, true);
  assert.equal(result.metadata.retryAfterMs, 90000);
  now += 1000;
  const cooldown = await state.service.run();
  assert.equal(cooldown.metadata.rateLimitCooldown, true);
  assert.equal(cooldown.metadata.cooldownRemainingMs, 89000);
});
