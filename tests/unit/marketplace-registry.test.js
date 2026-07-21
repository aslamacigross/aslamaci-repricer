const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MarketplaceAdapter,
} = require("../../src/marketplaces/marketplace-adapter");
const {
  HepsiburadaAdapter,
} = require("../../src/marketplaces/adapters/hepsiburada.adapter");
const {
  SkeletonMarketplaceAdapter,
} = require("../../src/marketplaces/adapters/skeleton.adapter");
const {
  MarketplaceRegistryService,
  safeErrorSummary,
} = require("../../src/services/marketplace-registry.service");

function repository(records) {
  return {
    list: async () => records,
    get: async (code) => records.find((item) => item.code === code),
    recordConnection: async (code, outcome) => ({ code, ...outcome }),
  };
}

describe("Marketplace adapter sözleşmesi", () => {
  test("ortak adapter bütün katalog, listing ve finans operasyonlarını tanımlar", () => {
    const adapter = new MarketplaceAdapter({ code: "TEST" });
    for (const operation of [
      "syncCategories",
      "syncCategoryAttributes",
      "syncBrands",
      "searchCatalog",
      "getCatalogProduct",
      "matchExistingCatalogProduct",
      "validateListingPayload",
      "createProductDraft",
      "createProduct",
      "createOfferOnExistingCatalogProduct",
      "updateProductContent",
      "updatePriceAndInventory",
      "fetchProducts",
      "fetchOrders",
      "fetchCommissions",
      "fetchBuybox",
      "fetchFinancialTransactions",
      "getBatchResult",
      "verifyPublishedListing",
    ])
      assert.equal(typeof adapter[operation], "function", operation);
  });

  test("capability olmayan işlemi kontrollü sonuçla reddeder", async () => {
    const adapter = new MarketplaceAdapter({
      code: "TEST",
      status: "READY",
      capabilities: { supportsOrders: true },
    });
    const result = await adapter.execute("searchCatalog", {});
    assert.equal(result.ok, false);
    assert.equal(result.code, "CAPABILITY_NOT_SUPPORTED");
  });

  test("capability mapinde bulunmayan operation fail-closed reddedilir", async () => {
    const adapter = new MarketplaceAdapter({
      code: "TEST",
      status: "READY",
      capabilities: { supportsOrders: true },
    });
    adapter.configured = () => true;
    adapter.unknownOperation = async () => ({ ok: true });
    assert.equal(adapter.supports("unknownOperation"), false);
    const result = await adapter.execute("unknownOperation", {});
    assert.equal(result.ok, false);
    assert.equal(result.code, "CAPABILITY_NOT_SUPPORTED");
  });

  test("Hepsiburada credential yokluğunu hata fırlatmadan bildirir", async () => {
    const adapter = new HepsiburadaAdapter({ configured: () => false });
    const result = await adapter.testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.code, "MARKETPLACE_CREDENTIALS_MISSING");
  });

  test("skeleton adapter gerçek çağrı yapmaz", async () => {
    const adapter = new SkeletonMarketplaceAdapter("N11");
    const result = await adapter.testConnection();
    assert.equal(result.code, "MARKETPLACE_ADAPTER_NOT_READY");
  });
});

describe("Marketplace registry", () => {
  test("credential eksik jobu sistem hatası olmadan skip eder", async () => {
    const records = [
      {
        code: "HEPSIBURADA",
        display_name: "Hepsiburada",
        enabled: true,
        adapter_status: "WAITING_CREDENTIALS",
        capabilities: {},
      },
    ];
    const service = new MarketplaceRegistryService({
      repository: repository(records),
      adapters: {
        HEPSIBURADA: new HepsiburadaAdapter({ configured: () => false }),
      },
    });
    const result = await service.runJob("HEPSIBURADA", "fetchOrders");
    assert.equal(result.status, "SKIPPED_CREDENTIALS_MISSING");
    assert.equal(result.failed, 0);
  });

  test("devre dışı skeleton pazaryerini çağırmaz", async () => {
    const records = [
      {
        code: "PAZARAMA",
        display_name: "Pazarama",
        enabled: false,
        adapter_status: "SKELETON",
        capabilities: {},
      },
    ];
    const service = new MarketplaceRegistryService({
      repository: repository(records),
      adapters: { PAZARAMA: new SkeletonMarketplaceAdapter("PAZARAMA") },
    });
    const result = await service.execute("PAZARAMA", "fetchOrders");
    assert.equal(result.code, "MARKETPLACE_DISABLED");
  });

  test("güvenli hata özeti credential değerlerini maskeler", () => {
    const summary = safeErrorSummary(
      new Error("Authorization=Basic abc123 token=super-secret"),
    );
    assert.equal(summary.includes("super-secret"), false);
    assert.equal(summary.includes("abc123"), false);
  });
});
