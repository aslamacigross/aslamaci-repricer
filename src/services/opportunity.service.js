const crypto = require("crypto");
const {
  scoreOpportunity,
  generatePackCandidates,
  generateMixedBundleCandidates,
} = require("../domain/opportunity");
const { bundleFingerprint } = require("../domain/pim");
const { AppError } = require("../utils/errors");

function hashKey(parts) {
  return crypto.createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

function ageInDays(value) {
  if (!value) return null;
  return Math.max(0, (Date.now() - new Date(value).getTime()) / 86400000);
}

function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }
  return grouped;
}

function catalogState(recipeId, listingsByRecipe, matchesByRecipe, integration) {
  if (listingsByRecipe.get(recipeId)?.length)
    return { status: "EXISTING_LISTING", barcodeRequired: false };
  const match = matchesByRecipe.get(recipeId)?.[0];
  if (match?.match_status === "CONFIRMED")
    return { status: "MATCH_CONFIRMED", barcodeRequired: false };
  if (match)
    return { status: "MATCH_REVIEW_REQUIRED", barcodeRequired: false };
  if (!integration?.enabled)
    return { status: "MARKETPLACE_DISABLED", barcodeRequired: false };
  if (!integration?.credentials_configured)
    return { status: "MARKETPLACE_CREDENTIALS_MISSING", barcodeRequired: false };
  if (!integration.capabilities?.supportsCatalogSearch)
    return { status: "CAPABILITY_NOT_SUPPORTED", barcodeRequired: false };
  return { status: "SEARCH_REQUIRED", barcodeRequired: false };
}

class OpportunityService {
  constructor({ repository, pim, publication, marketplaceRegistry }) {
    this.repository = repository;
    this.pim = pim;
    this.publication = publication;
    this.marketplaceRegistry = marketplaceRegistry;
  }

  list(filters) { return this.repository.list(filters); }
  get(id) { return this.repository.get(id); }

  async economicsForRecipe(recipe, targetMarketplace, marketRow) {
    const sourceMarketplace = targetMarketplace === "TRENDYOL" ? "HEPSIBURADA" : "TRENDYOL";
    try {
      const preview = await this.publication.buildPreview({
        recipeId: recipe.id,
        sourceMarketplace,
        targetMarketplace,
        stock: 1,
        buyboxPrice: marketRow?.buybox_price,
        secondPrice: marketRow?.second_price,
        thirdPrice: marketRow?.third_price,
      });
      return {
        ...preview.pricing,
        blockers: preview.blockers,
        dataStatus: preview.blockers.length ? "PARTIAL" : "COMPLETE",
      };
    } catch (error) {
      return {
        productCost: Number(recipe.total_cost_minor || 0) / 100,
        desi: Number(recipe.final_desi || 0),
        dataStatus: "PARTIAL",
        missing: [error.code || "PRICING_CONTEXT_MISSING"],
      };
    }
  }

  async generate(input = {}, actor) {
    if (input.confirmation !== "FIRSATLARI_URET")
      throw new AppError("Fırsat üretimi için açık onay gerekli", 409, "OPPORTUNITY_GENERATION_CONFIRMATION_REQUIRED");
    const targetMarketplace = String(input.targetMarketplace || "TRENDYOL").toUpperCase();
    const sourceMarketplace = input.sourceMarketplace
      ? String(input.sourceMarketplace).toUpperCase()
      : targetMarketplace === "TRENDYOL" ? null : "TRENDYOL";
    const [data, integration] = await Promise.all([
      this.repository.generationInputs(targetMarketplace),
      this.marketplaceRegistry.get(targetMarketplace),
    ]);
    if (!integration) throw new AppError("Pazaryeri bulunamadı", 404, "MARKETPLACE_NOT_FOUND");
    const componentsByRecipe = groupBy(data.components, "recipe_id");
    const listingsByRecipe = groupBy(data.listings, "recipe_id");
    const matchesByRecipe = groupBy(data.matches, "recipe_id");
    const marketByRecipe = new Map(data.marketRows.map((item) => [item.recipe_id, item]));
    const salesByRecipe = new Map(data.sales.map((item) => [item.recipe_id, Number(item.family_sales || 0)]));
    const existingFingerprints = new Set(data.recipes.map((item) => item.bundle_fingerprint));
    const recipes = data.recipes.map((recipe) => ({
      ...recipe,
      components: componentsByRecipe.get(recipe.id) || [],
    }));
    const physical = data.physical.map((item) => ({
      id: item.id,
      productName: item.product_name,
      brand: item.brand,
      productFamily: item.product_family,
      variant: item.variant,
      category: item.category,
      costItemCode: item.cost_item_code,
      unitCostMinor: Math.round(Number(item.unit_cost || 0) * 100),
      unitDesi: Number(item.unit_desi || 0),
      supplierFreshnessDays: ageInDays(item.source_checked_at || item.cost_updated_at),
      stockAvailable: true,
    }));
    const opportunities = [];
    const add = (item) => opportunities.push({
      sourceMarketplace,
      targetMarketplace,
      ...item,
      opportunityKey: hashKey([
        item.opportunityType,
        targetMarketplace,
        item.recipeId || item.bundleFingerprint,
      ]),
    });

    for (const recipe of recipes.filter((item) => item.status === "APPROVED")) {
      const market = marketByRecipe.get(recipe.id);
      const missingListing = !listingsByRecipe.get(recipe.id)?.length;
      const gap = Number(market?.buybox_price || 0) - Number(market?.calculated_min_price || 0);
      const profitableRankGap = market && gap > 0 && Number(market.rank || 99) > 1;
      const competitorCount = [market?.buybox_price, market?.second_price, market?.third_price]
        .filter((value) => Number(value) > 0).length;
      const lowCompetitionGap = market && competitorCount > 0 && competitorCount <= 2 && gap > 0;
      const currentPrice = Number(market?.my_price || market?.sale_price || 0);
      const minimumPrice = Number(market?.calculated_min_price || 0);
      const highMarginVariant = market && currentPrice > 0 && minimumPrice > 0 && currentPrice / minimumPrice >= 1.25;
      if (!missingListing && !profitableRankGap && !lowCompetitionGap && !highMarginVariant) continue;
      const catalog = catalogState(recipe.id, listingsByRecipe, matchesByRecipe, integration);
      const economics = await this.economicsForRecipe(recipe, targetMarketplace, market);
      const score = scoreOpportunity({
        minimumPrice: economics.minimumPrice || market?.calculated_min_price,
        buyboxPrice: economics.buyboxPrice || market?.buybox_price,
        competitorCount: competitorCount || null,
        familySales: salesByRecipe.get(recipe.id),
        shippingRatio: economics.proposedPrice > 0 ? economics.shippingCost / economics.proposedPrice : null,
        commissionRate: economics.commissionRate || market?.commission_rate,
      });
      if (missingListing)
        add({
          opportunityType: "MISSING_MARKETPLACE", recipeId: recipe.id,
          proposedRecipe: { recipeName: recipe.recipe_name, components: recipe.components.map((item) => ({ costItemCode: item.cost_item_code, quantity: Number(item.quantity) })) },
          bundleFingerprint: recipe.bundle_fingerprint, score: score.score, confidence: score.confidence,
          signals: score.signals, economics, catalogStatus: catalog.status,
          listingBarcodeRequired: catalog.barcodeRequired,
          dataQuality: { missing: score.missing, economics: economics.dataStatus },
          generationReason: "Reçete hedef pazaryerinde listelenmiyor",
        });
      if (profitableRankGap)
        add({
          opportunityType: "PROFITABLE_BUYBOX_GAP", recipeId: recipe.id,
          proposedRecipe: {}, bundleFingerprint: recipe.bundle_fingerprint,
          score: score.score, confidence: score.confidence, signals: score.signals,
          economics, catalogStatus: catalog.status, listingBarcodeRequired: false,
          dataQuality: { missing: score.missing, economics: economics.dataStatus },
          generationReason: "Minimum kâr korunarak daha iyi sıra olasılığı var",
        });
      if (lowCompetitionGap)
        add({
          opportunityType: "LOW_COMPETITION_GAP", recipeId: recipe.id,
          proposedRecipe: {}, bundleFingerprint: recipe.bundle_fingerprint,
          score: score.score, confidence: score.confidence, signals: score.signals,
          economics, catalogStatus: catalog.status, listingBarcodeRequired: false,
          dataQuality: { missing: score.missing, economics: economics.dataStatus },
          generationReason: `Gözlenen fiyat kademesinde yalnız ${competitorCount} rakip fiyatı var ve minimum fiyat korunabiliyor`,
        });
      if (highMarginVariant)
        add({
          opportunityType: "HIGH_MARGIN_VARIANT", recipeId: recipe.id,
          proposedRecipe: {}, bundleFingerprint: recipe.bundle_fingerprint,
          score: score.score, confidence: score.confidence, signals: score.signals,
          economics, catalogStatus: catalog.status, listingBarcodeRequired: false,
          dataQuality: { missing: score.missing, economics: economics.dataStatus },
          generationReason: `Mevcut fiyat minimum fiyatın en az %25 üzerinde (${Math.round((currentPrice / minimumPrice - 1) * 100)}%)`,
        });
    }

    const singleFingerprints = new Set(
      physical.map((product) => bundleFingerprint([{ costItemCode: product.costItemCode, quantity: 1 }])),
    );
    for (const product of physical.filter((item) => !existingFingerprints.has(bundleFingerprint([{ costItemCode: item.costItemCode, quantity: 1 }])))) {
      const fingerprint = bundleFingerprint([{ costItemCode: product.costItemCode, quantity: 1 }]);
      const score = scoreOpportunity({ supplierFreshnessDays: product.supplierFreshnessDays, stockAvailable: true, missingPack: true });
      add({
        opportunityType: "MISSING_SINGLE", proposedRecipe: {
          recipeName: product.productName, recipeType: "SINGLE",
          components: [{ costItemCode: product.costItemCode, quantity: 1 }],
          totalCostMinor: product.unitCostMinor, fractionalDesi: product.unitDesi,
          finalDesi: Math.ceil(product.unitDesi),
        },
        bundleFingerprint: fingerprint, score: score.score, confidence: score.confidence,
        signals: score.signals,
        economics: { productCost: product.unitCostMinor / 100, desi: Math.ceil(product.unitDesi), dataStatus: "PARTIAL", missing: ["category", "commission", "shipping", "buybox"] },
        catalogStatus: "SEARCH_REQUIRED", listingBarcodeRequired: false,
        dataQuality: { missing: score.missing, economics: "PARTIAL" },
        generationReason: "Tedarikçi maliyet havuzunda var, PIM'de tekli reçete yok",
      });
    }
    const bundleInput = { existingFingerprints: [...new Set([...existingFingerprints, ...singleFingerprints])], maxCandidates: Number(input.maxBundleCandidates || 100) };
    const packCandidates = generatePackCandidates(physical, bundleInput);
    const mixedCandidates = generateMixedBundleCandidates(physical, {
      ...bundleInput,
      existingFingerprints: [...existingFingerprints, ...packCandidates.map((item) => item.bundleFingerprint)],
    });
    for (const [type, candidates] of [["MISSING_PACK_SIZE", packCandidates], ["MIXED_BUNDLE", mixedCandidates]])
      for (const candidate of candidates) {
        const freshness = Math.max(...candidate.components.map((component) => physical.find((item) => item.costItemCode === component.costItemCode)?.supplierFreshnessDays || 999));
        const score = scoreOpportunity({ supplierFreshnessDays: freshness, stockAvailable: true, missingPack: true });
        add({
          opportunityType: type, proposedRecipe: candidate,
          bundleFingerprint: candidate.bundleFingerprint, score: score.score,
          confidence: score.confidence, signals: score.signals,
          economics: { productCost: candidate.totalCostMinor / 100, desi: candidate.finalDesi, dataStatus: "PARTIAL", missing: ["category", "commission", "shipping", "buybox"] },
          catalogStatus: "SEARCH_REQUIRED", listingBarcodeRequired: false,
          dataQuality: { missing: score.missing, economics: "PARTIAL" },
          generationReason: type === "MIXED_BUNDLE" ? "Aynı ürün ailesinde eksik karma paket" : "Mevcut ürün ailesinde eksik paket adedi",
        });
      }
    const saved = await this.repository.saveGenerated(opportunities);
    return {
      generated: saved.length,
      evaluated: opportunities.length,
      targetMarketplace,
      actor,
      byType: saved.reduce((result, item) => ({ ...result, [item.opportunity_type]: (result[item.opportunity_type] || 0) + 1 }), {}),
      mutationPerformed: false,
    };
  }

  async approve(id, actor, confirmation) {
    if (confirmation !== "FIRSAT_RECETESINI_ONAYLA")
      throw new AppError("Fırsat reçetesi için açık onay gerekli", 409, "OPPORTUNITY_APPROVAL_CONFIRMATION_REQUIRED");
    const opportunity = await this.repository.get(id);
    if (!opportunity) throw new AppError("Fırsat bulunamadı", 404, "OPPORTUNITY_NOT_FOUND");
    if (["REJECTED", "PUBLISHED"].includes(opportunity.workflow_status))
      throw new AppError("Fırsat artık onaylanamaz", 409, "OPPORTUNITY_NOT_ACTIONABLE");
    let recipeId = opportunity.recipe_id;
    if (!recipeId) {
      const proposed = opportunity.proposed_recipe || {};
      const recipe = await this.pim.createRecipe({
        recipeName: proposed.recipeName,
        components: proposed.components,
      });
      recipeId = recipe.id;
    }
    const recipe = await this.pim.getRecipe(recipeId);
    if (recipe.status !== "APPROVED")
      await this.publication.approveRecipe(recipeId, actor, "RECETEYI_ONAYLA");
    return this.repository.transition(id, {
      status: "RECIPE_APPROVED", recipeId, actor,
      eventType: "RECIPE_APPROVED",
      snapshot: { score: opportunity.score, proposedRecipe: opportunity.proposed_recipe },
    });
  }

  async reject(id, actor, input = {}) {
    if (input.confirmation !== "FIRSATI_REDDET" || !String(input.reason || "").trim())
      throw new AppError("Ret için açık onay ve neden zorunlu", 409, "OPPORTUNITY_REJECTION_CONFIRMATION_REQUIRED");
    const opportunity = await this.repository.get(id);
    if (!opportunity) throw new AppError("Fırsat bulunamadı", 404, "OPPORTUNITY_NOT_FOUND");
    return this.repository.transition(id, {
      status: "REJECTED", actor, reason: String(input.reason).trim(),
      eventType: "REJECTED",
      snapshot: { score: opportunity.score, recipe: opportunity.proposed_recipe, marketplace: opportunity.target_marketplace },
    });
  }

  async searchCatalog(id, actor) {
    const opportunity = await this.repository.get(id);
    if (!opportunity) throw new AppError("Fırsat bulunamadı", 404, "OPPORTUNITY_NOT_FOUND");
    const outcome = await this.marketplaceRegistry.execute(
      opportunity.target_marketplace,
      "searchCatalog",
      { recipeId: opportunity.recipe_id, proposedRecipe: opportunity.proposed_recipe },
    );
    const candidates = outcome?.items || outcome?.candidates || [];
    const catalogStatus = outcome?.ok === true
      ? candidates.length ? "MATCH_REVIEW_REQUIRED" : "NOT_FOUND"
      : outcome?.code || "CATALOG_SEARCH_FAILED";
    const status = candidates.length ? "CATALOG_MATCH_REVIEW" : opportunity.workflow_status === "RECIPE_APPROVED" ? "CATALOG_SEARCHED" : opportunity.workflow_status;
    const data = await this.repository.recordCatalogSearch(id, {
      actor, catalogStatus, status,
      listingBarcodeRequired: outcome?.ok === true && candidates.length === 0,
      snapshot: { outcomeCode: outcome?.code, candidateCount: candidates.length },
    });
    return { opportunity: data, outcome, mutationPerformed: false };
  }
}

module.exports = { OpportunityService, hashKey, catalogState };
