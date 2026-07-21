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
        const error = new Error(
          `Hepsiburada HTTP ${response.status}: ${body.slice(0, 500)}`,
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

  async health() {
    if (!this.configured())
      return {
        configured: false,
        connected: false,
        message: "Hepsiburada merchant kimlik bilgileri eksik",
      };
    const result = await this.listOrders({ offset: 0, limit: 1 });
    return {
      configured: true,
      connected: true,
      environment: this.environment,
      mutationsEnabled: this.mutationsEnabled(),
      sampleCount: Array.isArray(result) ? result.length : null,
    };
  }
}

module.exports = {
  HepsiburadaService,
  DEFAULT_ENDPOINTS,
  normalizedEnvironment,
};
