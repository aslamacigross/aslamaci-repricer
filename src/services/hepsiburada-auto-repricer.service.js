const { safeItemError } = require("./job.service");

class HepsiburadaAutoRepricerService {
  constructor({
    repricer,
    actions,
    products,
    actionService,
    hepsiburadaActionService,
    hepsiburadaLearning,
    hepsiburada,
  }) {
    Object.assign(this, {
      repricer,
      actions,
      products,
      actionService,
      hepsiburadaActionService,
      hepsiburadaLearning,
      hepsiburada,
    });
  }

  async run() {
    const global = await this.repricer.globalSettings();
    const verification = await this.hepsiburadaLearning.verifyPendingActions();
    const mutationGatesOpen = this.hepsiburada.livePriceUpdatesEnabled();
    const openAutomationActions =
      global.dryRun || !global.repricerEnabled || !mutationGatesOpen
        ? []
        : await this.actions.openAutomationActions("HEPSIBURADA", 500);
    const generated = await this.repricer.generate({
      source: "AUTO",
      marketplace: "HEPSIBURADA",
    });
    if (global.dryRun || !global.repricerEnabled || !mutationGatesOpen)
      return {
        processed: generated.processed,
        successful: 0,
        failed: 0,
        metadata: {
          dryRun: global.dryRun,
          repricerEnabled: global.repricerEnabled,
          mutationGatesOpen,
          created: generated.created,
          skipped: generated.skipped,
          verification,
        },
      };

    let successful = 0;
    let failed = 0;
    let stale = 0;
    const itemErrors = [];
    const actionById = new Map();
    for (const action of openAutomationActions)
      actionById.set(action.id, action);
    for (const action of generated.items) actionById.set(action.id, action);
    for (const action of actionById.values()) {
      try {
        if (action.marketplace !== "HEPSIBURADA") continue;
        const product = await this.products.get(action.barcode, "HEPSIBURADA");
        if (
          product?.settings?.mode !== "AUTOMATIC" ||
          !product?.settings?.auto_update
        )
          continue;
        if (action.status === "PENDING")
          await this.actionService.approve(action.id, "system");
        await this.hepsiburadaActionService.apply(action.id, "system");
        successful++;
      } catch (error) {
        if (["PRICE_MISMATCH", "MARKET_PRICE_MISMATCH"].includes(error.code)) {
          stale++;
          continue;
        }
        failed++;
        itemErrors.push(safeItemError(action, error));
        const latest = await this.actions.get(action.id);
        if (
          latest &&
          ["PENDING", "APPROVED", "SENDING"].includes(latest.status)
        ) {
          await this.actions.updateStatus(action.id, "FAILED", {
            actor: "system",
            error: error.message,
          });
        }
      }
    }
    return {
      processed: actionById.size,
      successful,
      failed,
      metadata: {
        created: generated.created,
        skipped: generated.skipped,
        openAutomation: openAutomationActions.length,
        stale,
        verification,
        itemErrors,
      },
    };
  }
}

module.exports = { HepsiburadaAutoRepricerService };
