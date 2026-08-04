const { MarketplaceAdapter } = require("../marketplace-adapter");

class HepsiburadaAdapter extends MarketplaceAdapter {
  constructor(service) {
    super({
      code: "HEPSIBURADA",
      status: service?.configured?.() ? "READY" : "WAITING_CREDENTIALS",
      capabilities: {
        supportsCatalogProductRead: service?.configured?.() === true,
        supportsListingsRead: service?.configured?.() === true,
        supportsCurrentPriceRead: service?.configured?.() === true,
        supportsCommissionApi: service?.configured?.() === true,
        supportsBuybox: false,
        supportsOrders: true,
        supportsFinancialTransactions: false,
        supportsPriceUpdate: service?.configured?.() === true,
        supportsPriceUpdateStatus: service?.configured?.() === true,
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

  async fetchCommissions(input = {}) {
    return this.service.fetchCommissions(input.skus || []);
  }

  async updatePriceAndInventory(input = {}) {
    return this.service.updatePriceAndInventory(input);
  }

  async listListings(input = {}) {
    return this.service.fetchAllListings(input);
  }

  async getListingByIdentifier(input = {}) {
    return this.service.getListingByIdentifier(input);
  }

  async getCurrentOffer(input = {}) {
    return this.service.getCurrentOffer(input);
  }

  async getCommission(input = {}) {
    const rows = await this.service.fetchCommissions([
      input.merchantSku,
      input.hbSku,
    ]);
    return rows[0] || null;
  }

  async updatePrice(input = {}) {
    return this.service.submitPriceUpdate(input);
  }

  async getPriceUpdateStatus(input = {}) {
    return this.service.getPriceUpdateStatus(input.trackingId || input.id);
  }
}

module.exports = { HepsiburadaAdapter };
