const {
  MarketplaceAdapter,
  MARKETPLACE_RESULT_CODES,
  marketplaceResult,
} = require("../marketplace-adapter");

class SkeletonMarketplaceAdapter extends MarketplaceAdapter {
  constructor(code) {
    super({ code, status: "SKELETON", capabilities: {} });
  }

  async testConnection() {
    return marketplaceResult(
      MARKETPLACE_RESULT_CODES.ADAPTER_NOT_READY,
      `${this.code} adaptörü henüz hazır değil`,
      { marketplace: this.code, operation: "testConnection" },
    );
  }
}

module.exports = { SkeletonMarketplaceAdapter };
