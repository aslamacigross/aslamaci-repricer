const { pool, withTransaction } = require("./config/database");
const { env } = require("./config/env");
const { AuthService } = require("./services/auth.service");
const { TrendyolService } = require("./services/trendyol.service");
const { CostEngineService } = require("./services/cost-engine.service");
const { SyncService } = require("./services/sync.service");
const { ShippingService } = require("./services/shipping.service");
const { RepricerService } = require("./services/repricer.service");
const { ActionService } = require("./services/action.service");
const { LearningService } = require("./services/learning.service");
const { JobService, safeItemError } = require("./services/job.service");
const { MaintenanceService } = require("./services/maintenance.service");
const { FileMarketService } = require("./services/file-market.service");
const { BizimMarketService } = require("./services/bizim-market.service");
const { BimMarketService } = require("./services/bim-market.service");
const { HealthService } = require("./services/health.service");
const { FinanceService } = require("./services/finance.service");
const { HepsiburadaService } = require("./services/hepsiburada.service");
const { DesiService } = require("./services/desi.service");
const { ShippingTariffService } = require("./services/shipping-tariff.service");
const {
  MarketplaceRegistryService,
} = require("./services/marketplace-registry.service");
const {
  MarketplaceRepository,
} = require("./repositories/marketplace.repository");
const { TrendyolAdapter } = require("./marketplaces/adapters/trendyol.adapter");
const {
  HepsiburadaAdapter,
} = require("./marketplaces/adapters/hepsiburada.adapter");
const {
  SkeletonMarketplaceAdapter,
} = require("./marketplaces/adapters/skeleton.adapter");
const {
  MappingAutomationService,
} = require("./services/mapping-automation.service");
const { ProductRepository } = require("./repositories/product.repository");
const { CostRepository } = require("./repositories/cost.repository");
const { DashboardRepository } = require("./repositories/dashboard.repository");
const { SettingsRepository } = require("./repositories/settings.repository");
const { AuditRepository } = require("./repositories/audit.repository");
const { ActionRepository } = require("./repositories/action.repository");
const { JobRepository } = require("./repositories/job.repository");
const {
  MappingAutomationRepository,
} = require("./repositories/mapping-automation.repository");
const { PimRepository } = require("./repositories/pim.repository");
const { PimService } = require("./services/pim.service");
const {
  PublicationRepository,
} = require("./repositories/publication.repository");
const { PublicationService } = require("./services/publication.service");
const {
  OpportunityRepository,
} = require("./repositories/opportunity.repository");
const { OpportunityService } = require("./services/opportunity.service");
const { ContentRepository } = require("./repositories/content.repository");
const { ContentService } = require("./services/content.service");
const { DeterministicContentProvider } = require("./services/content-provider");

function transactionFor(db) {
  if (db === pool) return withTransaction;
  return async (work) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}

function createContainer(overrides = {}) {
  const db = overrides.db || pool;
  const transaction = overrides.withTransaction || transactionFor(db);
  const auth = overrides.auth || new AuthService();
  const trendyol = overrides.trendyol || new TrendyolService();
  const hepsiburada = overrides.hepsiburada || new HepsiburadaService();
  const audit = overrides.audit || new AuditRepository(db);
  const settings = overrides.settings || new SettingsRepository(db);
  const products = overrides.products || new ProductRepository(db);
  const costs = overrides.costs || new CostRepository(db, transaction);
  const mappingAutomationRepository =
    overrides.mappingAutomationRepository ||
    new MappingAutomationRepository(db, transaction);
  const dashboard = overrides.dashboard || new DashboardRepository(db);
  const actions = overrides.actions || new ActionRepository(db, transaction);
  const jobs = overrides.jobs || new JobRepository(db);
  const marketplaceRepository =
    overrides.marketplaceRepository || new MarketplaceRepository(db);
  const pimRepository =
    overrides.pimRepository || new PimRepository(db, transaction);
  const publicationRepository =
    overrides.publicationRepository ||
    new PublicationRepository(db, transaction);
  const opportunityRepository =
    overrides.opportunityRepository ||
    new OpportunityRepository(db, transaction);
  const contentRepository =
    overrides.contentRepository || new ContentRepository(db, transaction);
  const costEngine = overrides.costEngine || new CostEngineService(db);
  const mappingAutomation =
    overrides.mappingAutomation ||
    new MappingAutomationService({
      repository: mappingAutomationRepository,
      costs,
      costEngine,
    });
  const shippingService =
    overrides.shippingService || new ShippingService(costs);
  const marketplaceRegistry =
    overrides.marketplaceRegistry ||
    new MarketplaceRegistryService({
      repository: marketplaceRepository,
      adapters: {
        TRENDYOL: new TrendyolAdapter(trendyol),
        HEPSIBURADA: new HepsiburadaAdapter(hepsiburada),
        PAZARAMA: new SkeletonMarketplaceAdapter("PAZARAMA"),
        IDEFIX: new SkeletonMarketplaceAdapter("IDEFIX"),
        N11: new SkeletonMarketplaceAdapter("N11"),
        PTTAVM: new SkeletonMarketplaceAdapter("PTTAVM"),
      },
    });
  const sync =
    overrides.sync || new SyncService({ db, trendyol, hepsiburada, audit });
  const repricer =
    overrides.repricer ||
    new RepricerService({
      db,
      actions,
      settings,
      marketplaceRegistry,
      sync,
    });
  const actionService =
    overrides.actionService ||
    new ActionService({
      db,
      withTransaction: transaction,
      actions,
      products,
      settings,
      trendyol,
      audit,
      repricer,
      marketplaceRegistry,
    });
  const learning =
    overrides.learning || new LearningService({ actions, sync, audit });
  const maintenance = new MaintenanceService(db, env.logRetentionDays);
  const jobService =
    overrides.jobService || new JobService({ db, repository: jobs });
  const fileMarket = overrides.fileMarket || new FileMarketService();
  const bizimMarket = overrides.bizimMarket || new BizimMarketService();
  const bimMarket = overrides.bimMarket || new BimMarketService();
  const desi = overrides.desi || new DesiService({ db, costEngine });
  const shippingTariff =
    overrides.shippingTariff || new ShippingTariffService({ db });
  const health =
    overrides.health || new HealthService({ db, trendyol, hepsiburada });
  const finance =
    overrides.finance || new FinanceService({ db, trendyol, hepsiburada });
  const pim = overrides.pim || new PimService({ repository: pimRepository });
  const publication =
    overrides.publication ||
    new PublicationService({
      repository: publicationRepository,
      pim,
      marketplaceRegistry,
      settings,
    });
  const opportunity =
    overrides.opportunity ||
    new OpportunityService({
      repository: opportunityRepository,
      pim,
      publication,
      marketplaceRegistry,
    });
  const contentProvider =
    overrides.contentProvider || new DeterministicContentProvider();
  const content =
    overrides.content ||
    new ContentService({
      repository: contentRepository,
      pim,
      marketplaceRegistry,
      provider: contentProvider,
    });
  const recalculateAllMarketplaces = async () => {
    const results = await Promise.all(
      ["TRENDYOL", "HEPSIBURADA"].map((marketplace) =>
        costEngine.recalculate(undefined, undefined, marketplace),
      ),
    );
    return {
      processed: results.reduce(
        (total, result) => total + Number(result.processed || 0),
        0,
      ),
      successful: results.reduce(
        (total, result) => total + Number(result.processed || 0),
        0,
      ),
      failed: 0,
      metadata: {
        marketplaces: {
          TRENDYOL: results[0].processed,
          HEPSIBURADA: results[1].processed,
        },
      },
    };
  };
  jobService.register("sync-file-market-prices", () =>
    mappingAutomation.syncLiveFileItems(fileMarket),
  );
  jobService.register("sync-bizim-market-prices", () =>
    mappingAutomation.syncLiveSupplierItems("BIZIM_MARKET", bizimMarket),
  );
  jobService.register("sync-bim-market-prices", () =>
    mappingAutomation.syncLiveSupplierItems("BIM", bimMarket),
  );
  jobService.register("sync-products", () => sync.products());
  jobService.register("sync-hepsiburada-products", async () => {
    const result = await sync.hepsiburadaProducts();
    let recalculation;
    try {
      recalculation = await costEngine.recalculate(
        undefined,
        undefined,
        "HEPSIBURADA",
      );
    } catch (error) {
      recalculation = {
        ok: false,
        code: error.code || "COST_RECALCULATION_FAILED",
        message: error.message,
      };
    }
    return {
      ...result,
      metadata: { ...(result.metadata || {}), recalculation },
    };
  });
  jobService.register("sync-buybox", () => sync.buybox());
  jobService.register("sync-buybox-adaptive", () => sync.adaptiveBuybox());
  jobService.register("calculate-costs", recalculateAllMarketplaces);
  jobService.register("validate-data", recalculateAllMarketplaces);
  jobService.register("generate-mapping-suggestions", (metadata = {}) =>
    mappingAutomation.generate({
      limit: 1000,
      marketplace: metadata.marketplace || "TRENDYOL",
    }),
  );
  jobService.register("generate-repricer-actions", (metadata = {}) =>
    repricer.generate({
      source: "JOB",
      marketplace: metadata.marketplace || "TRENDYOL",
    }),
  );
  jobService.register("generate-hepsiburada-repricer-actions", () =>
    repricer.generate({ source: "JOB", marketplace: "HEPSIBURADA" }),
  );
  jobService.register("run-hepsiburada-repricer-dry-run", async () => {
    const global = await repricer.globalSettings();
    if (!global.dryRun)
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        metadata: { status: "SKIPPED_DRY_RUN_REQUIRED" },
      };
    const generated = await repricer.generate({
      source: "JOB",
      marketplace: "HEPSIBURADA",
    });
    return {
      processed: generated.processed,
      successful: generated.created,
      failed: generated.errors?.length || 0,
      metadata: {
        dryRun: true,
        created: generated.created,
        skipped: generated.skipped,
      },
    };
  });
  jobService.register("run-auto-repricer", async () => {
    const global = await repricer.globalSettings();
    const verification = await learning.verifyPendingActions();
    const openAutomationActions =
      global.dryRun || !global.repricerEnabled
        ? []
        : await actions.openAutomationActions("TRENDYOL", 500);
    const generated = await repricer.generate({ source: "AUTO" });
    if (global.dryRun || !global.repricerEnabled)
      return {
        processed: generated.processed,
        successful: 0,
        failed: 0,
        metadata: {
          dryRun: global.dryRun,
          repricerEnabled: global.repricerEnabled,
          created: generated.created,
          skipped: generated.skipped,
          verification,
        },
      };
    let successful = 0,
      failed = 0,
      stale = 0;
    const itemErrors = [];
    const actionById = new Map();
    for (const action of openAutomationActions)
      actionById.set(action.id, action);
    for (const action of generated.items) actionById.set(action.id, action);
    for (const action of actionById.values()) {
      try {
        const product = await products.get(action.barcode, action.marketplace);
        if (
          product?.settings?.mode !== "AUTOMATIC" ||
          !product?.settings?.auto_update
        )
          continue;
        if (action.status === "PENDING")
          await actionService.approve(action.id, "system");
        await actionService.apply(action.id, "system");
        successful++;
      } catch (error) {
        if (["PRICE_MISMATCH", "MARKET_PRICE_MISMATCH"].includes(error.code)) {
          stale++;
          continue;
        }
        failed++;
        itemErrors.push(safeItemError(action, error));
        const latest = await actions.get(action.id);
        if (
          latest &&
          ["PENDING", "APPROVED", "SENDING"].includes(latest.status)
        ) {
          await actions.updateStatus(action.id, "FAILED", {
            actor: "system",
            error: error.message,
          });
        }
      }
    }
    return {
      processed: actionById.size,
      successful,
      failed,
      metadata: {
        created: generated.created,
        skipped: generated.skipped,
        openAutomation: openAutomationActions.length,
        stale,
        verification,
        itemErrors,
      },
    };
  });
  jobService.register("check-action-outcomes-5m", () =>
    learning.checkOutcomes(5),
  );
  jobService.register("check-action-outcomes-15m", () =>
    learning.checkOutcomes(15),
  );
  jobService.register("check-action-outcomes-60m", () =>
    learning.checkOutcomes(60),
  );
  jobService.register("cleanup-old-logs", async () => {
    const current = await settings.getAll();
    return maintenance.cleanup(current.log_retention_days);
  });
  jobService.register("dashboard-cache-refresh", async () => {
    const results = await Promise.all([
      dashboard.refresh("TRENDYOL"),
      dashboard.refresh("HEPSIBURADA"),
    ]);
    return {
      processed: 2,
      successful: results.filter((result) => !result.failed).length,
      failed: results.reduce(
        (total, result) => total + Number(result.failed || 0),
        0,
      ),
    };
  });
  jobService.register("daily-system-health", () => health.scan());
  jobService.register("estimate-cost-desi", () => desi.estimateSupplierCosts());
  jobService.register("import-hepsiburada-shipping", () =>
    shippingTariff.importHepsiburada(),
  );
  jobService.register("sync-orders", () => finance.syncOrders());
  jobService.register("sync-hepsiburada-orders", () =>
    finance.syncHepsiburadaOrders(),
  );
  jobService.register("sync-financial-transactions", () =>
    finance.syncFinancialTransactions(),
  );
  jobService.register("sync-trendyol-cargo-invoices", () =>
    finance.syncCargoInvoices(),
  );
  jobService.register("backfill-trendyol-finance-history", () =>
    finance.backfillTrendyolHistory(),
  );
  jobService.register("bootstrap-pim", () => pim.bootstrap());
  jobService.register("marketplace-category-sync", (metadata = {}) =>
    marketplaceRegistry.runJob(
      metadata.marketplace || "TRENDYOL",
      "syncCategories",
      metadata,
    ),
  );
  jobService.register("marketplace-attribute-sync", (metadata = {}) =>
    marketplaceRegistry.runJob(
      metadata.marketplace || "TRENDYOL",
      "syncCategoryAttributes",
      metadata,
    ),
  );
  jobService.register("marketplace-brand-sync", (metadata = {}) =>
    marketplaceRegistry.runJob(
      metadata.marketplace || "TRENDYOL",
      "syncBrands",
      metadata,
    ),
  );
  jobService.register("catalog-matching", async () => ({
    processed: 0,
    successful: 0,
    failed: 0,
    metadata: { status: "WAITING_FOR_CATALOG_CAPABILITY" },
  }));
  jobService.register("publish-batch-verification", async () => ({
    processed: 0,
    successful: 0,
    failed: 0,
    metadata: { status: "SKIPPED_PRODUCT_PUBLISHING_DISABLED" },
  }));
  jobService.register("listing-content-verification", async () => ({
    processed: 0,
    successful: 0,
    failed: 0,
    metadata: { status: "SKIPPED_PRODUCT_PUBLISHING_DISABLED" },
  }));
  jobService.register("opportunity-generation", (metadata = {}) =>
    opportunity.generate(
      {
        targetMarketplace: metadata.marketplace || "TRENDYOL",
        confirmation: "FIRSATLARI_URET",
      },
      "system-job",
    ),
  );
  jobService.register("listing-health-scan", (metadata = {}) =>
    content.scanHealth(
      {
        marketplace: metadata.marketplace || "TRENDYOL",
        confirmation: "LISTING_SAGLIGINI_TARA",
      },
      "system-job",
    ),
  );
  jobService.register("content-quality-scan", async () => ({
    processed: 0,
    successful: 0,
    failed: 0,
    metadata: { status: "SKIPPED_REQUIRES_HUMAN_DRAFT_SELECTION" },
  }));
  return {
    db,
    auth,
    trendyol,
    hepsiburada,
    audit,
    settings,
    products,
    costs,
    fileMarket,
    bizimMarket,
    bimMarket,
    health,
    desi,
    shippingTariff,
    finance,
    marketplaceRepository,
    marketplaceRegistry,
    pimRepository,
    pim,
    publicationRepository,
    publication,
    opportunityRepository,
    opportunity,
    contentRepository,
    contentProvider,
    content,
    mappingAutomationRepository,
    mappingAutomation,
    dashboard,
    actions,
    jobs,
    costEngine,
    shippingService,
    sync,
    repricer,
    actionService,
    learning,
    jobService,
  };
}
module.exports = { createContainer };
