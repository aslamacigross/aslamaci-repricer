const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PublicationService,
  classifyTransfer,
  requiredAttributeErrors,
} = require("../../src/services/publication.service");

function fixture(overrides = {}) {
  const recipe = {
    id: 9,
    recipe_name: "Menekşe Çamaşır Yumuşatıcısı 1,5 L",
    status: "APPROVED",
    total_cost_minor: 11200,
    target_profit_minor: 4000,
    final_desi: 2,
    components: [{ brand: "Actisoft" }],
  };
  const context = {
    registry: {
      code: "TRENDYOL",
      enabled: true,
      default_carrier: "TEX",
      default_service_fee_minor: 1319,
      currency: "TRY",
    },
    sourceListing: {
      id: 2,
      title: recipe.recipe_name,
      stock: 5,
      sale_price_minor: 33000,
    },
    targetListing: null,
    catalogMatch: null,
    barcode: { id: 3, barcode: "ASL-TRE-TEST123" },
    categoryId: "cat-1",
    commission: { commission_rate: 17 },
    rates: [{ carrier: "TEX", desi_kg: 2, cost_inc_vat: 79 }],
    barems: [],
    packaging: [{ min_desi: 1, max_desi: 3, packaging_cost: 15 }],
    attributes: [],
  };
  const integration = {
    code: "TRENDYOL",
    enabled: true,
    credentials_configured: true,
    adapter_status: "READY",
    capabilities: { supportsNewProductCreate: true },
  };
  const repository = {
    targetContext: async () => ({ ...context, ...(overrides.context || {}) }),
  };
  const service = new PublicationService({
    repository,
    pim: {
      getRecipe: async () => ({ ...recipe, ...(overrides.recipe || {}) }),
    },
    marketplaceRegistry: {
      get: async () => ({ ...integration, ...(overrides.integration || {}) }),
      resolveListingIdentifiers: (_marketplace, input) => ({
        marketplaceProductId:
          input.catalogMatch?.marketplace_product_id || null,
        marketplaceCatalogBarcode:
          input.catalogMatch?.marketplace_catalog_barcode || null,
        sellerListingBarcode: input.allocatedSellerListingBarcode || null,
        sellerSku: input.sellerSku || null,
        externalListingId: input.externalListingId || null,
        semanticsVerified: true,
      }),
    },
    settings: {},
  });
  return { service, recipe, context };
}

test("Menekşe yayın fiyatı merkezi maliyet motoruyla 312,28 TL olur", async () => {
  const { service } = fixture();
  const preview = await service.buildPreview({
    recipeId: 9,
    sourceMarketplace: "HEPSIBURADA",
    targetMarketplace: "TRENDYOL",
    targetBrandId: "brand-1",
    stock: 5,
  });
  assert.equal(preview.pricing.minimumPrice, 312.28);
  assert.equal(preview.pricing.productCost, 112);
  assert.equal(preview.pricing.shippingCost, 79);
  assert.equal(preview.blockers.length, 0);
  assert.equal(preview.mutationPerformed, false);
});

test("credential eksik hedef kanal kontrollü blocker üretir", async () => {
  const { service } = fixture({
    integration: {
      code: "HEPSIBURADA",
      credentials_configured: false,
      capabilities: { supportsNewProductCreate: false },
    },
  });
  const preview = await service.buildPreview({
    recipeId: 9,
    sourceMarketplace: "TRENDYOL",
    targetMarketplace: "HEPSIBURADA",
    targetBrandId: "brand-1",
    stock: 5,
  });
  assert.equal(
    preview.blockers.includes("MARKETPLACE_CREDENTIALS_MISSING"),
    true,
  );
  assert.equal(classifyTransfer(preview), "BLOCKED");
});

test("zorunlu kategori özellikleri eksik değerleri açıklar", () => {
  assert.deepEqual(
    requiredAttributeErrors(
      [{ attribute_id: "renk", attribute_name: "Renk", required: true }],
      {},
    ),
    ["ATTRIBUTE_REQUIRED:renk"],
  );
});

test("ekonomik olmayan ilk sıra yerine ikinci sıra transfer fiyatı olur", async () => {
  const { service } = fixture();
  const preview = await service.buildPreview({
    recipeId: 9,
    sourceMarketplace: "HEPSIBURADA",
    targetMarketplace: "TRENDYOL",
    targetBrandId: "brand-1",
    stock: 5,
    buyboxPrice: 300,
    secondPrice: 330,
    thirdPrice: 350,
  });
  assert.equal(preview.pricing.rankRecommendation.targetRank, 2);
  assert.equal(preview.pricing.proposedPrice, 329.9);
});

test("yayın dry-run yalnız payload doğrulaması çağırır", async () => {
  const operations = [];
  const service = new PublicationService({
    repository: {
      getDraft: async () => ({
        id: 7,
        target_marketplace: "TRENDYOL",
        payload_json: { barcode: "ASL-TRE-TEST", title: "Test" },
        validation_errors: [],
      }),
      markDryRun: async (_id, _actor, preview) => ({
        id: 7,
        target_marketplace: "TRENDYOL",
        workflow_status: "DRY_RUN_COMPLETE",
        pricing_preview: preview,
      }),
    },
    pim: {},
    marketplaceRegistry: {
      execute: async (_marketplace, operation) => {
        operations.push(operation);
        return { ok: true, code: "LISTING_PAYLOAD_VALID" };
      },
    },
    settings: {},
  });
  const result = await service.publishDryRun(
    7,
    "admin",
    "YAYIN_DRY_RUN_ONAYLA",
  );
  assert.deepEqual(operations, ["validateListingPayload"]);
  assert.equal(result.result.mutationPerformed, false);
  assert.equal(result.draft.workflow_status, "DRY_RUN_COMPLETE");
});

test("aynı kanal aktarımı mevcut batchi taslak hazırlamadan döndürür", async () => {
  let previewCalls = 0;
  const existing = { id: 41, idempotency_key: "repeat-key", items: [] };
  const service = new PublicationService({
    repository: {
      findTransferBatchByIdempotencyKey: async (key) => {
        assert.equal(key, "repeat-key");
        return existing;
      },
      createTransferBatch: async () => {
        throw new Error("yeni batch oluşturulmamalı");
      },
    },
    pim: {},
    marketplaceRegistry: {},
    settings: {},
  });
  service.buildPreview = async () => {
    previewCalls++;
    throw new Error("preview çalışmamalı");
  };
  const result = await service.createTransfer(
    {
      sourceMarketplace: "TRENDYOL",
      targetMarketplace: "HEPSIBURADA",
      recipeIds: [9],
      idempotencyKey: "repeat-key",
    },
    "admin",
  );
  assert.equal(result, existing);
  assert.equal(previewCalls, 0);
});
