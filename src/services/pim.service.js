const {
  bundleFingerprint,
  catalogMatch,
} = require("../domain/pim");

function validationError(message, code = "VALIDATION_ERROR") {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function validBarcode(value) {
  return /^[A-Z0-9._-]{6,64}$/i.test(String(value || ""));
}

class PimService {
  constructor({ repository }) {
    this.repository = repository;
  }

  listPhysicalProducts(filters) {
    return this.repository.listPhysicalProducts(filters);
  }

  listRecipes(filters) {
    return this.repository.listRecipes(filters);
  }

  getRecipe(id) {
    return this.repository.getRecipe(id);
  }

  listListings(filters) {
    return this.repository.listListings(filters);
  }

  listBarcodePool(filters) {
    return this.repository.listBarcodePool(filters);
  }

  listCatalogMatches(filters) {
    return this.repository.listCatalogMatches(filters);
  }

  bootstrapPreview() {
    return this.repository.bootstrapSummary();
  }

  bootstrap() {
    return this.repository.bootstrapExisting();
  }

  async createRecipe(input = {}) {
    if (!String(input.recipeName || "").trim())
      throw validationError("Reçete adı zorunlu");
    if (!Array.isArray(input.components) || !input.components.length)
      throw validationError("En az bir reçete bileşeni zorunlu");
    const components = input.components.map((item) => ({
      costItemCode: String(item.costItemCode || item.cost_item_code || "").trim(),
      quantity: Number(item.quantity),
    }));
    if (components.some((item) => !item.costItemCode || !(item.quantity > 0)))
      throw validationError("Cost code ve pozitif adet zorunlu");
    if (new Set(components.map((item) => item.costItemCode)).size !== components.length)
      throw validationError("Aynı cost code reçetede iki kez kullanılamaz");
    return this.repository.createRecipe({
      ...input,
      recipeName: String(input.recipeName).trim(),
      components,
    });
  }

  async recipeMatchSource(recipeId) {
    const recipe = await this.repository.getRecipe(recipeId);
    if (!recipe) return null;
    const components = recipe.components.map((item) => ({
      costItemCode: item.cost_item_code,
      quantity: Number(item.quantity),
      variant: item.variant,
    }));
    const first = recipe.components[0] || {};
    const homogeneous = recipe.components.every(
      (item) =>
        String(item.product_family || "") === String(first.product_family || "") &&
        String(item.variant || "") === String(first.variant || ""),
    );
    return {
      recipe,
      source: {
        brand: homogeneous ? first.brand : null,
        productFamily: homogeneous ? first.product_family : recipe.recipe_name,
        variant: homogeneous ? first.variant : null,
        unitVolumeMl: homogeneous ? first.volume_ml : null,
        unitWeightG: homogeneous ? first.weight_g : null,
        packCount: homogeneous
          ? recipe.components.reduce(
              (total, item) => total + Number(item.quantity),
              0,
            )
          : null,
        components,
      },
    };
  }

  async previewCatalogMatches({ recipeId, source, candidates = [] }) {
    let resolvedSource = source;
    if (recipeId) {
      const recipeSource = await this.recipeMatchSource(recipeId);
      if (!recipeSource) throw validationError("Reçete bulunamadı", "RECIPE_NOT_FOUND");
      resolvedSource = { ...recipeSource.source, ...(source || {}) };
    }
    if (!resolvedSource) throw validationError("Kaynak ürün bilgisi zorunlu");
    if (!Array.isArray(candidates)) throw validationError("Aday listesi geçersiz");
    return candidates
      .map((candidate) => ({
        candidate,
        ...catalogMatch(resolvedSource, candidate),
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  async saveCatalogMatch(input = {}) {
    if (!input.recipeId || !input.marketplace || !input.candidate?.marketplaceProductId)
      throw validationError("Reçete, pazaryeri ve hedef katalog ürünü zorunlu");
    const previews = await this.previewCatalogMatches({
      recipeId: input.recipeId,
      source: input.source,
      candidates: [input.candidate],
    });
    const preview = previews[0];
    return this.repository.saveCatalogMatch({
      marketplace: String(input.marketplace).toUpperCase(),
      recipeId: Number(input.recipeId),
      marketplaceProductId: String(input.candidate.marketplaceProductId),
      marketplaceCatalogBarcode: input.candidate.marketplaceCatalogBarcode,
      marketplaceCategoryId: input.candidate.marketplaceCategoryId,
      matchStatus: preview.status,
      matchConfidence: preview.confidence,
      matchMethod: "RULE_BASED_V1",
      evidence: {
        sourceFingerprint: bundleFingerprint(
          (await this.recipeMatchSource(input.recipeId)).source.components,
        ),
        signals: preview.evidence,
        candidate: input.candidate,
      },
    });
  }

  async reviewCatalogMatch(id, status, actor) {
    const normalized = String(status || "").toUpperCase();
    if (!["CONFIRMED", "REJECTED"].includes(normalized))
      throw validationError("Eşleşme kararı geçersiz");
    return this.repository.reviewCatalogMatch(id, {
      status: normalized,
      actor,
    });
  }

  async previewBarcode(marketplace, recipeId) {
    if (!marketplace || !recipeId)
      throw validationError("Pazaryeri ve reçete zorunlu");
    return this.repository.previewBarcode(marketplace, recipeId);
  }

  async allocateBarcode(input = {}) {
    if (input.confirmation !== "LISTING_BARKODU_TAHSIS_ET")
      throw validationError(
        "Listing barkodu tahsisi için açık onay gerekli",
        "BARCODE_ALLOCATION_CONFIRMATION_REQUIRED",
      );
    if (input.requestedBarcode && !validBarcode(input.requestedBarcode))
      throw validationError("Manuel listing barkodu formatı geçersiz");
    return this.repository.allocateBarcode({
      marketplace: input.marketplace,
      recipeId: Number(input.recipeId),
      requestedBarcode: input.requestedBarcode
        ? String(input.requestedBarcode).toUpperCase()
        : null,
    });
  }
}

module.exports = { PimService, validBarcode };
