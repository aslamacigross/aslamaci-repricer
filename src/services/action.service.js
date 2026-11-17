const { AppError } = require("../utils/errors");
const { proposePrice, safetyCheck } = require("../domain/repricer");
const { calculateNetProfit, calculateNetMargin } = require("../domain/pricing");
const { roundMoney, parseBoolean } = require("../utils/numbers");
const {
  verifyCommissionEvidence,
} = require("../domain/hepsiburada-commission-evidence");

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
    });
  }

  async assertPilotApproval(action, client) {
    if (action.marketplace !== "HEPSIBURADA" || !this.repricer?.hbPilot) return;
    const product = await this.products.get(
      action.barcode,
      "HEPSIBURADA",
      client,
    );
    if (!product)
      throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
    const proof = this.repricer.hbPilot.assertAction(action, product);
    if (action.safety_checks?.hbFloorRecovery) {
      const saved = action.safety_checks.hbFloorRecovery.commission;
      const current = verifyCommissionEvidence(
        saved,
        product,
        this.repricer.hbPilot.config().hepsiburadaMerchantId,
      );
      if (current.fingerprint !== saved.fingerprint)
        throw new AppError("Komisyon snapshot değişti", 409, "STALE_PREVIEW");
    }
    if (
      proof &&
      (product.settings?.mode !== "AUTOMATIC" ||
        !parseBoolean(product.auto_update) ||
        !parseBoolean(product.settings?.auto_update))
    )
      throw new AppError(
        "Pilot otomasyon izni kapalı",
        409,
        "HB_PILOT_POLICY_DENIED",
      );
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
    await this.assertPilotApproval(action);
    if (action.safety_checks?.hbPilot) {
      return this.withTransaction(async (client) => {
        const locked = (
          await client.query(
            "SELECT * FROM repricer_actions WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (locked?.status !== "PENDING")
          throw new AppError(
            "Aksiyon artık beklemiyor",
            409,
            "INVALID_ACTION_STATE",
          );
        await this.assertPilotApproval(locked, client);
        const updated = await this.actions.updateStatus(
          id,
          "APPROVED",
          { actor },
          client,
        );
        await this.audit.record(
          {
            actor,
            action: "REPRICER_ACTION_APPROVED",
            entityType: "repricer_action",
            entityId: String(id),
            before: locked,
            after: updated,
          },
          client,
        );
        return updated;
      });
    }
    const updated = await this.actions.updateStatus(id, "APPROVED", {
      actor,
      expectedStatus: "PENDING",
    });
    if (!updated)
      throw new AppError(
        "Aksiyon artık beklemiyor",
        409,
        "INVALID_ACTION_STATE",
      );
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
          `SELECT * FROM repricer_actions
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
      for (const action of locked)
        await this.assertPilotApproval(action, client);
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
      await this.assertPilotApproval(action, client);
      if (action.safety_checks?.hbPilot)
        throw new AppError(
          "Pilot hedefi düzenlemek için yeni preview gerekli",
          409,
          "HB_PILOT_REPREVIEW_REQUIRED",
        );
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
    const updated = await this.actions.updateStatus(id, "REJECTED", {
      actor,
      expectedStatus: action.status,
    });
    if (!updated)
      throw new AppError(
        "Aksiyonun durumu değişti",
        409,
        "INVALID_ACTION_STATE",
      );
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
      const proposal = proposePrice(product, effectiveSettings);
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
      return { dryRun: false, locked };
    });
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
    let dispatchStarted = false;
    let response;
    let batchId;
    try {
      if (locked.marketplace !== "TRENDYOL")
        throw new AppError(
          "Hepsiburada fiyat gönderimi credentials tamamlanana kadar kilitli",
          409,
          "MARKETPLACE_CREDENTIALS_MISSING",
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
      dispatchStarted = true;
      response = await this.trendyol.updatePrices(
        [
          {
            barcode: locked.barcode,
            salePrice: Number(locked.proposed_price),
            listPrice: Number(locked.proposed_price),
          },
        ],
        { dryRun: false },
      );
      batchId = response.batchRequestId || response.batchId || null;
      if (!batchId)
        throw new AppError(
          "Trendyol fiyat isteği takip numarası döndürmedi",
          502,
          "MARKET_BATCH_ID_MISSING",
        );
    } catch (error) {
      if (dispatchStarted) {
        // Once POST starts, transport failure/missing receipt cannot prove
        // rejection. Keep the already committed SENDING barrier for reconciliation.
        try {
          await this.actions.updateStatus(id, "SENDING", {
            actor,
            error: "External outcome UNKNOWN",
            apiResponse: {
              dispatch: {
                outcome: "UNKNOWN",
                code: error.code || "TRANSPORT_ERROR",
              },
              ...(response ? { submission: response } : {}),
            },
          });
        } catch {
          /* Original committed SENDING still blocks another dispatch. */
        }
        throw new AppError(
          "Trendyol gönderim sonucu belirsiz; otomatik tekrar yasak",
          409,
          "TY_SUBMISSION_OUTCOME_UNKNOWN",
        );
      }
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
    const receipt = {
      submission: response,
      dispatchReceipt: {
        outcome: "ACCEPTED",
        batchId,
        actor,
        actionId: id,
        before: "SENDING",
        after: "AWAITING_RESULT",
        recordedAt: new Date().toISOString(),
      },
    };
    try {
      return await this.withTransaction(async (client) => {
        const updated = await this.actions.recordTrendyolSubmission(
          id,
          batchId,
          actor,
          receipt,
          client,
        );
        await this.audit.record(
          {
            actor,
            action: "PRICE_ACTION_SENT",
            entityType: "repricer_action",
            entityId: String(id),
            after: { batchId },
          },
          client,
        );
        return updated;
      });
    } catch {
      try {
        return await this.withTransaction((client) =>
          this.actions.recordTrendyolSubmission(
            id,
            batchId,
            actor,
            { ...receipt, auditPending: true },
            client,
          ),
        );
      } catch {
        throw new AppError(
          "Trendyol kabul etti; yerel kayıt doğrulanamadı",
          503,
          "TY_SUBMISSION_PERSISTENCE_UNCERTAIN",
        );
      }
    }
  }
}

module.exports = { ActionService };
