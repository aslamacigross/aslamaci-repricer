const test = require("node:test");
const assert = require("node:assert/strict");
const { OpportunityService } = require("../../src/services/opportunity.service");

test("fırsat onayı yeni reçeteyi oluşturur ve insan onayıyla APPROVED yapar", async () => {
  const calls = [];
  const opportunity = {
    id: 5,
    workflow_status: "GENERATED",
    score: 80,
    proposed_recipe: {
      recipeName: "Menekşe 1,5 L x 3",
      components: [{ costItemCode: "ACTISOFT_MENEKSE_1500", quantity: 3 }],
    },
  };
  const service = new OpportunityService({
    repository: {
      get: async () => opportunity,
      transition: async (_id, input) => ({ id: 5, recipe_id: input.recipeId, workflow_status: input.status }),
    },
    pim: {
      createRecipe: async (input) => { calls.push(["create", input]); return { id: 22, status: "DRAFT" }; },
      getRecipe: async () => ({ id: 22, status: "DRAFT" }),
    },
    publication: {
      approveRecipe: async (...args) => { calls.push(["approve", ...args]); },
    },
    marketplaceRegistry: {},
  });
  const result = await service.approve(5, "admin", "FIRSAT_RECETESINI_ONAYLA");
  assert.equal(result.recipe_id, 22);
  assert.equal(result.workflow_status, "RECIPE_APPROVED");
  assert.deepEqual(calls[1], ["approve", 22, "admin", "RECETEYI_ONAYLA"]);
});

test("katalog capability yokluğu kontrollü durum olarak kaydedilir", async () => {
  const records = [];
  const service = new OpportunityService({
    repository: {
      get: async () => ({ id: 5, target_marketplace: "HEPSIBURADA", workflow_status: "RECIPE_APPROVED", proposed_recipe: {} }),
      recordCatalogSearch: async (_id, input) => { records.push(input); return { catalog_status: input.catalogStatus }; },
    },
    pim: {}, publication: {},
    marketplaceRegistry: {
      execute: async () => ({ ok: false, code: "MARKETPLACE_CREDENTIALS_MISSING", message: "Kimlik bilgileri bekleniyor" }),
    },
  });
  const result = await service.searchCatalog(5, "admin");
  assert.equal(result.opportunity.catalog_status, "MARKETPLACE_CREDENTIALS_MISSING");
  assert.equal(result.mutationPerformed, false);
  assert.equal(records[0].listingBarcodeRequired, false);
});

test("üretim düşük rekabet ve yüksek marj fırsatlarını yalnız mevcut pazar verisiyle çıkarır", async () => {
  let generated = [];
  const service = new OpportunityService({
    repository: {
      generationInputs: async () => ({
        physical: [],
        components: [{ recipe_id: 7, cost_item_code: "MENEKSE_1500", quantity: 2 }],
        recipes: [{ id: 7, status: "APPROVED", recipe_name: "Menekşe 1,5 L x 2", bundle_fingerprint: "fp", total_cost_minor: 20000, final_desi: 3 }],
        listings: [{ recipe_id: 7 }],
        matches: [],
        marketRows: [{ recipe_id: 7, buybox_price: 400, second_price: 410, third_price: 0, calculated_min_price: 300, my_price: 390, rank: 1, commission_rate: 17 }],
        sales: [{ recipe_id: 7, family_sales: 12 }],
      }),
      saveGenerated: async (items) => {
        generated = items;
        return items.map((item) => ({ ...item, opportunity_type: item.opportunityType }));
      },
    },
    pim: {},
    publication: {
      buildPreview: async () => ({
        pricing: { minimumPrice: 300, buyboxPrice: 400, proposedPrice: 399.9, shippingCost: 70, commissionRate: 17 },
        blockers: [],
      }),
    },
    marketplaceRegistry: {
      get: async () => ({ enabled: true, credentials_configured: true, capabilities: { supportsCatalogSearch: true } }),
    },
  });
  const result = await service.generate({ confirmation: "FIRSATLARI_URET", targetMarketplace: "TRENDYOL" }, "admin");
  assert.equal(result.byType.LOW_COMPETITION_GAP, 1);
  assert.equal(result.byType.HIGH_MARGIN_VARIANT, 1);
  assert.equal(generated.some((item) => item.opportunityType === "PROFITABLE_BUYBOX_GAP"), false);
});
