const { MarketplaceAdapter } = require("../marketplace-adapter");

class TrendyolAdapter extends MarketplaceAdapter {
  constructor(service) {
    super({
      code: "TRENDYOL",
      status: "READY",
      capabilities: {
        supportsCatalogProductRead: true,
        supportsCommissionApi: true,
        supportsBuybox: true,
        supportsOrders: true,
        supportsFinancialTransactions: true,
        supportsPriceUpdate: true,
        supportsInventoryUpdate: true,
        supportsBatchStatus: true,
        supportsListingVerification: true,
      },
    });
    this.service = service;
  }

  configured() {
    return Boolean(this.service?.configured?.());
  }

  async testConnection() {
    if (!this.configured()) return this.credentialsMissing("testConnection");
    await this.service.listProducts(0, 1);
    return {
      ok: true,
      code: "CONNECTION_OK",
      message: "Trendyol bağlantısı doğrulandı",
      marketplace: this.code,
    };
  }

  async fetchProducts(input = {}) {
    return this.service.listProducts(input.page || 0, input.size || 50);
  }

  async fetchOrders(input = {}) {
    return this.service.listOrders(input);
  }

  async fetchBuybox(input = {}) {
    return this.service.buybox(input.barcodes || input);
  }

  async fetchFinancialTransactions(input = {}) {
    return this.service.listSettlements(input);
  }
}

module.exports = { TrendyolAdapter };
