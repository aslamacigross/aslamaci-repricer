const { MarketplaceAdapter } = require("../marketplace-adapter");

class HepsiburadaAdapter extends MarketplaceAdapter {
  constructor(service) {
    super({
      code: "HEPSIBURADA",
      status: service?.configured?.() ? "READY" : "WAITING_CREDENTIALS",
      capabilities: {
        supportsCatalogProductRead: service?.configured?.() === true,
        supportsOrders: true,
        supportsFinancialTransactions: false,
        supportsPriceUpdate:
          service?.configured?.() === true &&
          service?.priceUpdatesEnabled?.() === true,
        supportsInventoryUpdate:
          service?.configured?.() === true &&
          service?.priceUpdatesEnabled?.() === true,
        supportsExistingCatalogOfferCreate: false,
        supportsNewProductCreate: false,
      },
    });
    this.service = service;
  }

  configured() {
    return Boolean(this.service?.configured?.());
  }

  getRuntimeStatus() {
    return this.service?.runtimeStatus?.() || {};
  }

  async testConnection() {
    if (!this.configured()) return this.credentialsMissing("testConnection");
    const response = await this.service.health();
    return {
      ok: response.connected === true,
      code: response.connected ? "CONNECTION_OK" : "CONNECTION_FAILED",
      message: response.connected
        ? "Hepsiburada bağlantısı doğrulandı"
        : "Hepsiburada bağlantısı doğrulanamadı",
      marketplace: this.code,
      environment: response.environment,
      mutationsEnabled: response.mutationsEnabled === true,
    };
  }

  async fetchOrders(input = {}) {
    return this.service.listOrders(input);
  }

  async fetchProducts(input = {}) {
    return this.service.listListings(input);
  }

  async updatePriceAndInventory(input = {}) {
    return this.service.updatePriceAndInventory(input);
  }
}

module.exports = { HepsiburadaAdapter };
