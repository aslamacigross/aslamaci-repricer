const test = require("node:test");
const assert = require("node:assert/strict");
const { ContentService } = require("../../src/services/content.service");
const { DeterministicContentProvider } = require("../../src/services/content-provider");

const recipe = {
  id: 1, recipe_name: "Actisoft Menekşe 1,5 L x 4", recipe_type: "PACK",
  components: [{ cost_item_code: "MENEKSE", product_name: "Menekşe", brand: "Actisoft", volume_ml: 1500, quantity: 4 }],
};

test("anahtar yokken provider kaynak gerçeklerine bağlı mock draft üretir", async () => {
  let saved;
  const service = new ContentService({
    repository: {
      getListing: async () => null,
      saveDraft: async (input) => { saved = input; return { id: 2, provider_mode: input.providerMode }; },
    },
    pim: { getRecipe: async () => recipe },
    marketplaceRegistry: {},
    provider: new DeterministicContentProvider(),
  });
  const result = await service.generate({
    recipeId: 1, marketplace: "TRENDYOL", confirmation: "ICERIK_TASLAGI_URET",
  }, "admin");
  assert.equal(result.provider.mode, "MOCK_DRAFT");
  assert.equal(result.externalRequestPerformed, false);
  assert.match(saved.proposedContent.visualBriefs[0].brief, /4 gerçek paket/);
  assert.equal(result.mutationPerformed, false);
});

test("içerik dry-run onaylı taslakta dahi adapter mutasyonu çağırmaz", async () => {
  let executeCalled = false;
  const service = new ContentService({
    repository: {
      getDraft: async () => ({
        id: 4, marketplace: "TRENDYOL", workflow_status: "APPROVED",
        diff_json: [], snapshots: [],
      }),
    },
    pim: {}, provider: {},
    marketplaceRegistry: {
      get: async () => ({ enabled: true, credentials_configured: true, capabilities: { supportsContentUpdate: true } }),
      execute: async () => { executeCalled = true; },
    },
  });
  const result = await service.publishDryRun(4, "admin", "ICERIK_DRY_RUN_ONAYLA");
  assert.equal(result.mutationPerformed, false);
  assert.equal(executeCalled, false);
  assert.ok(result.blockers.includes("CONTENT_AUTO_UPDATE_DISABLED"));
});

test("güvenlik hatalı içerik insan onayı alamaz", async () => {
  const service = new ContentService({
    repository: {
      getDraft: async () => ({
        proposed_content: { title: "Actisoft x 2", description: "tedavi eder", metadata: { packageCount: 2 } },
        source_facts: { packageCount: 4, brands: ["Actisoft"] },
      }),
    },
    pim: {}, marketplaceRegistry: {}, provider: {},
  });
  await assert.rejects(
    service.approve(1, "admin", "ICERIGI_ONAYLA"),
    (error) => error.code === "CONTENT_SAFETY_FAILED",
  );
});
