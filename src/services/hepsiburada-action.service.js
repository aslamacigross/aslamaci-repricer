const { AppError } = require("../utils/errors");
const {
  matchesOwnListing,
} = require("../domain/hepsiburada-merchant-identity");
const { proposePrice, safetyCheck } = require("../domain/repricer");
const { calculateNetProfit, calculateNetMargin } = require("../domain/pricing");
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
      if (
        this.hbFloorRecovery?.enabled &&
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
      let floorPreflight;
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
        floorPreflight = recovery.safety.hbFloorRecovery;
      }
      const submission = await this.hepsiburada.submitPriceUpdate({
        merchantSku: product.merchant_sku || product.barcode,
        hbSku: product.hb_sku || product.marketplace_product_id,
        price: Number(locked.proposed_price),
      });
      const updated = await this.withTransaction((client) =>
        this.actions.updateStatus(
          id,
          "AWAITING_RESULT",
          {
            actor,
            batchId: submission.uploadId,
            apiResponse: {
              submission: submission.response,
              ...(floorPreflight ? { floorPreflight } : {}),
            },
          },
          client,
        ),
      );
      await this.audit.record({
        actor,
        action: "HB_PRICE_ACTION_SENT",
        entityType: "repricer_action",
        entityId: String(id),
        after: {
          uploadId: submission.uploadId,
          ...(floorPreflight ? { floorPreflight } : {}),
        },
      });
      return updated;
    } catch (error) {
      const stale = ["PRICE_MISMATCH", "MARKET_PRICE_MISMATCH"].includes(
        error.code,
      );
      await this.actions.updateStatus(id, stale ? "STALE" : "FAILED", {
        actor,
        error: error.message,
      });
      await this.audit.record({
        actor,
        action: stale ? "HB_PRICE_ACTION_STALE" : "HB_PRICE_ACTION_FAILED",
        entityType: "repricer_action",
        entityId: String(id),
        after: { code: error.code || "HB_PRICE_ACTION_FAILED" },
      });
      throw error;
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
      action.safety_checks?.hbFloorRecovery &&
      !matchesOwnListing(product, listing)
    )
      return {
        status: "PENDING",
        error: "HB_FLOOR_MARKET_IDENTITY_UNVERIFIED",
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
