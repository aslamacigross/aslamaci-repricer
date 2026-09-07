const { safeItemError } = require("./job.service");

const DEFAULT_SUBMISSION_INTERVAL_MS = 2000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

class HepsiburadaAutoRepricerService {
  constructor({
    repricer,
    actions,
    products,
    actionService,
    hepsiburadaActionService,
    hepsiburadaLearning,
    hepsiburada,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    submissionIntervalMs = DEFAULT_SUBMISSION_INTERVAL_MS,
    rateLimitCooldownMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS,
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
    this.sleep = sleep;
    this.now = now;
    this.submissionIntervalMs = Math.max(Number(submissionIntervalMs) || 0, 0);
    this.rateLimitCooldownMs = Math.max(Number(rateLimitCooldownMs) || 0, 0);
    this.running = false;
    this.lastAttemptStartedAt = null;
    this.rateLimitedUntil = 0;
  }

  async run() {
    if (this.running)
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        metadata: { overlapSkipped: true },
      };
    const cooldownRemainingMs = Math.max(this.rateLimitedUntil - this.now(), 0);
    if (cooldownRemainingMs > 0)
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        metadata: { rateLimitCooldown: true, cooldownRemainingMs },
      };
    this.running = true;
    try {
      return await this.runOnce();
    } finally {
      this.running = false;
    }
  }

  async waitForAttemptSlot() {
    let waitedMs = 0;
    if (this.lastAttemptStartedAt != null) {
      waitedMs = Math.max(
        this.lastAttemptStartedAt + this.submissionIntervalMs - this.now(),
        0,
      );
      if (waitedMs > 0) await this.sleep(waitedMs);
    }
    this.lastAttemptStartedAt = this.now();
    return waitedMs;
  }

  async runOnce() {
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
    let attempted = 0;
    let pacingWaitMs = 0;
    let rateLimited = false;
    let retryAfterMs = null;
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
        pacingWaitMs += await this.waitForAttemptSlot();
        attempted++;
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
        if (Number(error.status) === 429 || error.code === "HTTP_429") {
          rateLimited = true;
          retryAfterMs = Math.max(
            Number(error.retryAfterMs) || this.rateLimitCooldownMs,
            this.submissionIntervalMs,
          );
          this.rateLimitedUntil = this.now() + retryAfterMs;
          break;
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
        attempted,
        pacingWaitMs,
        submissionIntervalMs: this.submissionIntervalMs,
        overlapSkipped: false,
        rateLimited,
        retryAfterMs,
        stale,
        verification,
        itemErrors,
      },
    };
  }
}

module.exports = { HepsiburadaAutoRepricerService };
