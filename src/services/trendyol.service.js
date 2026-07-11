const { env } = require("../config/env");

class TrendyolService {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.baseUrl = options.baseUrl || "https://apigw.trendyol.com/integration";
    this.timeoutMs = options.timeoutMs || 20000;
  }
  headers() {
    return {
      Authorization: `Basic ${Buffer.from(`${env.trendyolApiKey}:${env.trendyolApiSecret}`).toString("base64")}`,
      "User-Agent": `${env.trendyolSupplierId} - SelfIntegration`,
      "Content-Type": "application/json",
    };
  }
  async request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { ...this.headers(), ...(options.headers || {}) },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(
          `Trendyol HTTP ${response.status}: ${text.slice(0, 500)}`,
        );
        error.status = response.status;
        throw error;
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }
  async listProducts(page = 0, size = 200) {
    return this.request(
      `/product/sellers/${env.trendyolSupplierId}/products?approved=true&page=${page}&size=${size}`,
    );
  }
  async buybox(barcodes) {
    return this.request(
      `/product/sellers/${env.trendyolSupplierId}/products/buybox-information`,
      { method: "POST", body: JSON.stringify({ barcodes }) },
    );
  }
  async updatePrices(items, { dryRun = true } = {}) {
    if (dryRun) return { dryRun: true, itemCount: items.length, items };
    return this.request(
      `/inventory/sellers/${env.trendyolSupplierId}/products/price-and-inventory`,
      { method: "POST", body: JSON.stringify({ items }) },
    );
  }
  configured() {
    return Boolean(
      env.trendyolApiKey && env.trendyolApiSecret && env.trendyolSupplierId,
    );
  }
}

module.exports = { TrendyolService };
