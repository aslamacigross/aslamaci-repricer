const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HepsiburadaAutoRepricerService,
} = require("../../src/services/hepsiburada-auto-repricer.service");

function fixture({ gatesOpen = true } = {}) {
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
  const service = new HepsiburadaAutoRepricerService({
    repricer: {
      globalSettings: async () => ({ dryRun: false, repricerEnabled: true }),
      generate: async (input) => {
        generatedInputs.push(input);
        return {
          processed: 2,
          created: 1,
          skipped: 0,
          items: [hbAction, trendyolAction],
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
  });
  return {
    service,
    applied,
    approved,
    requestedMarketplaces,
    generatedInputs,
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
