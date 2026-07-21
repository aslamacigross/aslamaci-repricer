const crypto = require("crypto");
const {
  contentChecksum,
  buildSourceFacts,
  contentDiff,
  validateContent,
  assessListingHealth,
} = require("../domain/content");
const { AppError } = require("../utils/errors");

function currentContent(listing) {
  if (!listing) return {};
  return {
    title: listing.title || "",
    description: listing.description || "",
    attributes: listing.attributes || {},
    images: listing.images || [],
    video: listing.video || null,
  };
}

function draftKey(marketplace, recipeId, listingId) {
  return crypto
    .createHash("sha256")
    .update(`${marketplace}:${recipeId}:${listingId || "NEW"}`)
    .digest("hex");
}

class ContentService {
  constructor({ repository, pim, marketplaceRegistry, provider }) {
    this.repository = repository;
    this.pim = pim;
    this.marketplaceRegistry = marketplaceRegistry;
    this.provider = provider;
  }

  listDrafts(filters) {
    return this.repository.listDrafts(filters);
  }
  getDraft(id) {
    return this.repository.getDraft(id);
  }
  listHealth(filters) {
    return this.repository.listHealth(filters);
  }
  getHealth(id) {
    return this.repository.getHealth(id);
  }

  async generate(input = {}, actor) {
    if (input.confirmation !== "ICERIK_TASLAGI_URET")
      throw new AppError(
        "İçerik taslağı için açık onay gerekli",
        409,
        "CONTENT_DRAFT_CONFIRMATION_REQUIRED",
      );
    const marketplace = String(input.marketplace || "TRENDYOL").toUpperCase();
    const recipe = await this.pim.getRecipe(Number(input.recipeId));
    if (!recipe)
      throw new AppError("Reçete bulunamadı", 404, "RECIPE_NOT_FOUND");
    const listing = await this.repository.getListing({
      listingId: input.listingId,
      recipeId: recipe.id,
      marketplace,
    });
    if (input.listingId && !listing)
      throw new AppError("Listing bulunamadı", 404, "LISTING_NOT_FOUND");
    if (listing && listing.marketplace !== marketplace)
      throw new AppError(
        "Listing pazaryeri uyuşmuyor",
        409,
        "MARKETPLACE_ISOLATION_VIOLATION",
      );
    const facts = buildSourceFacts(recipe, marketplace);
    const generated = await this.provider.generate(facts, { marketplace });
    const current = currentContent(listing);
    const validation = validateContent(generated.content, facts);
    const draft = await this.repository.saveDraft({
      idempotencyKey: draftKey(marketplace, recipe.id, listing?.id),
      marketplace,
      recipeId: recipe.id,
      listingId: listing?.id,
      providerMode: generated.mode,
      sourceFacts: facts,
      sourceProvenance: [
        { type: "PIM_RECIPE", id: recipe.id },
        ...(recipe.components || []).map((item) => ({
          type: "COST_ITEM",
          id: item.cost_item_code,
        })),
        ...(listing
          ? [{ type: "MARKETPLACE_LISTING", id: listing.id, marketplace }]
          : []),
      ],
      currentContent: current,
      proposedContent: generated.content,
      diff: contentDiff(current, generated.content),
      safetyErrors: validation.errors,
      safetyWarnings: validation.warnings,
      currentChecksum: contentChecksum(current),
      proposedChecksum: contentChecksum(generated.content),
      actor,
    });
    return {
      draft,
      provider: { code: generated.provider, mode: generated.mode },
      externalRequestPerformed: generated.externalRequestPerformed === true,
      mutationPerformed: false,
    };
  }

  async update(id, input = {}, actor) {
    const draft = await this.repository.getDraft(id);
    if (!draft)
      throw new AppError(
        "İçerik taslağı bulunamadı",
        404,
        "CONTENT_DRAFT_NOT_FOUND",
      );
    if (["MARKETPLACE_SUBMITTED", "VERIFIED"].includes(draft.workflow_status))
      throw new AppError(
        "Gönderilmiş içerik taslağı düzenlenemez",
        409,
        "CONTENT_DRAFT_LOCKED",
      );
    const proposed = {
      ...draft.proposed_content,
      ...(input.proposedContent || {}),
    };
    proposed.metadata = draft.proposed_content?.metadata ||
      draft.source_facts?.metadata || {
        packageCount: draft.source_facts?.packageCount,
        marketplace: draft.marketplace,
      };
    const validation = validateContent(proposed, draft.source_facts);
    return this.repository.updateDraft(id, {
      proposedContent: proposed,
      diff: contentDiff(draft.current_content, proposed),
      safetyErrors: validation.errors,
      safetyWarnings: validation.warnings,
      checksum: contentChecksum(proposed),
      actor,
    });
  }

  async approve(id, actor, confirmation) {
    if (confirmation !== "ICERIGI_ONAYLA")
      throw new AppError(
        "İçerik onayı için açık onay gerekli",
        409,
        "CONTENT_APPROVAL_CONFIRMATION_REQUIRED",
      );
    const draft = await this.repository.getDraft(id);
    if (!draft)
      throw new AppError(
        "İçerik taslağı bulunamadı",
        404,
        "CONTENT_DRAFT_NOT_FOUND",
      );
    const validation = validateContent(
      draft.proposed_content,
      draft.source_facts,
    );
    if (validation.errors.length)
      throw new AppError(
        "İçerik güvenlik doğrulamasından geçmedi",
        409,
        "CONTENT_SAFETY_FAILED",
        validation,
      );
    return this.repository.approveDraft(
      id,
      actor,
      contentChecksum(draft.proposed_content),
    );
  }

  async publishDryRun(id, actor, confirmation) {
    if (confirmation !== "ICERIK_DRY_RUN_ONAYLA")
      throw new AppError(
        "İçerik dry-run için açık onay gerekli",
        409,
        "CONTENT_DRY_RUN_CONFIRMATION_REQUIRED",
      );
    const draft = await this.repository.getDraft(id);
    if (!draft)
      throw new AppError(
        "İçerik taslağı bulunamadı",
        404,
        "CONTENT_DRAFT_NOT_FOUND",
      );
    if (draft.workflow_status !== "APPROVED")
      throw new AppError(
        "Önce içerik insan onayı almalı",
        409,
        "CONTENT_NOT_APPROVED",
      );
    const integration = await this.marketplaceRegistry.get(draft.marketplace);
    const blockers = [
      !integration?.enabled && "MARKETPLACE_DISABLED",
      !integration?.credentials_configured && "MARKETPLACE_CREDENTIALS_MISSING",
      !integration?.capabilities?.supportsContentUpdate &&
        "CAPABILITY_NOT_SUPPORTED",
      "CONTENT_AUTO_UPDATE_DISABLED",
    ].filter(Boolean);
    return {
      dryRun: true,
      actor,
      blockers,
      diff: draft.diff_json,
      rollbackSnapshot:
        draft.snapshots?.find((item) => item.snapshot_type === "CURRENT") ||
        null,
      mutationPerformed: false,
    };
  }

  async rollbackPreview(id, input = {}) {
    if (input.confirmation !== "ROLLBACK_ONIZLE")
      throw new AppError(
        "Rollback önizlemesi için açık onay gerekli",
        409,
        "ROLLBACK_PREVIEW_CONFIRMATION_REQUIRED",
      );
    const draft = await this.repository.getDraft(id);
    if (!draft)
      throw new AppError(
        "İçerik taslağı bulunamadı",
        404,
        "CONTENT_DRAFT_NOT_FOUND",
      );
    const snapshot = await this.repository.snapshot(Number(input.snapshotId));
    if (!snapshot || Number(snapshot.content_draft_id) !== Number(draft.id))
      throw new AppError(
        "Rollback snapshot bulunamadı",
        404,
        "ROLLBACK_SNAPSHOT_NOT_FOUND",
      );
    const validation = validateContent(
      snapshot.content_json,
      draft.source_facts,
    );
    return {
      snapshot,
      diff: contentDiff(draft.proposed_content, snapshot.content_json),
      validation,
      requiresNewApproval: true,
      mutationPerformed: false,
    };
  }

  async scanHealth(input = {}, actor) {
    if (input.confirmation !== "LISTING_SAGLIGINI_TARA")
      throw new AppError(
        "Listing sağlık taraması için açık onay gerekli",
        409,
        "LISTING_HEALTH_CONFIRMATION_REQUIRED",
      );
    const marketplace = String(input.marketplace || "TRENDYOL").toUpperCase();
    const listings = await this.repository.listingHealthInputs(marketplace);
    const assessed = [];
    for (const listing of listings) {
      const recipe = await this.pim.getRecipe(listing.recipe_id);
      if (!recipe) continue;
      const result = assessListingHealth(listing, recipe);
      assessed.push({
        marketplace,
        listingId: listing.id,
        recipeId: listing.recipe_id,
        ...result,
      });
    }
    const saved = await this.repository.saveHealth(assessed);
    return {
      processed: listings.length,
      successful: saved.length,
      failed: listings.length - saved.length,
      actor,
      mutationPerformed: false,
    };
  }
}

module.exports = { ContentService, currentContent, draftKey };
