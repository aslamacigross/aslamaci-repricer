const { HepsiburadaPilotPolicy } = require("../domain/hepsiburada-pilot");
const { AppError } = require("../utils/errors");
const {
  matchesOwnListing,
} = require("../domain/hepsiburada-merchant-identity");
const { proposePrice, safetyCheck } = require("../domain/repricer");
const {
  calculateNetProfit,
  calculateNetMargin,
  selectShippingCost,
} = require("../domain/pricing");
const { roundMoney, parseBoolean } = require("../utils/numbers");

function firstValue(source, keys) {
  for (const key of keys) {
    const value = key
      .split(".")
      .reduce((object, part) => object?.[part], source);
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return null;
}

function listingPrice(listing, floor = false) {
  return roundMoney(
    firstValue(listing || {}, [
      ...(floor ? ["price.amount", "price.value"] : []),
      "price",
      "salePrice",
      "unitPrice",
      "merchantUnitPrice",
      "listingPrice",
      "price.amount",
      "price.value",
    ]),
  );
}

function listingStock(listing) {
  const value = firstValue(listing || {}, [
    "availableStock",
    "stock",
    "quantity",
    "availableQuantity",
    "inventory",
  ]);
  return value == null ? null : Number(value);
}

function uploadState(payload) {
  const status = String(
    firstValue(payload || {}, [
      "status",
      "state",
      "data.status",
      "data.state",
      "items.0.status",
      "data.items.0.status",
    ]) || "IN_PROGRESS",
  ).toUpperCase();
  if (["DONE", "COMPLETED", "SUCCESS", "SUCCEEDED", "OK"].includes(status))
    return "SUCCESS";
  if (["FAILED", "ERROR", "REJECTED", "CANCELLED"].includes(status))
    return "FAILED";
  return "PENDING";
}

class HepsiburadaActionService {
  constructor({
    withTransaction,
    actions,
    products,
    hepsiburada,
    audit,
    repricer,
    hbFloorRecovery,
  }) {
    Object.assign(this, {
      withTransaction,
      actions,
      products,
      hepsiburada,
      audit,
      repricer,
      hbFloorRecovery,
    });
  }

  async persistSubmission(id, submission, actor, receipt, client) {
    return this.actions.recordHbSubmission(
      id,
      submission,
      actor,
      receipt,
      client,
    );
  }

  // The final DB check follows the LAST external GET; it performs no more HTTP
  // reads. The transaction ends before POST: this narrows, not eliminates, the
  // unavoidable DB/provider gap. Old workers must be drained before activation.
  async validatePilotDispatch(action, listing) {
    return this.withTransaction(async (client) => {
      const state = (
        await client.query(
          "SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",
          [action.id],
        )
      ).rows[0];
      if (state?.status !== "SENDING")
        throw new AppError(
          "Aksiyon gönderim durumunda değil",
          409,
          "DUPLICATE_APPLY",
        );
      const product = await this.products.get(
        action.barcode,
        "HEPSIBURADA",
        client,
      );
      const pilot =
        this.hbFloorRecovery?.pilot ||
        this.repricer?.hbPilot ||
        new HepsiburadaPilotPolicy();
      pilot.assertAction(action, product);
      if (!pilot.matchesListing(product, listing, action.safety_checks.hbPilot))
        throw new AppError(
          "Listing kimliği uyuşmuyor",
          409,
          "HB_FLOOR_MARKET_IDENTITY_UNVERIFIED",
        );
      if (!this.hepsiburada.livePriceUpdatesEnabled())
        throw new AppError(
          "HB fiyat izni kapalı",
          409,
          "HEPSIBURADA_PRICE_MUTATION_DISABLED",
        );
      const global = await this.repricer.globalSettings(client);
      const settings = {
        ...product.settings,
        unlimited_increase:
          parseBoolean(global.unlimitedIncrease) ||
          parseBoolean(product.settings?.unlimited_increase),
      };
      const stats = await this.actions.todayStats(
        action.barcode,
        "HEPSIBURADA",
        client,
      );
      const today = {
        actionCount: stats.action_count,
        dayStartPrice: stats.day_start_price,
      };
      if (action.safety_checks?.hbFloorRecovery) {
        if (!this.hbFloorRecovery?.enabled)
          throw new AppError("Floor kapalı", 409, "HB_FLOOR_DISABLED");
        const result = await this.hbFloorRecovery.evaluate({
          product,
          settings,
          global,
          today,
          proposal: proposePrice(product, settings),
          action,
          queryable: client,
          observedListing: listing,
        });
        if (!result?.safety.safe)
          throw new AppError(
            "Son floor kanıtı değişti",
            409,
            "STALE_PREVIEW",
            result?.safety.failures,
          );
        // Configuration can change while SELECTs await. Recheck synchronously
        // after all evidence reads. No claim of remote cancellation is made.
        pilot.assertAction(action, product);
        if (!this.hbFloorRecovery.enabled)
          throw new AppError("Floor kapalı", 409, "HB_FLOOR_DISABLED");
        return result.safety.hbFloorRecovery;
      }
      // Identity-only can enable ordinary competitive actions. It must not
      // inherit the floor exception, but its last-GET dispatch still requires
      // current source evidence and target-tariff profit; never raise its target
      // implicitly when the floor feature is off.
      const evidence = await this.hbFloorRecovery.loadBatch(
        [product],
        client,
        action.id,
      );
      const verified = this.hbFloorRecovery.verifyCost(product, evidence);
      const targetShipping = selectShippingCost({
        salePrice: Number(action.proposed_price),
        desi: verified.desi,
        carrier: evidence.carrier,
        barems: evidence.barems,
        costs: evidence.rates,
      });
      if (!(targetShipping > 0))
        throw new AppError(
          "Pilot hedef kargo maliyeti doğrulanamadı",
          409,
          "HB_PILOT_TARGET_UNSAFE",
        );
      const proposal = {
        ...proposePrice(product, settings),
        proposedPrice: Number(action.proposed_price),
      };
      const money = {
        salePrice: proposal.proposedPrice,
        productCost: product.calculated_product_cost,
        shippingCost: targetShipping,
        commissionRate: product.commission_rate,
        packagingCost: product.packaging_cost,
        serviceFee: product.service_fee,
      };
      proposal.expectedProfit = calculateNetProfit(money);
      proposal.expectedMargin = calculateNetMargin(money);
      const safety = safetyCheck({
        product,
        settings,
        global,
        proposal,
        today,
      });
      if (
        !safety.safe ||
        proposal.expectedProfit <
          Math.max(
            Number(product.target_profit) || 0,
            Number(settings.minimum_profit_tl) || 0,
          ) ||
        settings.mode !== "AUTOMATIC" ||
        !parseBoolean(product.auto_update) ||
        !parseBoolean(settings.auto_update) ||
        listingPrice(listing, true) !== Number(action.old_price) ||
        Number(product.my_price) !== Number(action.old_price) ||
        listing.isSalable !== true ||
        !(listingStock(listing) > 0)
      )
        throw new AppError(
          "Pilot son kontrolü başarısız",
          409,
          "SAFETY_BLOCKED",
          safety.failures,
        );
      pilot.assertAction(action, product);
      return null;
    });
  }

  async apply(id, actor) {
    const preparation = await this.withTransaction(async (client) => {
      const locked = (
        await client.query(
          "SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!locked)
        throw new AppError("Aksiyon bulunamadı", 404, "ACTION_NOT_FOUND");
      if (locked.marketplace !== "HEPSIBURADA")
        throw new AppError(
          "HB executor yalnız Hepsiburada aksiyonu işleyebilir",
          409,
          "MARKETPLACE_EXECUTOR_MISMATCH",
        );
      if (!["APPROVED", "PENDING"].includes(locked.status))
        throw new AppError(
          "Aksiyon daha önce işlendi veya uygun durumda değil",
          409,
          "DUPLICATE_APPLY",
        );
      if (locked.status === "PENDING")
        throw new AppError(
          "Aksiyon önce onaylanmalı",
          409,
          "ACTION_NOT_APPROVED",
        );
      if (locked.expires_at && new Date(locked.expires_at) < new Date())
        throw new AppError("Aksiyonun süresi dolmuş", 409, "ACTION_EXPIRED");
      const product = await this.products.get(
        locked.barcode,
        "HEPSIBURADA",
        locked.safety_checks?.hbFloorRecovery ? client : undefined,
      );
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const pilot =
        this.hbFloorRecovery?.pilot ||
        this.repricer?.hbPilot ||
        new HepsiburadaPilotPolicy();
      pilot.assertAction(locked, product);
      if (
        this.hbFloorRecovery?.enabled &&
        pilot.scope(product, "floorRecovery").allowed &&
        ["AUTO", "JOB", "WEB"].includes(locked.source) &&
        (Number(product.my_price) < Number(product.min_price) ||
          locked.action === "MIN_FIYATA_TOPARLA") &&
        !locked.safety_checks?.hbFloorRecovery
      )
        throw new AppError(
          "Eski floor aksiyonu için yeni doğrulanmış preview gerekli",
          409,
          "HB_FLOOR_ACTION_UNVERIFIED",
        );
      if (Number(product.my_price) !== Number(locked.old_price))
        throw new AppError(
          "Ürün fiyatı aksiyon üretildikten sonra değişmiş",
          409,
          "PRICE_MISMATCH",
        );
      const open = await this.actions.findOpen(
        locked.barcode,
        client,
        id,
        "HEPSIBURADA",
      );
      if (open)
        throw new AppError(
          "Ürün için başka açık aksiyon var",
          409,
          "OPEN_ACTION_EXISTS",
        );
      const global = await this.repricer.globalSettings(
        locked.safety_checks?.hbFloorRecovery ? client : undefined,
      );
      const settings = product.settings || {};
      const effectiveSettings = {
        ...settings,
        learned_price_cut_tl: product.learning?.learned_price_cut_tl,
        learned_max_increase_tl: product.learning?.learned_max_increase_tl,
        learning_paused: product.learning?.paused,
        unlimited_increase:
          parseBoolean(global.unlimitedIncrease) ||
          parseBoolean(settings.unlimited_increase),
      };
      let proposal = proposePrice(product, effectiveSettings);
      proposal.proposedPrice = Number(locked.proposed_price);
      const moneyInput = {
        salePrice: proposal.proposedPrice,
        commissionRate: product.commission_rate,
        productCost: product.calculated_product_cost,
        shippingCost: product.calculated_shipping_cost,
        packagingCost: product.packaging_cost,
        serviceFee: product.service_fee,
      };
      proposal.expectedProfit = calculateNetProfit(moneyInput);
      proposal.expectedMargin = calculateNetMargin(moneyInput);
      const today = await this.actions.todayStats(
        product.barcode,
        "HEPSIBURADA",
        client,
      );
      let safety = safetyCheck({
        product,
        settings: {
          ...effectiveSettings,
          auto_update: settings.auto_update ?? product.auto_update,
        },
        global,
        proposal,
        manual: ["MANUAL", "MANUAL_EDIT", "ROLLBACK"].includes(locked.source),
        automaticRecovery: Boolean(locked.reverts_action_id),
        today: {
          actionCount: today.action_count,
          dayStartPrice: today.day_start_price,
        },
      });
      if (locked.safety_checks?.hbFloorRecovery) {
        if (!this.hbFloorRecovery?.enabled)
          throw new AppError(
            "HB floor recovery kapalı",
            409,
            "HB_FLOOR_DISABLED",
          );
        const recovery = await this.hbFloorRecovery.evaluate({
          product,
          settings: effectiveSettings,
          global,
          proposal,
          today: {
            actionCount: today.action_count,
            dayStartPrice: today.day_start_price,
          },
          action: locked,
          queryable: client,
        });
        if (!recovery)
          throw new AppError(
            "Floor aksiyonu artık uygun değil",
            409,
            "STALE_PREVIEW",
          );
        ({ proposal, safety } = recovery);
      }
      const hardFailures = safety.failures.filter((code) => code !== "DRY_RUN");
      if (hardFailures.length)
        throw new AppError(
          `Fiyat güvenlik kontrollerinden geçmedi: ${hardFailures.join(", ")}`,
          409,
          hardFailures.includes("MARKET_PRICE_MISMATCH")
            ? "MARKET_PRICE_MISMATCH"
            : hardFailures.includes("STALE_PREVIEW")
              ? "STALE_PREVIEW"
              : "SAFETY_BLOCKED",
          hardFailures,
        );
      if (global.dryRun) {
        const updated = await this.actions.updateStatus(
          id,
          "DRY_RUN",
          { actor, apiResponse: { dryRun: true, safety } },
          client,
        );
        return { dryRun: true, updated };
      }
      if (!this.hepsiburada.livePriceUpdatesEnabled())
        throw new AppError(
          "Hepsiburada fiyat mutasyonu için iki HB anahtarı da açık olmalı",
          409,
          "HEPSIBURADA_PRICE_MUTATION_DISABLED",
        );
      await this.actions.updateStatus(id, "SENDING", { actor }, client);
      await this.audit.record(
        {
          actor,
          action: "HB_PRICE_DISPATCH_INTENT",
          entityType: "repricer_action",
          entityId: String(id),
          before: locked,
          after: { status: "SENDING", outcome: "NOT_YET_KNOWN" },
        },
        client,
      );
      return { dryRun: false, locked, product };
    });
    if (preparation.dryRun) {
      await this.audit.record({
        actor,
        action: "HB_PRICE_ACTION_DRY_RUN",
        entityType: "repricer_action",
        entityId: String(id),
        after: preparation.updated,
      });
      return preparation.updated;
    }

    const { locked, product } = preparation;
    let dispatchStarted = false;
    let submission;
    let floorPreflight;
    try {
      const listing = await this.hepsiburada.readListingForPrice({
        merchantSku: product.merchant_sku || product.barcode,
        hbSku: product.hb_sku || product.marketplace_product_id,
      });
      if (!listing)
        throw new AppError(
          "Ürün Hepsiburada Listing API'de bulunamadı",
          409,
          "MARKET_PRODUCT_NOT_FOUND",
        );
      const marketPrice = listingPrice(
        listing,
        Boolean(locked.safety_checks?.hbFloorRecovery),
      );
      await this.actions.recordMarketPreflight(id, marketPrice);
      if (marketPrice <= 0 || marketPrice !== roundMoney(locked.old_price))
        throw new AppError(
          "Hepsiburada güncel fiyatı aksiyonun beklediği fiyatla eşleşmiyor",
          409,
          "MARKET_PRICE_MISMATCH",
          { expected: roundMoney(locked.old_price), observed: marketPrice },
        );
      const stock = listingStock(listing);
      if (listing.isSalable === false || (stock != null && stock <= 0))
        throw new AppError(
          "Ürün Hepsiburada'da satışa uygun değil; fiyat gönderimi durduruldu",
          409,
          "MARKET_PRODUCT_UNAVAILABLE",
        );
      if (locked.safety_checks?.hbFloorRecovery) {
        // Repeat current source/recipe/policy and own-listing GET checks after
        // preparation. Never reinterpret an old ordinary action as a floor action.
        const latest = await this.products.get(locked.barcode, "HEPSIBURADA");
        const global = await this.repricer.globalSettings();
        const settings = {
          ...latest?.settings,
          unlimited_increase:
            parseBoolean(global.unlimitedIncrease) ||
            parseBoolean(latest?.settings?.unlimited_increase),
        };
        const today = await this.actions.todayStats(
          locked.barcode,
          "HEPSIBURADA",
        );
        const recovery =
          latest &&
          (await this.hbFloorRecovery.evaluate({
            product: latest,
            settings,
            global,
            proposal: proposePrice(latest, settings),
            action: locked,
            today: {
              actionCount: today.action_count,
              dayStartPrice: today.day_start_price,
            },
          }));
        const state = await this.actions.get(id);
        if (!recovery?.safety.safe || state?.status !== "SENDING")
          throw new AppError(
            "Floor son kontrolü başarısız",
            409,
            recovery?.safety.failures.includes("MARKET_PRICE_MISMATCH")
              ? "MARKET_PRICE_MISMATCH"
              : "STALE_PREVIEW",
            recovery?.safety.failures,
          );
        floorPreflight = await this.validatePilotDispatch(
          locked,
          recovery.observedListing,
        );
      } else if (locked.safety_checks?.hbPilot) {
        await this.validatePilotDispatch(locked, listing);
      }
      dispatchStarted = true;
      submission = await this.hepsiburada.submitPriceUpdate({
        merchantSku: product.merchant_sku || product.barcode,
        hbSku: product.hb_sku || product.marketplace_product_id,
        price: Number(locked.proposed_price),
      });
    } catch (error) {
      if (dispatchStarted) {
        // SENDING is deliberately nonterminal. A timeout/missing upload ID does
        // not prove rejection, and must not free findOpen or permit a retry.
        try {
          await this.withTransaction(async (client) => {
            await this.actions.updateStatus(
              id,
              "SENDING",
              {
                actor,
                error: "External outcome UNKNOWN",
                apiResponse: {
                  dispatch: {
                    outcome: "UNKNOWN",
                    code: error.code || "TRANSPORT_ERROR",
                  },
                },
              },
              client,
            );
            await this.audit.record(
              {
                actor,
                action: "HB_PRICE_SUBMISSION_UNKNOWN",
                entityType: "repricer_action",
                entityId: String(id),
                after: {
                  outcome: "UNKNOWN",
                  code: error.code || "TRANSPORT_ERROR",
                },
              },
              client,
            );
          });
        } catch {
          /* Original committed SENDING + dispatch intent still block retry. */
        }
        const unknown = new AppError(
          "HB gönderim sonucu belirsiz; otomatik tekrar yasak",
          Number(error.status) === 429 || error.code === "HTTP_429" ? 429 : 409,
          "HB_SUBMISSION_OUTCOME_UNKNOWN",
        );
        unknown.retryAfterMs = error.retryAfterMs;
        throw unknown;
      }
      const stale = ["PRICE_MISMATCH", "MARKET_PRICE_MISMATCH"].includes(
        error.code,
      );
      await this.withTransaction(async (client) => {
        await this.actions.updateStatus(
          id,
          stale ? "STALE" : "FAILED",
          { actor, error: error.message },
          client,
        );
        await this.audit.record(
          {
            actor,
            action: stale ? "HB_PRICE_ACTION_STALE" : "HB_PRICE_ACTION_FAILED",
            entityType: "repricer_action",
            entityId: String(id),
            after: { code: error.code || "HB_PRICE_ACTION_FAILED" },
          },
          client,
        );
      });
      throw error;
    }
    const receipt = {
      submission: submission.response,
      dispatchReceipt: {
        outcome: "ACCEPTED",
        uploadId: submission.uploadId,
        actor,
        actionId: id,
        before: "SENDING",
        after: "AWAITING_RESULT",
        recordedAt: new Date().toISOString(),
      },
      ...(floorPreflight ? { floorPreflight } : {}),
    };
    try {
      return await this.withTransaction(async (client) => {
        const updated = await this.persistSubmission(
          id,
          submission,
          actor,
          receipt,
          client,
        );
        await this.audit.record(
          {
            actor,
            action: "HB_PRICE_ACTION_SENT",
            entityType: "repricer_action",
            entityId: String(id),
            before: { status: "SENDING" },
            after: receipt,
          },
          client,
        );
        return updated;
      });
    } catch {
      // Preserve an accepted upload for normal verification even if the audit
      // sink is broken. The existing JSON receipt retains the transition and an
      // explicit audit debt; never turn a local bookkeeping failure into FAILED.
      try {
        return await this.withTransaction((client) =>
          this.persistSubmission(
            id,
            submission,
            actor,
            { ...receipt, auditPending: true },
            client,
          ),
        );
      } catch {
        // DB unavailable: SENDING and its pre-dispatch audit were already durable.
        // This needs separate reconciliation; neither retry nor SUCCESS is safe.
        throw new AppError(
          "HB kabul etti; yerel kayıt doğrulanamadı",
          503,
          "HB_SUBMISSION_PERSISTENCE_UNCERTAIN",
        );
      }
    }
  }

  async verifyPriceAction(action) {
    if (action.marketplace !== "HEPSIBURADA")
      throw new AppError(
        "HB doğrulayıcı yalnız Hepsiburada aksiyonu işleyebilir",
        409,
        "MARKETPLACE_EXECUTOR_MISMATCH",
      );
    const batchResponse = await this.hepsiburada.getListingUploadStatus(
      "price",
      action.batch_id,
    );
    const state = uploadState(batchResponse);
    if (state === "FAILED")
      return {
        status: "FAILED",
        error: "Hepsiburada fiyat yükleme işlemi başarısız",
        batchResponse,
      };
    if (state !== "SUCCESS") return { status: "PENDING", batchResponse };
    const product = await this.products.get(action.barcode, "HEPSIBURADA");
    const listing = await this.hepsiburada.readListingForPrice({
      merchantSku: product?.merchant_sku || product?.barcode,
      hbSku: product?.hb_sku || product?.marketplace_product_id,
    });
    if (!listing)
      return {
        status: "PENDING",
        error: "Hepsiburada ürün fiyatı henüz okunamadı",
        batchResponse,
      };
    if (
      action.safety_checks?.hbPilot
        ? !(
            this.hbFloorRecovery?.pilot ||
            this.repricer?.hbPilot ||
            new HepsiburadaPilotPolicy()
          ).matchesListing(product, listing, action.safety_checks.hbPilot)
        : !matchesOwnListing(product, listing)
    )
      return {
        status: "PENDING",
        error: action.safety_checks?.hbFloorRecovery
          ? "HB_FLOOR_MARKET_IDENTITY_UNVERIFIED"
          : "HB_MARKET_IDENTITY_UNVERIFIED",
        batchResponse,
      };
    const observedPrice = listingPrice(
      listing,
      Boolean(action.safety_checks?.hbFloorRecovery),
    );
    const marketProduct = {
      ...listing,
      salePrice: observedPrice,
      listPrice: observedPrice,
    };
    if (observedPrice !== roundMoney(action.proposed_price))
      return {
        status: "MISMATCH",
        error: `Beklenen fiyat ${roundMoney(action.proposed_price)}, görülen fiyat ${observedPrice}`,
        batchResponse,
        marketProduct,
      };
    return {
      status: "VERIFIED",
      batchResponse,
      marketProduct,
      observedPrice,
    };
  }
}

module.exports = {
  HepsiburadaActionService,
  listingPrice,
  listingStock,
  uploadState,
};
