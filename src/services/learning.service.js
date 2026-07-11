class LearningService {
  constructor({ actions }) {
    this.actions = actions;
  }

  async checkOutcomes(elapsedMinutes) {
    const pending = await this.actions.pendingOutcomes(elapsedMinutes);
    let successful = 0,
      failed = 0;
    for (const action of pending) {
      const before = Number(action.rank_before || 0),
        after = Number(action.rank_after || 0);
      const buyboxWon = after === 1 && before !== 1;
      const buyboxLost = before === 1 && after !== 1;
      const result = buyboxWon
        ? "BUYBOX_WON"
        : buyboxLost
          ? "BUYBOX_LOST"
          : after === 1
            ? "BUYBOX_KEPT"
            : "BUYBOX_NOT_WON";
      const outcome = { buyboxWon, buyboxLost, result, elapsedMinutes };
      await this.actions.recordOutcome(action, outcome);
      if (elapsedMinutes >= 15)
        await this.actions.applyLearningOutcome(action, outcome);
      if (buyboxWon || after === 1) successful++;
      else failed++;
      if (elapsedMinutes >= 60)
        await this.actions.updateStatus(
          action.id,
          buyboxWon || after === 1 ? "SUCCESS" : "FAILED",
          {
            error:
              buyboxWon || after === 1
                ? null
                : "Buybox 60 dakika içinde alınamadı",
          },
        );
    }
    return { processed: pending.length, successful, failed };
  }
}

module.exports = { LearningService };
