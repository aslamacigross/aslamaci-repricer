const crypto = require("crypto");
const {
  calculateMinimumPrice,
  calculateNetProfit,
  calculateNetMargin,
  selectShippingCost,
  selectPackagingCost,
  toMoneyMinor,
  fromMoneyMinor,
} = require("../domain/pricing");
const { recommendRankPrice } = require("../domain/repricer");
const { AppError } = require("../utils/errors");

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function requiredAttributeErrors(definitions, values = {}) {
  return definitions
    .filter((item) => item.required)
    .filter(
      (item) =>
        values[item.attribute_id] == null &&
        values[item.attribute_name] == null,
    )
    .map((item) => `ATTRIBUTE_REQUIRED:${item.attribute_id}`);
}

function classifyTransfer(preview) {
  const blockers = preview.blockers || [];
  const has = (code) => blockers.includes(code);
  if (has("COST_MAPPING_MISSING")) return "COST_MAPPING_MISSING";
  if (has("DESI_MISSING")) return "DESI_MISSING";
  if (has("COMMISSION_MISSING")) return "COMMISSION_MISSING";
  if (has("SHIPPING_TARIFF_MISSING")) return "SHIPPING_TARIFF_MISSING";
  if (has("CATEGORY_MAPPING_REQUIRED")) return "CATEGORY_MAPPING_REQUIRED";
  if (blockers.some((code) => code.startsWith("ATTRIBUTE_REQUIRED:")))
    return "ATTRIBUTE_MAPPING_REQUIRED";
  if (has("LISTING_BARCODE_REQUIRED")) return "LISTING_BARCODE_REQUIRED";
  if (
    preview.pricing?.rankRecommendation?.status === "BUYBOX_TARGET_NOT_ECONOMIC"
  )
    return "PRICE_NOT_PROFITABLE";
  if (
    blockers.some((code) =>
      [
        "MARKETPLACE_CREDENTIALS_MISSING",
        "MARKETPLACE_DISABLED",
        "MARKETPLACE_ADAPTER_NOT_READY",
        "CAPABILITY_NOT_SUPPORTED",
        "RECIPE_NOT_APPROVED",
        "STOCK_REQUIRED",
        "BRAND_MAPPING_REQUIRED",
      ].includes(code),
    )
  )
    return "BLOCKED";
  if (preview.catalog.status === "CONFIRMED" && blockers.length === 0)
    return "READY_TO_LIST";
  if (preview.catalog.status === "REVIEW_REQUIRED")
    return "EXISTING_MATCH_REVIEW_REQUIRED";
  if (preview.catalog.status === "CONFIRMED") return "EXISTING_MATCH_CONFIRMED";
  if (preview.publicationMode === "NEW_PRODUCT" && blockers.length === 0)
    return "READY_TO_LIST";
  return "NEW_PRODUCT_REQUIRED";
}

class PublicationService {
  constructor({ repository, pim, marketplaceRegistry, settings }) {
    this.repository = repository;
    this.pim = pim;
    this.marketplaceRegistry = marketplaceRegistry;
    this.settings = settings;
  }

  listDrafts(filters) {
    return this.repository.listDrafts(filters);
  }

  getDraft(id) {
    return this.repository.getDraft(id);
  }

  listCategories(marketplace) {
    return this.repository.listCategories(marketplace);
  }

  listBrands(marketplace, search) {
    return this.repository.listBrands(marketplace, search);
  }

  listTransferBatches() {
    return this.repository.listTransferBatches();
  }

  getTransferBatch(id) {
    return this.repository.getTransferBatch(id);
  }

  async approveRecipe(id, actor, confirmation) {
    if (confirmation !== "RECETEYI_ONAYLA")
      throw new AppError(
        "Reçete onayı için açık onay gerekli",
        409,
        "RECIPE_APPROVAL_CONFIRMATION_REQUIRED",
      );
    return this.repository.approveRecipe(id, actor);
  }

  pricingPreview(recipe, context, input = {}) {
    const productCost = fromMoneyMinor(recipe.total_cost_minor);
    const desi = Number(recipe.final_desi || 0);
    const packagingCost = selectPackagingCost(desi, context.packaging);
    const serviceFee = fromMoneyMinor(
      context.registry?.default_service_fee_minor || 0,
    );
    const commissionRate = Number(context.commission?.commission_rate || 0);
    const carrier = context.registry?.default_carrier || "";
    const targetProfit = fromMoneyMinor(recipe.target_profit_minor || 0);
    const sourcePrice = fromMoneyMinor(
      context.sourceListing?.sale_price_minor || 0,
    );
    const competitors = [
      input.buyboxPrice,
      input.secondPrice,
      input.thirdPrice,
    ].map(Number);
    let referencePrice =
      Number(input.requestedPrice || 0) ||
      competitors.find((value) => value > 0) ||
      sourcePrice;
    let shippingCost = 0;
    let minimumPrice = 0;
    for (let iteration = 0; iteration < 3; iteration++) {
      shippingCost = selectShippingCost({
        salePrice: referencePrice,
        desi,
        barems: context.barems,
        costs: context.rates,
        carrier,
      });
      minimumPrice = calculateMinimumPrice({
        productCost,
        shippingCost,
        packagingCost,
        serviceFee,
        targetProfit,
        commissionRate,
      });
      if (!minimumPrice || Math.abs(referencePrice - minimumPrice) < 0.01)
        break;
      referencePrice = minimumPrice;
    }
    const rankRecommendation = recommendRankPrice({
      minimumPrice,
      competitorPrices: competitors,
      undercut: input.undercut ?? 0.1,
      fallbackPrice: Number(input.requestedPrice || 0) || sourcePrice,
    });
    const proposedPrice = rankRecommendation.proposedPrice;
    const moneyInput = {
      salePrice: proposedPrice,
      commissionRate,
      productCost,
      shippingCost,
      packagingCost,
      serviceFee,
    };
    return {
      currency: context.registry?.currency || "TRY",
      productCost,
      desi,
      carrier,
      shippingCost,
      packagingCost,
      serviceFee,
      targetProfit,
      commissionRate,
      minimumPrice,
      requestedPrice: Number(input.requestedPrice || 0) || null,
      buyboxPrice: competitors[0] || null,
      secondPrice: competitors[1] || null,
      thirdPrice: competitors[2] || null,
      proposedPrice,
      expectedNetProfit: calculateNetProfit(moneyInput),
      expectedNetMargin: calculateNetMargin(moneyInput),
      rankRecommendation,
    };
  }

  async buildPreview(input = {}) {
    const recipeId = Number(input.recipeId);
    const targetMarketplace = String(
      input.targetMarketplace || "",
    ).toUpperCase();
    const sourceMarketplace = input.sourceMarketplace
      ? String(input.sourceMarketplace).toUpperCase()
      : null;
    if (!recipeId || !targetMarketplace)
      throw new AppError(
        "Reçete ve hedef pazaryeri zorunlu",
        400,
        "VALIDATION_ERROR",
      );
    if (sourceMarketplace === targetMarketplace)
      throw new AppError(
        "Kaynak ve hedef pazaryeri farklı olmalı",
        400,
        "SAME_MARKETPLACE_NOT_ALLOWED",
      );
    const recipe = await this.pim.getRecipe(recipeId);
    if (!recipe)
      throw new AppError("Reçete bulunamadı", 404, "RECIPE_NOT_FOUND");
    const integration = await this.marketplaceRegistry.get(targetMarketplace);
    if (!integration)
      throw new AppError("Pazaryeri bulunamadı", 404, "MARKETPLACE_NOT_FOUND");
    const context = await this.repository.targetContext({
      recipeId,
      sourceMarketplace,
      targetMarketplace,
      categoryId: input.targetCategoryId,
    });
    const match = context.catalogMatch;
    const publicationMode =
      match?.match_status === "CONFIRMED"
        ? "EXISTING_CATALOG_OFFER"
        : "NEW_PRODUCT";
    const listingBarcode =
      publicationMode === "EXISTING_CATALOG_OFFER"
        ? match?.marketplace_catalog_barcode
        : context.barcode?.barcode;
    const attributes = input.attributes || {};
    const pricing = this.pricingPreview(recipe, context, input);
    const capability =
      publicationMode === "EXISTING_CATALOG_OFFER"
        ? "supportsExistingCatalogOfferCreate"
        : "supportsNewProductCreate";
    const blockers = [];
    if (!integration.enabled) blockers.push("MARKETPLACE_DISABLED");
    if (!integration.credentials_configured)
      blockers.push("MARKETPLACE_CREDENTIALS_MISSING");
    if (["SKELETON", "DISABLED"].includes(integration.adapter_status))
      blockers.push("MARKETPLACE_ADAPTER_NOT_READY");
    if (!integration.capabilities?.[capability])
      blockers.push("CAPABILITY_NOT_SUPPORTED");
    if (recipe.status !== "APPROVED") blockers.push("RECIPE_NOT_APPROVED");
    if (!(Number(recipe.total_cost_minor) > 0))
      blockers.push("COST_MAPPING_MISSING");
    if (!(Number(recipe.final_desi) > 0)) blockers.push("DESI_MISSING");
    if (!context.categoryId) blockers.push("CATEGORY_MAPPING_REQUIRED");
    if (!(pricing.commissionRate > 0)) blockers.push("COMMISSION_MISSING");
    if (!(pricing.shippingCost > 0)) blockers.push("SHIPPING_TARIFF_MISSING");
    if (!context.packaging.length) blockers.push("PACKAGING_RULE_MISSING");
    if (!listingBarcode) blockers.push("LISTING_BARCODE_REQUIRED");
    if (!(Number(input.stock ?? context.sourceListing?.stock ?? 0) > 0))
      blockers.push("STOCK_REQUIRED");
    if (!input.targetBrandId && recipe.components.some((item) => item.brand))
      blockers.push("BRAND_MAPPING_REQUIRED");
    blockers.push(...requiredAttributeErrors(context.attributes, attributes));
    if (match && match.match_status === "REVIEW_REQUIRED")
      blockers.push("CATALOG_MATCH_REVIEW_REQUIRED");
    const title =
      input.title || context.sourceListing?.title || recipe.recipe_name;
    const description =
      input.description || context.sourceListing?.description || "";
    const images = input.images || context.sourceListing?.images || [];
    const payload = {
      marketplace: targetMarketplace,
      recipeId,
      marketplaceProductId: match?.marketplace_product_id || null,
      marketplaceCatalogBarcode: match?.marketplace_catalog_barcode || null,
      barcode: listingBarcode || null,
      categoryId: context.categoryId,
      brandId: input.targetBrandId || null,
      title,
      description,
      attributes,
      images,
      stock: Number(input.stock ?? context.sourceListing?.stock ?? 0),
      salePrice: pricing.proposedPrice,
    };
    return {
      recipe,
      integration,
      context,
      publicationMode,
      catalog: {
        status: match?.match_status || "NOT_FOUND",
        matchId: match?.id || null,
        confidence: Number(match?.match_confidence || 0),
        marketplaceProductId: match?.marketplace_product_id || null,
        marketplaceCatalogBarcode: match?.marketplace_catalog_barcode || null,
      },
      listingBarcode: listingBarcode || null,
      pricing,
      payload,
      blockers: unique(blockers),
      dryRun: true,
      mutationPerformed: false,
    };
  }

  async createDraft(input = {}, actor) {
    const preview = await this.buildPreview(input);
    const workflowStatus = preview.blockers.includes(
      "CATEGORY_MAPPING_REQUIRED",
    )
      ? "CATEGORY_REVIEW"
      : preview.blockers.some((code) => code.startsWith("ATTRIBUTE_REQUIRED:"))
        ? "ATTRIBUTE_REVIEW"
        : preview.blockers.length
          ? "PRICE_REVIEW"
          : "READY_TO_PUBLISH";
    const draft = await this.repository.saveDraft({
      recipeId: preview.recipe.id,
      sourceMarketplace: input.sourceMarketplace
        ? String(input.sourceMarketplace).toUpperCase()
        : null,
      sourceListingId: preview.context.sourceListing?.id,
      targetMarketplace: preview.integration.code,
      catalogMatchId: preview.catalog.matchId,
      listingBarcodePoolId: preview.context.barcode?.id,
      workflowStatus,
      publicationMode: preview.publicationMode,
      targetCategoryId: preview.context.categoryId,
      targetBrandId: input.targetBrandId,
      title: preview.payload.title,
      description: preview.payload.description,
      attributes: preview.payload.attributes,
      images: preview.payload.images,
      stock: preview.payload.stock,
      requestedPriceMinor: input.requestedPrice
        ? toMoneyMinor(input.requestedPrice)
        : null,
      pricingPreview: preview.pricing,
      validationErrors: preview.blockers,
      payload: preview.payload,
      actor,
    });
    return { draft, preview };
  }

  async publishDryRun(id, actor, confirmation) {
    if (confirmation !== "YAYIN_DRY_RUN_ONAYLA")
      throw new AppError(
        "Yayın dry-run için açık onay gerekli",
        409,
        "PUBLISH_DRY_RUN_CONFIRMATION_REQUIRED",
      );
    const draft = await this.repository.getDraft(id);
    if (!draft) throw new AppError("Taslak bulunamadı", 404, "DRAFT_NOT_FOUND");
    const adapterPreview = await this.marketplaceRegistry.execute(
      draft.target_marketplace,
      "validateListingPayload",
      draft.payload_json,
    );
    const result = {
      dryRun: true,
      mutationPerformed: false,
      adapter: adapterPreview,
      blockers: draft.validation_errors,
      safety: {
        productPublishingEnabled: false,
        userApprovedDryRun: true,
        realMutationAllowed: false,
      },
    };
    const updated = await this.repository.markDryRun(id, actor, result);
    return { draft: updated, result };
  }

  async createTransfer(input = {}, actor) {
    const sourceMarketplace = String(
      input.sourceMarketplace || "",
    ).toUpperCase();
    const targetMarketplace = String(
      input.targetMarketplace || "",
    ).toUpperCase();
    const recipeIds = unique((input.recipeIds || []).map(Number)).filter(
      (id) => id > 0,
    );
    if (!sourceMarketplace || !targetMarketplace || !recipeIds.length)
      throw new AppError(
        "Kaynak, hedef ve en az bir reçete zorunlu",
        400,
        "VALIDATION_ERROR",
      );
    const items = [];
    for (const recipeId of recipeIds) {
      const created = await this.createDraft(
        { recipeId, sourceMarketplace, targetMarketplace },
        actor,
      );
      const itemStatus = classifyTransfer(created.preview);
      items.push({
        recipeId,
        sourceListingId: created.preview.context.sourceListing?.id,
        publicationDraftId: created.draft.id,
        itemStatus,
        catalogMatchStatus: created.preview.catalog.status,
        blockerCodes: created.preview.blockers,
        preview: {
          publicationMode: created.preview.publicationMode,
          catalog: created.preview.catalog,
          pricing: created.preview.pricing,
          payload: created.preview.payload,
        },
      });
    }
    const idempotencyKey =
      input.idempotencyKey ||
      crypto
        .createHash("sha256")
        .update(
          `${sourceMarketplace}:${targetMarketplace}:${recipeIds.sort((a, b) => a - b).join(",")}`,
        )
        .digest("hex");
    return this.repository.createTransferBatch(
      { sourceMarketplace, targetMarketplace, idempotencyKey, actor },
      items,
    );
  }
}

module.exports = {
  PublicationService,
  classifyTransfer,
  requiredAttributeErrors,
};
