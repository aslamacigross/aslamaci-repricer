const { env } = require("../config/env");

const DEFAULT_ENDPOINTS = Object.freeze({
  production: {
    orderBaseUrl: "https://oms-external.hepsiburada.com",
    listingBaseUrl: "https://listing-external.hepsiburada.com",
    productBaseUrl: "https://mpop.hepsiburada.com/product/api",
  },
  sit: {
    orderBaseUrl: "https://oms-external-sit.hepsiburada.com",
    listingBaseUrl: "https://listing-external-sit.hepsiburada.com",
    productBaseUrl: "https://mpop-sit.hepsiburada.com/product/api",
  },
});

function normalizedEnvironment(value = env.hepsiburadaEnv) {
  return ["sit", "test"].includes(String(value).toLowerCase())
    ? "sit"
    : "production";
}

class HepsiburadaService {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.environment = normalizedEnvironment(options.environment);
    const defaults = DEFAULT_ENDPOINTS[this.environment];
    this.orderBaseUrl =
      options.orderBaseUrl ||
      env.hepsiburadaOrderBaseUrl ||
      defaults.orderBaseUrl;
    this.listingBaseUrl =
      options.listingBaseUrl ||
      env.hepsiburadaListingBaseUrl ||
      defaults.listingBaseUrl;
    this.productBaseUrl =
      options.productBaseUrl ||
      env.hepsiburadaProductBaseUrl ||
      defaults.productBaseUrl;
    this.timeoutMs = options.timeoutMs || 20000;
  }

  configured() {
    return Boolean(
      env.hepsiburadaMerchantId &&
      (env.hepsiburadaPassword || env.hepsiburadaIntegratorKey),
    );
  }

  mutationsEnabled() {
    return env.hepsiburadaMutationsEnabled === true;
  }

  priceUpdatesEnabled() {
    return env.hepsiburadaPriceUpdatesEnabled === true;
  }

  userAgent() {
    return (
      env.hepsiburadaUserAgent ||
      (env.hepsiburadaMerchantId
        ? `${env.hepsiburadaMerchantId} - AslamaciERP`
        : "AslamaciERP")
    );
  }

  runtimeStatus() {
    return {
      environment: this.environment,
      configured: this.configured(),
      mutationsEnabled: this.mutationsEnabled(),
      orderEndpointConfigured: Boolean(this.orderBaseUrl),
      listingEndpointConfigured: Boolean(this.listingBaseUrl),
      productEndpointConfigured: Boolean(this.productBaseUrl),
      userAgentConfigured: Boolean(env.hepsiburadaUserAgent),
      priceUpdatesEnabled: this.priceUpdatesEnabled(),
    };
  }

  headers() {
    const username = env.hepsiburadaUsername || env.hepsiburadaMerchantId || "";
    const password =
      env.hepsiburadaPassword || env.hepsiburadaIntegratorKey || "";
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        "base64",
      )}`,
      "User-Agent": this.userAgent(),
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        ...options,
        headers: { ...this.headers(), ...(options.headers || {}) },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        const safeHint =
          response.status === 401 && this.environment === "production"
            ? " Hepsiburada development/SIT bilgileri kullaniliyorsa Railway'de HEPSIBURADA_ENV=sit ayarlayin."
            : "";
        const error = new Error(
          `Hepsiburada HTTP ${response.status}: ${body.slice(0, 500)}${safeHint}`,
        );
        error.status = response.status;
        throw error;
      }
      return body ? JSON.parse(body) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  async listOrders({ beginDate, endDate, offset = 0, limit = 100 } = {}) {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)),
    });
    if (beginDate) query.set("begindate", beginDate);
    if (endDate) query.set("enddate", endDate);
    return this.request(
      `${this.orderBaseUrl}/orders/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}?${query}`,
    );
  }

  async listListings({ offset = 0, limit = 100 } = {}) {
    const query = new URLSearchParams({
      offset: String(Math.max(Number(offset) || 0, 0)),
      limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)),
    });
    return this.request(
      `${this.listingBaseUrl}/listings/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}?${query}`,
    );
  }

  async getListingBySku(sku) {
    return this.request(
      `${this.listingBaseUrl}/listings/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}/sku/${encodeURIComponent(String(sku))}`,
    );
  }

  async updatePriceAndInventory({ sku, price, stock }) {
    if (!this.priceUpdatesEnabled())
      return {
        dryRun: true,
        code: "HEPSIBURADA_PRICE_UPDATES_DISABLED",
        message: "Hepsiburada fiyat güncelleme anahtarı kapalı",
      };
    const body = {};
    if (price != null) body.price = Number(price);
    if (stock != null) body.availableStock = Number(stock);
    return this.request(
      `${this.listingBaseUrl}/listings/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}/sku/${encodeURIComponent(String(sku))}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }

  async fetchAllListings({ pageSize = 100, maxPages = 200 } = {}) {
    const items = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const payload = await this.listListings({ offset, limit: pageSize });
      const rows = normalizeRows(payload);
      items.push(...rows);
      if (rows.length < pageSize) break;
      offset += rows.length;
    }
    return items;
  }

  async health() {
    if (!this.configured())
      return {
        configured: false,
        connected: false,
        message: "Hepsiburada merchant kimlik bilgileri eksik",
      };
    const result = await this.listListings({ offset: 0, limit: 1 });
    return {
      configured: true,
      connected: true,
      environment: this.environment,
      mutationsEnabled: this.mutationsEnabled(),
      priceUpdatesEnabled: this.priceUpdatesEnabled(),
      sampleCount: normalizeRows(result).length,
    };
  }
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return (
    payload.items ||
    payload.listings ||
    payload.content ||
    payload.data ||
    payload.results ||
    []
  );
}

module.exports = {
  HepsiburadaService,
  DEFAULT_ENDPOINTS,
  normalizedEnvironment,
  normalizeRows,
};
