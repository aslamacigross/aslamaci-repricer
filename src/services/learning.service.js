class LearningService {
  constructor({ actions, sync, audit }) {
    this.actions = actions;
    this.sync = sync;
    this.audit = audit;
  }

  async verifyPendingActions() {
    if (
      !this.actions.pendingVerifications ||
      !this.sync?.verifyPriceAction ||
      !this.actions.confirmApplied
    )
      return { processed: 0, verified: 0, failed: 0, pending: 0, errors: 0 };
    const actions = await this.actions.pendingVerifications();
    const summary = {
      processed: actions.length,
      verified: 0,
      failed: 0,
      pending: 0,
      errors: 0,
    };
    for (const action of actions) {
      try {
        const result = await this.sync.verifyPriceAction(action);
        if (result.status === "VERIFIED") {
          await this.actions.confirmApplied(action.id, result);
          await this.audit?.record?.({
            actor: "system",
            action: "PRICE_ACTION_VERIFIED",
            entityType: "repricer_action",
            entityId: String(action.id),
            after: {
              barcode: action.barcode,
              batchId: action.batch_id,
              appliedPrice: result.observedPrice,
            },
          });
          summary.verified++;
          continue;
        }
        const ageMinutes = action.sent_at
          ? (Date.now() - new Date(action.sent_at).getTime()) / 60000
          : 0;
        const verificationTimedOut =
          ["PENDING", "MISMATCH"].includes(result.status) && ageMinutes >= 60;
        if (result.status === "FAILED" || verificationTimedOut) {
          await this.actions.markVerificationFailed(
            action.id,
            result.error ||
              "Trendyol fiyatı 60 dakika içinde doğrulanamadı; otomatik tekrar gönderim yapılmadı",
            result.batchResponse,
          );
          await this.audit?.record?.({
            actor: "system",
            action: "PRICE_ACTION_VERIFICATION_FAILED",
            entityType: "repricer_action",
            entityId: String(action.id),
            after: {
              barcode: action.barcode,
              batchId: action.batch_id,
              reason: result.error || "VERIFICATION_TIMEOUT",
            },
          });
          summary.failed++;
        } else {
          summary.pending++;
        }
      } catch (error) {
        summary.errors++;
        await this.audit?.integration?.({
          integration: "TRENDYOL",
          level: "ERROR",
          operation: "PRICE_ACTION_VERIFICATION",
          message: error.message,
          details: { actionId: action.id, barcode: action.barcode },
        });
      }
    }
    return summary;
  }

  async checkOutcomes(elapsedMinutes) {
    const verification = await this.verifyPendingActions();
    let pending = await this.actions.pendingOutcomes(elapsedMinutes);
    let refreshFailures = 0;
    if (pending.length && this.sync) {
      const refresh = await this.sync.buybox(
        pending.map((action) => action.barcode),
      );
      const updated = new Set(refresh.updatedBarcodes || []);
      refreshFailures = Number(refresh.failed || 0);
      pending = (await this.actions.pendingOutcomes(elapsedMinutes)).filter(
        (action) => updated.has(action.barcode),
      );
    }
    let successful = 0,
      failed = 0;
    for (const action of pending) {
      const before = Number(action.rank_before || 0),
        after = Number(action.rank_after || 0);
      const targetRank = Number(action.target_rank || action.rank_before || 1);
      const targetAchieved = after > 0 && after <= targetRank;
      const buyboxWon = after === 1 && before !== 1;
      const buyboxLost = before === 1 && after !== 1;
      const result = buyboxWon
        ? "BUYBOX_WON"
        : buyboxLost
          ? "BUYBOX_LOST"
          : targetAchieved && after === 1
            ? "BUYBOX_KEPT"
            : targetAchieved
              ? "TARGET_RANK_ACHIEVED"
              : "TARGET_RANK_MISSED";
      const outcome = {
        buyboxWon,
        buyboxLost,
        targetAchieved,
        targetRank,
        result,
        elapsedMinutes,
      };
      await this.actions.recordOutcome(action, outcome);
      if (elapsedMinutes >= 60)
        await this.actions.applyLearningOutcome(action, outcome);
      if (targetAchieved) successful++;
      else failed++;
      if (elapsedMinutes >= 60)
        await this.actions.updateStatus(
          action.id,
          targetAchieved ? "SUCCESS" : "FAILED",
          {
            error: targetAchieved
              ? null
              : `Hedef ${targetRank}. sıra 60 dakika içinde alınamadı`,
          },
        );
    }
    return {
      processed: pending.length,
      successful,
      failed,
      refreshFailures,
      verification,
    };
  }
}

module.exports = { LearningService };
