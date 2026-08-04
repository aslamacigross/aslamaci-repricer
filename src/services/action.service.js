const { AppError } = require("../utils/errors");
const {
  proposePrice,
  safetyCheck,
  campaignEconomics,
} = require("../domain/repricer");
const { calculateNetProfit, calculateNetMargin } = require("../domain/pricing");
const { roundMoney, parseBoolean } = require("../utils/numbers");
const { env } = require("../config/env");

class ActionService {
  constructor({
    db,
    withTransaction,
    actions,
    products,
    settings,
    trendyol,
    audit,
    repricer,
    marketplaceRegistry,
  }) {
    Object.assign(this, {
      db,
      withTransaction,
      actions,
      products,
      settings,
      trendyol,
      audit,
      repricer,
      marketplaceRegistry,
    });
  }

  async approve(id, actor) {
    const action = await this.actions.get(id);
    if (!action)
      throw new AppError("Aksiyon bulunamadı", 404, "ACTION_NOT_FOUND");
    if (action.status !== "PENDING")
      throw new AppError(
        "Yalnızca bekleyen aksiyon onaylanabilir",
        409,
        "INVALID_ACTION_STATE",
      );
    const updated = await this.actions.updateStatus(id, "APPROVED", { actor });
    await this.audit.record({
      actor,
      action: "REPRICER_ACTION_APPROVED",
      entityType: "repricer_action",
      entityId: String(id),
      after: updated,
    });
    return updated;
  }

  async approveMany(ids, actor) {
    const unique = [
      ...new Set((ids || []).map(Number).filter(Number.isFinite)),
    ];
    if (!unique.length || unique.length > 200)
      throw new AppError(
        "Toplu onay için 1-200 aksiyon seçilmeli",
        400,
        "INVALID_BULK_SELECTION",
      );
    const updated = await this.withTransaction(async (client) => {
      const locked = (
        await client.query(
          `SELECT id,status FROM repricer_actions
           WHERE id=ANY($1::bigint[]) FOR UPDATE`,
          [unique],
        )
      ).rows;
      if (
        locked.length !== unique.length ||
        locked.some((action) => action.status !== "PENDING")
      )
        throw new AppError(
          "Seçili aksiyonlardan biri artık onaylanabilir durumda değil",
          409,
          "INVALID_ACTION_STATE",
        );
      return (
        await client.query(
          `UPDATE repricer_actions SET status='APPROVED',approved_by=$2,
           approved_at=NOW(),updated_at=NOW()
           WHERE id=ANY($1::bigint[]) RETURNING *`,
          [unique, actor],
        )
      ).rows;
    });
    await this.audit.record({
      actor,
      action: "ACTIONS_BULK_APPROVED",
      entityType: "repricer_action",
      after: { ids: unique },
    });
    return updated;
  }

  async editAndApprove(id, input, actor) {
    const proposedPrice = roundMoney(input.proposedPrice);
    if (!Number.isFinite(proposedPrice) || proposedPrice <= 0)
      throw new AppError(
        "Önerilen fiyat pozitif olmalı",
        400,
        "INVALID_PROPOSED_PRICE",
      );
    const { before, after } = await this.withTransaction(async (client) => {
      const action = (
        await client.query(
          "SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!action)
        throw new AppError("Aksiyon bulunamadı", 404, "ACTION_NOT_FOUND");
      if (action.status !== "PENDING")
        throw new AppError(
          "Yalnızca bekleyen aksiyon düzenlenebilir",
          409,
          "INVALID_ACTION_STATE",
        );
      const product = (
        await client.query(
          `SELECT * FROM products WHERE marketplace=$1 AND barcode=$2`,
          [action.marketplace, action.barcode],
        )
      ).rows[0];
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const minimumPrice = Math.max(
        Number(action.min_price || 0),
        Number(product.min_price || 0),
      );
      if (proposedPrice < minimumPrice)
        throw new AppError(
          "Düzenlenen fiyat minimum fiyatın altında olamaz",
          409,
          "BELOW_MINIMUM_PRICE",
          { proposedPrice, minimumPrice },
        );
      if (proposedPrice === roundMoney(action.old_price))
        throw new AppError(
          "Yeni fiyat mevcut fiyatla aynı olamaz",
          409,
          "MEANINGLESS_PRICE_CHANGE",
        );
      const moneyInput = {
        salePrice: proposedPrice,
        commissionRate: product.commission_rate,
        productCost: product.calculated_product_cost,
        shippingCost: product.calculated_shipping_cost,
        packagingCost: product.packaging_cost,
        serviceFee: product.service_fee,
      };
      const expectedProfit = calculateNetProfit(moneyInput);
      const expectedMargin = calculateNetMargin(moneyInput);
      const actionType =
        proposedPrice > Number(action.old_price)
          ? "FIYAT_ARTIR"
          : "FIYAT_DUSUR";
      const reason = String(input.reason || "").trim() || action.reason;
      const updated = (
        await client.query(
          `UPDATE repricer_actions SET proposed_price=$2,action=$3,
           expected_profit=$4,expected_margin=$5,reason=$6,source='MANUAL_EDIT',
           status='APPROVED',approved_by=$7,approved_at=NOW(),
           expires_at=NOW()+INTERVAL '30 minutes',
           safety_checks=COALESCE(safety_checks,'{}'::jsonb)||$8::jsonb,
           updated_at=NOW() WHERE id=$1 RETURNING *`,
          [
            id,
            proposedPrice,
            actionType,
            expectedProfit,
            expectedMargin,
            reason,
            actor,
            JSON.stringify({
              manuallyEdited: true,
              previousProposedPrice: Number(action.proposed_price),
              editedBy: actor,
            }),
          ],
        )
      ).rows[0];
      return { before: action, after: updated };
    });
    await this.audit.record({
      actor,
      action: "REPRICER_ACTION_EDITED_AND_APPROVED",
      entityType: "repricer_action",
      entityId: String(id),
      before,
      after,
    });
    return after;
  }

  async reject(id, actor) {
    const action = await this.actions.get(id);
    if (!action)
      throw new AppError("Aksiyon bulunamadı", 404, "ACTION_NOT_FOUND");
    if (!["PENDING", "APPROVED"].includes(action.status))
      throw new AppError(
        "Bu durumdaki aksiyon reddedilemez",
        409,
        "INVALID_ACTION_STATE",
      );
    const updated = await this.actions.updateStatus(id, "REJECTED", { actor });
    await this.audit.record({
      actor,
      action: "REPRICER_ACTION_REJECTED",
      entityType: "repricer_action",
      entityId: String(id),
      after: updated,
    });
    return updated;
  }

  async requestRevert(id, actor) {
    const original = await this.actions.get(id);
    if (!original)
      throw new AppError("Aksiyon bulunamadı", 404, "ACTION_NOT_FOUND");
    if (original.status !== "SUCCESS" || !original.applied_price)
      throw new AppError(
        "Yalnızca sonucu doğrulanmış fiyat aksiyonları geri alınabilir",
        409,
        "ACTION_NOT_REVERSIBLE",
      );
    const existing = await this.actions.findReversal(original.id);
    if (existing)
      throw new AppError(
        "Bu aksiyon için zaten bir geri alma kaydı var",
        409,
        "REVERSAL_EXISTS",
      );
    const product = await this.products.get(
      original.barcode,
      original.marketplace,
    );
    if (!product)
      throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
    if (Number(product.my_price) !== Number(original.applied_price))
      throw new AppError(
        "Ürünün güncel fiyatı geri alınacak aksiyonla eşleşmiyor",
        409,
        "PRICE_MISMATCH",
      );
    const open = await this.actions.findOpen(
      original.barcode,
      undefined,
      null,
      original.marketplace,
    );
    if (open)
      throw new AppError(
        "Ürün için açık bir fiyat aksiyonu var",
        409,
        "OPEN_ACTION_EXISTS",
      );
    const reversal = await this.repricer.manualAction(
      original.barcode,
      Number(original.old_price),
      actor,
      {
        source: "ROLLBACK",
        marketplace: original.marketplace,
        strategy: "Manuel",
        reason: `#${original.id} fiyat aksiyonunu güvenli geri alma`,
        revertsActionId: original.id,
        idempotencyKey: `rollback:${original.id}:${original.applied_price}:${original.old_price}`,
      },
    );
    await this.audit.record({
      actor,
      action: "PRICE_ACTION_REVERT_REQUESTED",
      entityType: "repricer_action",
      entityId: String(original.id),
      after: { reversalActionId: reversal.id },
    });
    return reversal;
  }

  async apply(id, actor) {
    const actionForRefresh =
      typeof this.actions?.get === "function"
        ? await this.actions.get(id)
        : null;
    const manualSource =
      !actionForRefresh?.source ||
      ["MANUAL", "MANUAL_EDIT", "ROLLBACK"].includes(actionForRefresh.source);
    if (
      actionForRefresh?.marketplace === "TRENDYOL" &&
      actionForRefresh.status === "APPROVED" &&
      !manualSource &&
      typeof this.repricer?.refreshBuybox === "function"
    ) {
      const refresh = await this.repricer.refreshBuybox(
        [actionForRefresh.barcode],
        actionForRefresh.marketplace,
      );
      if ((refresh.failedBarcodes || []).includes(actionForRefresh.barcode)) {
        const updated = await this.actions.updateStatus(id, "STALE", {
          actor,
          error: "Buybox verisi gönderim öncesi yenilenemedi",
          apiResponse: { buyboxRefresh: refresh },
        });
        await this.audit.record({
          actor,
          action: "PRICE_ACTION_STALE",
          entityType: "repricer_action",
          entityId: String(id),
          after: { code: "BUYBOX_STALE", refresh },
        });
        return updated;
      }
    }

    const preparation = await this.withTransaction(async (client) => {
      const locked = (
        await client.query(
          "SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!locked)
        throw new AppError("Aksiyon bulunamadı", 404, "ACTION_NOT_FOUND");
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
        locked.marketplace,
      );
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
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
        locked.marketplace,
      );
      if (open)
        throw new AppError(
          "Ürün için başka açık aksiyon var",
          409,
          "OPEN_ACTION_EXISTS",
        );
      const global = await this.repricer.globalSettings();
      const settings = product.settings || {};
      const effectiveSettings = {
        ...settings,
        learned_price_cut_tl: product.learning?.learned_price_cut_tl,
        learned_max_increase_tl: product.learning?.learned_max_increase_tl,
        learning_paused: product.learning?.paused,
        // Keep the final apply-time safety gate aligned with preview/generate.
        unlimited_increase:
          parseBoolean(global.unlimitedIncrease) ||
          parseBoolean(settings.unlimited_increase),
      };
      const freshProposal = proposePrice(product, effectiveSettings);
      const isManualSource =
        !locked.source ||
        ["MANUAL", "MANUAL_EDIT", "ROLLBACK"].includes(locked.source);
      const decisionChanged =
        !isManualSource &&
        (freshProposal.action === "KORU" ||
          freshProposal.action !== locked.action ||
          Math.abs(
            Number(freshProposal.proposedPrice) - Number(locked.proposed_price),
          ) >= 0.01);
      if (decisionChanged) {
        const updated = await this.actions.updateStatus(
          id,
          "STALE",
          {
            actor,
            error: "Buybox yenilemesi sonrası repricer kararı değişti",
            apiResponse: {
              previousDecision: {
                action: locked.action,
                proposedPrice: Number(locked.proposed_price),
                buyboxPrice: Number(locked.buybox_before || 0),
                rank: Number(locked.rank_before || 0),
              },
              refreshedDecision: freshProposal,
            },
          },
          client,
        );
        return { stale: true, updated };
      }
      const lockedPrice = Number(locked.proposed_price);
      const proposal = isManualSource
        ? {
            action:
              locked.action ||
              (lockedPrice < Number(locked.old_price)
                ? "FIYAT_DUSUR"
                : lockedPrice > Number(locked.old_price)
                  ? "FIYAT_ARTIR"
                  : "KORU"),
            proposedPrice: lockedPrice,
            targetRank: locked.target_rank ?? product.rank ?? null,
            obstacle: null,
            limitedBy: null,
          }
        : {
            ...freshProposal,
            proposedPrice: lockedPrice,
          };
      const economics = campaignEconomics(
        product,
        effectiveSettings,
        proposal.proposedPrice,
        Math.max(
          Number(product.min_price || 0),
          Number(effectiveSettings.minimum_price || 0),
        ),
      );
      proposal.campaignAdjustedMinPrice = economics.campaignAdjustedMinPrice;
      proposal.effectiveCandidatePrice = economics.effectiveCandidatePrice;
      proposal.effectiveCustomerPrice = economics.effectiveCustomerPrice;
      proposal.activeSellerDiscount = economics.activeSellerDiscount;
      proposal.trendyolFundedDiscount = economics.trendyolFundedDiscount;
      const moneyInput = {
        salePrice: economics.sellerSettlementPrice,
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
        locked.marketplace,
        client,
      );
      const safety = safetyCheck({
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
      const hardFailures = safety.failures.filter((code) => code !== "DRY_RUN");
      if (hardFailures.length)
        throw new AppError(
          `Fiyat güvenlik kontrollerinden geçmedi: ${hardFailures.join(", ")}`,
          409,
          "SAFETY_BLOCKED",
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
      await this.actions.updateStatus(id, "SENDING", { actor }, client);
      return { dryRun: false, locked, product };
    });
    if (preparation.stale) {
      await this.audit.record({
        actor,
        action: "PRICE_ACTION_STALE",
        entityType: "repricer_action",
        entityId: String(id),
        after: { code: "REPRICER_DECISION_CHANGED" },
      });
      return preparation.updated;
    }
    if (preparation.dryRun) {
      await this.audit.record({
        actor,
        action: "PRICE_ACTION_DRY_RUN",
        entityType: "repricer_action",
        entityId: String(id),
        after: preparation.updated,
      });
      return preparation.updated;
    }
    const locked = preparation.locked;
    try {
      if (locked.marketplace === "HEPSIBURADA")
        return await this.applyHepsiburada({
          id,
          actor,
          locked,
          product: preparation.product,
        });
      if (locked.marketplace !== "TRENDYOL")
        throw new AppError(
          "Pazaryeri fiyat adaptörü hazır değil",
          409,
          "MARKETPLACE_ADAPTER_NOT_READY",
        );
      const marketProduct = await this.trendyol.getProductByBarcode(
        locked.barcode,
      );
      if (!marketProduct)
        throw new AppError(
          "Ürün Trendyol'da bulunamadı; fiyat gönderimi durduruldu",
          409,
          "MARKET_PRODUCT_NOT_FOUND",
        );
      const marketPrice = roundMoney(marketProduct.salePrice);
      await this.actions.recordMarketPreflight(id, marketPrice);
      if (marketPrice <= 0 || marketPrice !== roundMoney(locked.old_price))
        throw new AppError(
          "Trendyol'daki güncel fiyat aksiyonun beklediği fiyatla eşleşmiyor",
          409,
          "MARKET_PRICE_MISMATCH",
          {
            expected: roundMoney(locked.old_price),
            observed: marketPrice,
          },
        );
      if (
        marketProduct.archived === true ||
        marketProduct.approved === false ||
        marketProduct.onSale === false ||
        (marketProduct.quantity !== undefined &&
          Number(marketProduct.quantity) <= 0)
      )
        throw new AppError(
          "Ürün Trendyol'da satışa uygun değil; fiyat gönderimi durduruldu",
          409,
          "MARKET_PRODUCT_UNAVAILABLE",
        );
      const response = await this.trendyol.updatePrices(
        [
          {
            barcode: locked.barcode,
            salePrice: Number(locked.proposed_price),
            listPrice: Number(locked.proposed_price),
          },
        ],
        { dryRun: false },
      );
      const batchId = response.batchRequestId || response.batchId || null;
      if (!batchId)
        throw new AppError(
          "Trendyol fiyat isteği takip numarası döndürmedi",
          502,
          "MARKET_BATCH_ID_MISSING",
        );
      const updated = await this.withTransaction(async (client) => {
        const action = await this.actions.updateStatus(
          id,
          "AWAITING_RESULT",
          {
            actor,
            batchId,
            apiResponse: { submission: response },
          },
          client,
        );
        return action;
      });
      await this.audit.record({
        actor,
        action: "PRICE_ACTION_SENT",
        entityType: "repricer_action",
        entityId: String(id),
        after: { batchId },
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
        action: stale ? "PRICE_ACTION_STALE" : "PRICE_ACTION_FAILED",
        entityType: "repricer_action",
        entityId: String(id),
        after: { code: error.code || "PRICE_ACTION_FAILED" },
      });
      throw error;
    }
  }

  async applyHepsiburada({ id, actor, locked, product }) {
    if (!this.marketplaceRegistry)
      throw new AppError(
        "Hepsiburada fiyat adaptörü hazır değil",
        409,
        "MARKETPLACE_ADAPTER_NOT_READY",
      );
    if (!locked.approved_by || locked.approved_by === "system")
      throw new AppError(
        "Hepsiburada canlı fiyatı için manuel aksiyon onayı gerekli",
        409,
        "MANUAL_LIVE_APPROVAL_REQUIRED",
      );
    if (!env.hepsiburadaPricePilotBarcodes.includes(String(locked.barcode)))
      throw new AppError(
        "Hepsiburada ürünü canlı fiyat pilot listesinde değil",
        409,
        "HEPSIBURADA_PILOT_NOT_ALLOWED",
      );
    const identifier = {
      merchantSku: product.merchant_sku || locked.barcode,
      hbSku: product.hb_sku || null,
      listingId: product.listing_id || null,
    };
    const current = await this.marketplaceRegistry.execute(
      "HEPSIBURADA",
      "getCurrentOffer",
      identifier,
    );
    if (current?.ok === false)
      throw new AppError(
        current.message || "Hepsiburada listing fiyatı okunamadı",
        409,
        current.code || "MARKETPLACE_CURRENT_PRICE_UNAVAILABLE",
      );
    if (!current)
      throw new AppError(
        "Hepsiburada listing bulunamadı",
        409,
        "MARKET_PRODUCT_NOT_FOUND",
      );
    const marketPrice = roundMoney(current.price);
    await this.actions.recordMarketPreflight(id, marketPrice);
    if (marketPrice <= 0 || marketPrice !== roundMoney(locked.old_price))
      throw new AppError(
        "Hepsiburada güncel fiyatı aksiyonun beklediği fiyatla eşleşmiyor",
        409,
        "MARKET_PRICE_MISMATCH",
        { expected: roundMoney(locked.old_price), observed: marketPrice },
      );
    if (!current.isSalable || Number(current.stock) <= 0)
      throw new AppError(
        "Hepsiburada listing satışa uygun değil",
        409,
        "MARKET_PRODUCT_UNAVAILABLE",
      );
    if (
      (Number(locked.proposed_price) > marketPrice &&
        current.priceIncreaseDisabled) ||
      (Number(locked.proposed_price) < marketPrice &&
        current.priceDecreaseDisabled)
    )
      throw new AppError(
        "Hepsiburada listing fiyat yönü platform tarafından kilitli",
        409,
        "MARKET_PRICE_DIRECTION_LOCKED",
      );
    const submission = await this.marketplaceRegistry.execute(
      "HEPSIBURADA",
      "updatePrice",
      {
        ...identifier,
        merchantSku: current.merchantSku || identifier.merchantSku,
        hbSku: current.hbSku || identifier.hbSku,
        price: Number(locked.proposed_price),
        idempotencyKey: locked.idempotency_key,
      },
    );
    if (submission?.ok === false)
      throw new AppError(
        submission.message || "Hepsiburada fiyat isteği gönderilmedi",
        409,
        submission.code || "MARKET_PRICE_UPDATE_BLOCKED",
      );
    const batchId = submission?.trackingId || null;
    if (!batchId)
      throw new AppError(
        "Hepsiburada fiyat isteği takip numarası döndürmedi",
        502,
        "MARKET_BATCH_ID_MISSING",
      );
    const updated = await this.actions.updateStatus(id, "AWAITING_RESULT", {
      actor,
      batchId,
      apiResponse: {
        submission: submission.response || { trackingId: batchId },
      },
    });
    await this.audit.record({
      actor,
      action: "PRICE_ACTION_SENT",
      entityType: "repricer_action",
      entityId: String(id),
      after: { marketplace: "HEPSIBURADA", batchId },
    });
    return updated;
  }
}

module.exports = { ActionService };
