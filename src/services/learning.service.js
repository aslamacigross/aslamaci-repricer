class LearningService {
  constructor({ actions, sync, audit, marketplace = "TRENDYOL" }) {
    this.actions = actions;
    this.sync = sync;
    this.audit = audit;
    this.marketplace = String(marketplace).toUpperCase();
  }

  async verifyPendingActions(actionId = null) {
    if (
      !this.actions.pendingVerifications ||
      !this.sync?.verifyPriceAction ||
      !this.actions.confirmApplied
    )
      return { processed: 0, verified: 0, failed: 0, pending: 0, errors: 0 };
    const actions = await this.actions.pendingVerifications(
      200,
      actionId,
      this.marketplace,
    );
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
          await this.actions.confirmApplied(action.id, {
            ...result,
            expectedBatchId: action.batch_id,
          });
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
        if (result.status === "FAILED") {
          const failed = await this.actions.markVerificationFailed(
            action.id,
            result.error || "Provider fiyat işlemini kesin olarak reddetti",
            result.batchResponse,
            action.batch_id,
          );
          if (!failed) continue;
          await this.audit?.record?.({
            actor: "system",
            action: "PRICE_ACTION_VERIFICATION_FAILED",
            entityType: "repricer_action",
            entityId: String(action.id),
            after: {
              barcode: action.barcode,
              batchId: action.batch_id,
              reason: result.error || "PROVIDER_REJECTED",
            },
          });
          summary.failed++;
        } else {
          await this.recordPending(action, result);
          summary.pending++;
        }
      } catch (error) {
        summary.errors++;
        // A failed GET/local write is not evidence that the provider rejected POST.
        try {
          await this.recordPending(action, {
            status: "UNKNOWN",
            error: error.message,
          });
        } catch {
          /* A local warning failure must leave the dispatch barrier intact. */
        }
        await this.audit?.integration?.({
          integration: this.marketplace,
          level: "ERROR",
          operation: "PRICE_ACTION_VERIFICATION",
          message: error.message,
          details: { actionId: action.id, barcode: action.barcode },
        });
      }
    }
    return summary;
  }

  async recordPending(action, result) {
    const ageMinutes = action.sent_at
      ? (Date.now() - new Date(action.sent_at).getTime()) / 60000
      : 0;
    const overdue = ageMinutes >= 60;
    const error = overdue
      ? "PRICE_VERIFICATION_RECONCILIATION_REQUIRED: provider sonucu veya uygulanan fiyat doğrulanamadı; otomatik tekrar yasak"
      : result.error || null;
    const saved = await this.actions.recordVerificationPending?.(
      action.id,
      { ...result, error },
      action.batch_id,
    );
    // The persistent action warning survives an unavailable audit sink. Emit
    // once per overdue episode instead of flooding the integration log each poll.
    if (saved && overdue && action.verification_error !== error)
      await this.audit?.integration?.({
        integration: this.marketplace,
        level: "WARN",
        operation: "PRICE_VERIFICATION_RECONCILIATION_REQUIRED",
        message: error,
        details: {
          actionId: action.id,
          barcode: action.barcode,
          batchId: action.batch_id,
          ageMinutes,
          verificationStatus: result.status,
        },
      });
  }

  async checkOutcomes(elapsedMinutes, actionId = null) {
    const verification = await this.verifyPendingActions(actionId);
    let pending = await this.actions.pendingOutcomes(
      elapsedMinutes,
      actionId,
      this.marketplace,
    );
    let refreshFailures = 0;
    if (pending.length && this.sync) {
      try {
        const refresh = await this.sync.buybox(
          pending.map((action) => action.barcode),
        );
        const updated = new Set(refresh.updatedBarcodes || []);
        refreshFailures = Number(refresh.failed || 0);
        pending = (
          await this.actions.pendingOutcomes(
            elapsedMinutes,
            actionId,
            this.marketplace,
          )
        ).filter((action) => updated.has(action.barcode));
      } catch (error) {
        refreshFailures = pending.length;
        pending = [];
        await this.audit?.integration?.({
          integration: this.marketplace,
          level: "WARN",
          operation: "PRICE_ACTION_OUTCOME_BUYBOX_REFRESH",
          message: error.message,
          details: { actionId, elapsedMinutes },
        });
      }
    }
    let successful = 0,
      failed = 0,
      recoveries = 0;
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
      const recorded = await this.actions.recordOutcome(action, outcome);
      if (!recorded) continue;
      // An upward probe that loses Buybox returns to the price that had just
      // been observed winning. The repository makes this idempotent, so 5m
      // retries cannot create a chain of recovery actions.
      if (
        elapsedMinutes === 5 &&
        outcome.buyboxLost &&
        Number(action.rank_before) === 1 &&
        Number(action.proposed_price) > Number(action.old_price) &&
        this.actions.createBuyboxRecovery
      ) {
        const recovery = await this.actions.createBuyboxRecovery(action);
        if (recovery) {
          recoveries++;
          await this.actions.applyLearningOutcome?.(action, outcome);
        }
      }
      if (elapsedMinutes >= 60)
        await this.actions.applyLearningOutcome(action, outcome);
      if (targetAchieved) successful++;
      else failed++;
      // SUCCESS describes verified price application. Buybox success/failure is
      // persisted in the outcome/learning tables and must not rewrite that state.
    }
    return {
      processed: pending.length,
      successful,
      failed,
      recoveries,
      refreshFailures,
      verification,
    };
  }
}

module.exports = { LearningService };
