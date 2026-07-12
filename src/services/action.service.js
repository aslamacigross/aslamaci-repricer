const { AppError } = require("../utils/errors");
const { proposePrice, safetyCheck } = require("../domain/repricer");
const { calculateNetProfit, calculateNetMargin } = require("../domain/pricing");

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
    const product = await this.products.get(original.barcode);
    if (!product)
      throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
    if (Number(product.my_price) !== Number(original.applied_price))
      throw new AppError(
        "Ürünün güncel fiyatı geri alınacak aksiyonla eşleşmiyor",
        409,
        "PRICE_MISMATCH",
      );
    const open = await this.actions.findOpen(original.barcode);
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
      const product = await this.products.get(locked.barcode);
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      if (Number(product.my_price) !== Number(locked.old_price))
        throw new AppError(
          "Ürün fiyatı aksiyon üretildikten sonra değişmiş",
          409,
          "PRICE_MISMATCH",
        );
      const open = await this.actions.findOpen(locked.barcode, client, id);
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
      const today = await this.actions.todayStats(product.barcode, client);
      const safety = safetyCheck({
        product,
        settings: {
          ...effectiveSettings,
          auto_update: settings.auto_update ?? product.auto_update,
        },
        global,
        proposal,
        manual: ["MANUAL", "ROLLBACK"].includes(locked.source),
        today: {
          actionCount: today.action_count,
          dayStartPrice: today.day_start_price,
        },
      });
      const hardFailures = safety.failures.filter((code) => code !== "DRY_RUN");
      if (hardFailures.length)
        throw new AppError(
          "Fiyat güvenlik kontrollerinden geçmedi",
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
    try {
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
      const updated = await this.withTransaction(async (client) => {
        const action = await this.actions.updateStatus(
          id,
          "AWAITING_RESULT",
          {
            actor,
            appliedPrice: Number(locked.proposed_price),
            batchId,
            apiResponse: response,
          },
          client,
        );
        await client.query(
          `UPDATE products SET my_price=$1,list_price=$1,
           calculated_net_profit=CASE WHEN commission_rate>0 THEN
             ROUND($1-($1*commission_rate/100)-calculated_product_cost-
               calculated_shipping_cost-packaging_cost-service_fee,2)
             ELSE calculated_net_profit END,
           calculated_net_margin=CASE WHEN $1>0 AND commission_rate>0 THEN
             ROUND((($1-($1*commission_rate/100)-calculated_product_cost-
               calculated_shipping_cost-packaging_cost-service_fee)/$1)*100,2)
             ELSE calculated_net_margin END,
           last_price_change_at=NOW(),updated_at=NOW()
           WHERE marketplace=$2 AND barcode=$3`,
          [Number(locked.proposed_price), locked.marketplace, locked.barcode],
        );
        await client.query(
          `INSERT INTO price_war_log(
            marketplace,barcode,product_name,old_price,new_price,price_diff,
            buybox_price,second_price,third_price,rank,min_price,action
          )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            locked.marketplace,
            locked.barcode,
            locked.product_name,
            locked.old_price,
            locked.proposed_price,
            Number(locked.proposed_price) - Number(locked.old_price),
            locked.buybox_before,
            locked.second_price,
            locked.third_price,
            locked.rank_before,
            locked.min_price,
            locked.action,
          ],
        );
        if (locked.reverts_action_id) {
          const original = await this.actions.markReverted(
            locked.reverts_action_id,
            locked.id,
            client,
          );
          if (!original)
            throw new AppError(
              "Geri alınan aksiyon artık uygun durumda değil",
              409,
              "REVERSAL_STATE_CHANGED",
            );
        }
        return action;
      });
      await this.audit.record({
        actor,
        action: "PRICE_ACTION_SENT",
        entityType: "repricer_action",
        entityId: String(id),
        after: { batchId },
      });
      if (locked.reverts_action_id)
        await this.audit.record({
          actor,
          action: "PRICE_ACTION_REVERTED",
          entityType: "repricer_action",
          entityId: String(locked.reverts_action_id),
          after: { reversalActionId: locked.id },
        });
      return updated;
    } catch (error) {
      await this.actions.updateStatus(id, "FAILED", {
        actor,
        error: error.message,
      });
      await this.audit.record({
        actor,
        action: "PRICE_ACTION_FAILED",
        entityType: "repricer_action",
        entityId: String(id),
        after: { error: error.message },
      });
      throw error;
    }
  }
}

module.exports = { ActionService };
