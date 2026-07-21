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

  async validateListingPayload(input = {}) {
    const errors = [];
    if (!input.barcode) errors.push("LISTING_BARCODE_REQUIRED");
    if (!input.title) errors.push("TITLE_REQUIRED");
    if (!input.categoryId) errors.push("CATEGORY_REQUIRED");
    if (!(Number(input.stock) >= 0)) errors.push("STOCK_INVALID");
    if (!(Number(input.salePrice) > 0)) errors.push("PRICE_REQUIRED");
    return {
      ok: errors.length === 0,
      code: errors.length ? "LISTING_PAYLOAD_INVALID" : "LISTING_PAYLOAD_VALID",
      marketplace: this.code,
      errors,
      dryRun: true,
    };
  }

  async createProductDraft(input = {}) {
    const validation = await this.validateListingPayload(input);
    return {
      ...validation,
      code: validation.ok ? "PRODUCT_DRAFT_READY" : validation.code,
      payload: input,
      dryRun: true,
      mutationPerformed: false,
    };
  }
}

module.exports = { TrendyolAdapter };
