class LearningService {
  constructor({ actions, sync }) {
    this.actions = actions;
    this.sync = sync;
  }

  async checkOutcomes(elapsedMinutes) {
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
    };
  }
}

module.exports = { LearningService };
