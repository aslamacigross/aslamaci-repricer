const { MarketplaceAdapter } = require("../marketplace-adapter");

class HepsiburadaAdapter extends MarketplaceAdapter {
  constructor(service) {
    super({
      code: "HEPSIBURADA",
      status: "WAITING_CREDENTIALS",
      capabilities: {
        supportsOrders: true,
      },
    });
    this.service = service;
  }

  configured() {
    return Boolean(this.service?.configured?.());
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
    };
  }

  async fetchOrders(input = {}) {
    return this.service.listOrders(input);
  }
}

module.exports = { HepsiburadaAdapter };
