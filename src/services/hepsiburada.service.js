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

const SIT_TEST_GUIDES = Object.freeze({
  catalog:
    "https://developers.hepsiburada.com/tr/companies/hepsiburada?category=katalog-urun-entegrasyonu&product=katalog-urun-entegrasyonu&version=v1.0&guide=katalog-urun-entegrasyonu-test-sureci-adimlari&view=guide",
  listing:
    "https://developers.hepsiburada.com/tr/companies/hepsiburada?category=listeleme&product=listeleme&version=v1&guide=listeleme-entegrasyonu-test-sureci-adimlari&view=guide",
  order:
    "https://developers.hepsiburada.com/tr/companies/hepsiburada?category=siparis-yonetimi&product=siparis-olusturma-entegrasyonu&version=v1.0&guide=siparis-entegrasyonu-test-sureci-adimlari&view=guide",
  webhook:
    "https://developers.hepsiburada.com/tr/companies/hepsiburada?category=siparis-yonetimi&product=siparis-olusturma-entegrasyonu&version=v1.0&guide=siparis-webhook-modeli&view=guide",
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

  sitTestReady() {
    return (
      this.environment === "sit" &&
      this.configured() &&
      Boolean(env.hepsiburadaUserAgent)
    );
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

  sitTestCenter({ publicBaseUrl = "" } = {}) {
    const safety = {
      environment: this.environment,
      configured: this.configured(),
      userAgentConfigured: Boolean(env.hepsiburadaUserAgent),
      sitOnly: this.environment === "sit",
      mutationsLocked: !this.mutationsEnabled(),
      priceUpdatesLocked: !this.priceUpdatesEnabled(),
      publicWebhookUrl: publicBaseUrl
        ? `${String(publicBaseUrl).replace(/\/+$/, "")}/api/public/hepsiburada/webhook`
        : null,
    };
    const blockedReasons = [
      !safety.sitOnly && "HEPSIBURADA_ENV_SIT_REQUIRED",
      !safety.configured && "HEPSIBURADA_CREDENTIALS_MISSING",
      !safety.userAgentConfigured && "HEPSIBURADA_USER_AGENT_MISSING",
      !safety.mutationsLocked && "HEPSIBURADA_MUTATIONS_MUST_STAY_LOCKED",
      !safety.priceUpdatesLocked &&
        "HEPSIBURADA_PRICE_UPDATES_MUST_STAY_LOCKED",
    ].filter(Boolean);
    const baseStatus = blockedReasons.length ? "BLOCKED" : "READY";
    const steps = [
      {
        code: "connection",
        title: "Bağlantı testi",
        status: baseStatus,
        kind: "READ_ONLY",
        guide: SIT_TEST_GUIDES.listing,
        description:
          "Basic Auth ve User-Agent ile SIT bağlantısının doğrulanması.",
        nextAction:
          baseStatus === "READY"
            ? "Panelde mevcut bağlantı testi çalıştırılabilir."
            : "Önce güvenlik/credential eksikleri tamamlanmalı.",
      },
      {
        code: "catalog",
        title: "Katalog ürün testi",
        status: baseStatus === "READY" ? "DRY_RUN_READY" : "BLOCKED",
        kind: "SIT_MUTATION_PREVIEW",
        guide: SIT_TEST_GUIDES.catalog,
        description:
          "Hepsiburada test kataloğuna gönderilecek örnek ürün paketi hazırlanır; otomatik gönderim kapalıdır.",
        nextAction:
          "Önce test payload'u incelenir, ardından açık onayla SIT çağrısı eklenir.",
      },
      {
        code: "listing",
        title: "Listeleme / fiyat-stok testi",
        status: baseStatus === "READY" ? "DRY_RUN_READY" : "BLOCKED",
        kind: "SIT_MUTATION_PREVIEW",
        guide: SIT_TEST_GUIDES.listing,
        description:
          "SIT katalog ürününe teklif/fiyat/stok paketi hazırlanır; gerçek gönderim kapalıdır.",
        nextAction:
          "Hepsiburada'nın istediği test SKU/katalog bilgisi doğrulanınca SIT çağrısı bağlanır.",
      },
      {
        code: "order",
        title: "Sipariş okuma testi",
        status: baseStatus,
        kind: "READ_ONLY",
        guide: SIT_TEST_GUIDES.order,
        description:
          "SIT portalda oluşturulan test siparişinin sistem tarafından okunması.",
        nextAction:
          "SIT portalda test sipariş oluşturulduktan sonra sipariş senkronu çalıştırılır.",
      },
      {
        code: "webhook",
        title: "Sipariş webhook testi",
        status: safety.publicWebhookUrl
          ? baseStatus === "READY"
            ? "DRY_RUN_READY"
            : "BLOCKED"
          : "WEBHOOK_URL_REQUIRED",
        kind: "PUBLIC_CALLBACK_PREVIEW",
        guide: SIT_TEST_GUIDES.webhook,
        description:
          "Hepsiburada'nın sipariş durum bildirimini göndereceği callback adresi hazırlanır.",
        nextAction: safety.publicWebhookUrl
          ? "Callback URL Hepsiburada SIT webhook ayarına girilebilir."
          : "Preview public URL bilgisi sisteme verilmeli.",
      },
    ];
    return { safety, blockedReasons, steps };
  }

  sitTestPreview(step, { publicBaseUrl = "" } = {}) {
    const normalizedStep = String(step || "").toLowerCase();
    const center = this.sitTestCenter({ publicBaseUrl });
    const selected = center.steps.find((item) => item.code === normalizedStep);
    if (!selected) {
      const error = new Error("Bilinmeyen Hepsiburada SIT test adımı");
      error.status = 404;
      throw error;
    }
    if (selected.status === "BLOCKED") {
      const error = new Error("Hepsiburada SIT test güvenlik koşulları eksik");
      error.status = 409;
      error.details = center.blockedReasons;
      throw error;
    }
    const previews = {
      connection: {
        mode: "read-only",
        request: {
          method: "GET",
          target: "listing-health-sample",
          environment: this.environment,
        },
      },
      catalog: {
        mode: "dry-run",
        request: {
          method: "POST",
          target: "catalog-product-test",
          environment: this.environment,
          payload: {
            merchant: "configured",
            products: [
              {
                merchantSku: "ASL-SIT-KATALOG-TEST-001",
                barcode: "ASL-SIT-KATALOG-TEST-001",
                title: "Aşlamacı ERP SIT Katalog Test Ürünü",
                brand: "Aşlamacı Test",
                category: "SIT test kategorisi dokümana göre doldurulacak",
                price: 99.9,
                stock: 1,
                images: [],
              },
            ],
          },
        },
      },
      listing: {
        mode: "dry-run",
        request: {
          method: "POST_OR_PUT",
          target: "listing-price-stock-test",
          environment: this.environment,
          payload: {
            merchantSku: "ASL-SIT-LISTING-TEST-001",
            price: 99.9,
            availableStock: 1,
            cargoCompany: "hepsiJET",
          },
        },
      },
      order: {
        mode: "read-only",
        request: {
          method: "GET",
          target: "orders-created-in-sit-portal",
          environment: this.environment,
          query: { limit: 100, offset: 0 },
        },
      },
      webhook: {
        mode: "callback-preview",
        request: {
          method: "POST",
          target: center.safety.publicWebhookUrl,
          environment: this.environment,
          expectedPayload: {
            eventType: "ORDER_STATUS_UPDATED",
            orderNumber: "SIT_TEST_ORDER_NUMBER",
            packageNumber: "SIT_TEST_PACKAGE_NUMBER",
          },
        },
      },
    };
    return {
      step: selected,
      safety: center.safety,
      preview: previews[normalizedStep],
      sendsRequest: false,
      message:
        "Bu önizleme Hepsiburada'ya istek göndermez; gerçek SIT çağrısı ayrı onay ister.",
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
  SIT_TEST_GUIDES,
  normalizedEnvironment,
  normalizeRows,
};
