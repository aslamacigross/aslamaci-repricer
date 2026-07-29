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
  packageStatus:
    "https://developers.hepsiburada.com/tr/companies/hepsiburada?category=siparis-yonetimi&product=siparis-olusturma-entegrasyonu&version=v1.0&op=Post__packages_merchantid_merchantId_packagenumber_packagenumber_intransit&view=endpoint",
});

function normalizedEnvironment(value = env.hepsiburadaEnv) {
  return ["sit", "test"].includes(String(value).toLowerCase())
    ? "sit"
    : "production";
}

function safeResponseSummary(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const text = JSON.stringify(payload);
  return JSON.parse(
    text.replace(
      /("?(authorization|password|secret|secretKey|token|apiKey)"?\s*:\s*)"[^"]*"/gi,
      '$1"[hidden]"',
    ),
  );
}

function responseId(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.id ||
    payload.batchId ||
    payload.trackingId ||
    payload.traceId ||
    payload.importId ||
    payload.data?.id ||
    payload.data?.batchId ||
    payload.data?.trackingId ||
    payload.data?.traceId ||
    payload[0]?.id ||
    null
  );
}

function listingDeactivationSummary(listings) {
  const summary = {};
  for (const listing of normalizeRows(listings)) {
    const reasons = listing.deactivationReasons?.length
      ? listing.deactivationReasons
      : listing.isSalable === true
        ? ["SALABLE"]
        : ["UNKNOWN"];
    for (const reason of reasons) {
      summary[reason] = (summary[reason] || 0) + 1;
    }
  }
  return summary;
}

function packageNumberFromPayload(payload) {
  for (const row of normalizeRows(payload)) {
    const packageNumber =
      row.packageNumber ||
      row.packagenumber ||
      row.package_number ||
      row.PackageNumber ||
      row.package?.packageNumber;
    if (packageNumber) return String(packageNumber);
  }
  return null;
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
        code: "bulk-listing",
        title: "Toplu satışa açma testi",
        status: baseStatus === "READY" ? "DRY_RUN_READY" : "BLOCKED",
        kind: "SIT_MUTATION_PREVIEW",
        guide: SIT_TEST_GUIDES.listing,
        description:
          "SIT ortamındaki mevcut listingleri topluca fiyat/stok ile satışa hazır hale getirir.",
        nextAction:
          "Hepsiburada kontrolünde ürünlerin satışa açılmış görünmesi için çalıştırılır.",
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
        code: "package-status",
        title: "Paket statü ilerletme testi",
        status: baseStatus,
        kind: "SIT_MUTATION",
        guide: SIT_TEST_GUIDES.packageStatus,
        description:
          "89100 kargo firmasıyla oluşan SIT paketini kargoda, teslim edildi veya teslim edilemedi statülerine taşır.",
        nextAction:
          "Önce sipariş testiyle paket oluşur; sonra bu adım paket statülerini ilerletir.",
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
      "bulk-listing": {
        mode: "sit-bulk",
        request: {
          method: "POST",
          target: "bulk-listing-price-stock-test",
          environment: this.environment,
          payload: {
            scope: "all-sit-listings",
            price: 1000,
            availableStock: 20000,
          },
        },
      },
      order: {
        mode: "read-only",
        request: {
          method: "GET",
          target: "orders-created-in-sit-portal",
          environment: this.environment,
          query: { limit: 100, offset: 0, cargoCompanyId: 89100 },
        },
      },
      "package-status": {
        mode: "sit-status-progression",
        request: {
          method: "POST",
          target: "package-status-progression-test",
          environment: this.environment,
          required: {
            cargoCompanyId: 89100,
            packageNumber: "Panelde bos birakilirsa ilk SIT paketi kullanilir",
          },
          supportedActions: [
            "deliver_flow",
            "undeliver_flow",
            "intransit",
            "deliver",
            "undeliver",
          ],
          endpoints: [
            `${this.orderBaseUrl}/packages/merchantid/{merchantId}/packagenumber/{packageNumber}/intransit`,
            `${this.orderBaseUrl}/packages/merchantid/{merchantId}/packagenumber/{packageNumber}/deliver`,
            `${this.orderBaseUrl}/packages/merchantid/{merchantId}/packagenumber/{packageNumber}/undeliver`,
          ],
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

  async listPackages({ offset = 0, limit = 100 } = {}) {
    const query = new URLSearchParams({
      limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)),
      offset: String(Math.max(Number(offset) || 0, 0)),
    });
    return this.request(
      `${this.orderBaseUrl}/packages/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}?${query}`,
    );
  }

  async progressPackageStatus(packageNumber, status) {
    const normalizedStatus = String(status || "").toLowerCase();
    if (!["intransit", "deliver", "undeliver"].includes(normalizedStatus)) {
      const error = new Error("Desteklenmeyen Hepsiburada paket statü adımı");
      error.status = 400;
      throw error;
    }
    return this.request(
      `${this.orderBaseUrl}/packages/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}/packagenumber/${encodeURIComponent(
        String(packageNumber),
      )}/${normalizedStatus}`,
      { method: "POST" },
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

  async listListingsFiltered({
    offset = 0,
    limit = 100,
    merchantSkuList,
    hbSkuList,
    productId,
  } = {}) {
    const query = new URLSearchParams({
      offset: String(Math.max(Number(offset) || 0, 0)),
      limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)),
    });
    if (merchantSkuList) query.set("merchantSkuList", merchantSkuList);
    if (hbSkuList) query.set("hbSkuList", hbSkuList);
    if (productId) query.set("productId", productId);
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

  assertSitTestAllowed() {
    if (this.environment !== "sit") {
      const error = new Error(
        "Hepsiburada SIT testi yalnizca SIT ortaminda calisir",
      );
      error.status = 409;
      error.code = "HEPSIBURADA_ENV_SIT_REQUIRED";
      throw error;
    }
    if (!this.configured() || !env.hepsiburadaUserAgent) {
      const error = new Error("Hepsiburada SIT credential/User-Agent eksik");
      error.status = 409;
      error.code = "HEPSIBURADA_SIT_CREDENTIALS_MISSING";
      throw error;
    }
  }

  async postListingUpload(kind, rows) {
    const path =
      kind === "price"
        ? "price-uploads"
        : kind === "stock"
          ? "stock-uploads"
          : "inventory-uploads";
    return this.request(
      `${this.listingBaseUrl}/listings/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}/${path}`,
      { method: "POST", body: JSON.stringify(rows) },
    );
  }

  async getListingUploadStatus(kind, id) {
    const path =
      kind === "price"
        ? "price-uploads"
        : kind === "stock"
          ? "stock-uploads"
          : "inventory-uploads";
    return this.request(
      `${this.listingBaseUrl}/listings/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}/${path}/id/${encodeURIComponent(String(id))}`,
    );
  }

  async waitListingUploadStatus(
    kind,
    id,
    { attempts = 12, delayMs = 3000 } = {},
  ) {
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      last = await this.getListingUploadStatus(kind, id);
      const status = String(last?.status || "").toUpperCase();
      if (["DONE", "COMPLETED", "FAILED", "ERROR"].includes(status)) break;
      if (attempt < attempts - 1)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return last;
  }

  listingUploadRows(listings, { price, stock }) {
    return normalizeRows(listings)
      .map((listing) => ({
        merchantSku: String(listing.merchantSku || listing.sku || "").trim(),
        hepsiburadaSku: String(
          listing.hepsiburadaSku || listing.hbSku || "",
        ).trim(),
        price: Number(price || listing.price || 1000),
        availableStock: Number(stock || listing.availableStock || 20),
      }))
      .filter((row) => row.merchantSku && row.hepsiburadaSku);
  }

  async fastListingProduct({
    merchantSku,
    barcode,
    hbSku,
    productName,
    price,
    stock,
  }) {
    const body = [
      {
        merchant: env.hepsiburadaMerchantId,
        merchantSku: String(merchantSku || ""),
        productName: String(productName || "Aşlamacı ERP SIT Test Ürünü"),
        barcode: String(barcode || ""),
        hbSku: String(hbSku || ""),
        stock: String(stock ?? 1),
        price: String(price ?? 99.9).replace(".", ","),
        itemOrderID: 1,
      },
    ];
    return this.request(`${this.productBaseUrl}/products/fastlisting`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getProductStatusByTrackingId(trackingId) {
    return this.request(
      `${this.productBaseUrl}/products/status/${encodeURIComponent(
        String(trackingId),
      )}?version=1&page=0&size=1000`,
    );
  }

  async createSitOrder({ listing, cargoCompanyId = 89100 } = {}) {
    const merchantSku = String(listing?.merchantSku || listing?.sku || "");
    const hbSku = String(listing?.hbSku || listing?.hepsiburadaSku || "");
    const listingId = String(
      listing?.listingId || listing?.id || listing?.productId || hbSku,
    );
    const amount = Number(listing?.price || listing?.salePrice || 99.9) || 99.9;
    const body = {
      Customer: { CustomerId: "aslamaci-erp-sit-customer" },
      DeliveryAddress: { AddressId: "aslamaci-erp-sit-address" },
      LineItems: [
        {
          CargoCompanyId: Number(cargoCompanyId) || 89100,
          DeliveryOptionId: 1,
          ListingId: listingId,
          MerchantId: env.hepsiburadaMerchantId,
          MerchantSku: merchantSku,
          Quantity: 1,
          Price: { Amount: amount, Currency: "TRY" },
          Sku: hbSku || merchantSku,
          TotalPrice: { Amount: amount, Currency: "TRY" },
        },
      ],
      OrderDate: new Date().toISOString(),
      OrderNumber: String(Date.now()),
      PaymentStatus: "Completed",
    };
    return this.request(
      `https://oms-stub-external-sit.hepsiburada.com/orders/merchantId/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async sitTestRun(step, input = {}) {
    this.assertSitTestAllowed();
    const normalizedStep = String(step || "").toLowerCase();
    const merchantSku = String(input.merchantSku || "").trim();
    const hbSku = String(input.hbSku || input.hepsiburadaSku || "").trim();
    const productName = String(
      input.productName || "Aşlamacı ERP SIT Test Ürünü",
    ).trim();
    const price = Number(input.price || 1000);
    const stock = Number(input.stock || 20000);
    const result = {
      step: normalizedStep,
      environment: this.environment,
      ok: false,
      checklist: [],
      responses: [],
    };
    const add = (title, payload) => {
      result.checklist.push({ title, ok: true });
      result.responses.push({ title, response: safeResponseSummary(payload) });
      return payload;
    };
    if (normalizedStep === "connection") {
      add(
        "Listing bilgilerini sorgulama",
        await this.listListings({ limit: 1 }),
      );
      result.ok = true;
      return result;
    }
    if (normalizedStep === "listing") {
      if (!merchantSku) {
        const error = new Error("Listeleme testi icin merchantSku gerekli");
        error.status = 400;
        throw error;
      }
      add(
        "Listing bilgilerini merchantSku ile sorgulama",
        await this.listListingsFiltered({
          merchantSkuList: merchantSku,
          limit: 10,
        }),
      );
      const verifiedListing = normalizeRows(result.responses[0]?.response)[0];
      const stockResponse = add(
        "Listing stok guncelleme",
        await this.postListingUpload("stock", [
          { merchantSku, hepsiburadaSku: hbSku, availableStock: stock },
        ]),
      );
      const stockId = responseId(stockResponse);
      if (stockId)
        add(
          "Listing stok guncelleme sorgulama",
          await this.getListingUploadStatus("stock", stockId),
        );
      const priceResponse = add(
        "Listing fiyat guncelleme",
        await this.postListingUpload("price", [
          { merchantSku, hepsiburadaSku: hbSku, price },
        ]),
      );
      const priceId = responseId(priceResponse);
      if (priceId)
        add(
          "Listing fiyat guncelleme sorgulama",
          await this.getListingUploadStatus("price", priceId),
        );
      result.checklist.push({
        title: "Listing activate / satilabilirlik dogrulama",
        ok: verifiedListing?.isSalable === true,
        message:
          verifiedListing?.isSalable === true
            ? "Listing API cevabinda isSalable=true donuyor."
            : "Listing aktif degil; Hepsiburada Listing Activate referans linki 404 dondugu icin bu adim manuel/API dokuman netlestirmesi gerektirir.",
      });
      result.ok = true;
      return result;
    }
    if (normalizedStep === "bulk-listing") {
      const allListings = await this.listListings({ limit: 100 });
      add("Tum SIT listinglerini sorgulama", allListings);
      const rows = this.listingUploadRows(allListings, { price, stock });
      if (!rows.length) {
        const error = new Error(
          "Toplu satisa acma icin uygun listing bulunamadi",
        );
        error.status = 409;
        throw error;
      }
      const stockResponse = add(
        "Toplu stok guncelleme",
        await this.postListingUpload(
          "stock",
          rows.map(({ merchantSku, hepsiburadaSku, availableStock }) => ({
            merchantSku,
            hepsiburadaSku,
            availableStock,
          })),
        ),
      );
      const stockId = responseId(stockResponse);
      if (stockId)
        add(
          "Toplu stok guncelleme sonucu",
          await this.waitListingUploadStatus("stock", stockId, {
            attempts: 20,
            delayMs: 3000,
          }),
        );
      const priceResponse = add(
        "Toplu fiyat guncelleme",
        await this.postListingUpload(
          "price",
          rows.map(({ merchantSku, hepsiburadaSku, price }) => ({
            merchantSku,
            hepsiburadaSku,
            price,
          })),
        ),
      );
      const priceId = responseId(priceResponse);
      if (priceId)
        add(
          "Toplu fiyat guncelleme sonucu",
          await this.waitListingUploadStatus("price", priceId, {
            attempts: 20,
            delayMs: 3000,
          }),
        );
      const verified = await this.listListings({ limit: 100 });
      add("Toplu satisa acma sonrasi listing dogrulama", verified);
      const verifiedRows = normalizeRows(verified);
      const salable = verifiedRows.filter((item) => item.isSalable === true);
      const deactivationSummary = listingDeactivationSummary(verifiedRows);
      result.checklist.push({
        title: "Satis acik urun sayisi",
        ok: verifiedRows.length > 0 && salable.length === verifiedRows.length,
        message: `${salable.length}/${verifiedRows.length} listing isSalable=true`,
      });
      result.checklist.push({
        title: "Satis kapali neden ozeti",
        ok: salable.length === verifiedRows.length,
        message: JSON.stringify(deactivationSummary),
      });
      result.ok =
        verifiedRows.length > 0 && salable.length === verifiedRows.length;
      return result;
    }
    if (normalizedStep === "catalog") {
      const sku = merchantSku || `ASL-SIT-${Date.now()}`;
      const response = add(
        "Hizli urun yukleme",
        await this.fastListingProduct({
          merchantSku: sku,
          barcode: input.barcode || sku,
          hbSku,
          productName,
          price,
          stock: Math.max(stock, 1),
        }),
      );
      const trackingId = responseId(response);
      if (trackingId)
        add(
          "Urun durumu sorgulama",
          await this.getProductStatusByTrackingId(trackingId),
        );
      result.ok = true;
      return result;
    }
    if (normalizedStep === "order") {
      const listingPayload = merchantSku
        ? await this.listListingsFiltered({
            merchantSkuList: merchantSku,
            limit: 1,
          })
        : await this.listListings({ limit: 1 });
      const listing = normalizeRows(listingPayload)[0];
      add("Siparis icin listing sorgulama", listingPayload);
      if (!listing) {
        const error = new Error(
          "Siparis testi icin kullanilabilir listing bulunamadi",
        );
        error.status = 409;
        throw error;
      }
      add(
        "Test siparisi olusturma",
        await this.createSitOrder({ listing, cargoCompanyId: 89100 }),
      );
      add(
        "Saticiya ait paket bilgilerini listeleme",
        await this.listPackages({ limit: 100, offset: 0 }),
      );
      result.ok = true;
      return result;
    }
    if (normalizedStep === "package-status") {
      const packagePayload = add(
        "Saticiya ait paket bilgilerini listeleme",
        await this.listPackages({ limit: 100, offset: 0 }),
      );
      const packageNumber =
        String(input.packageNumber || "").trim() ||
        packageNumberFromPayload(packagePayload);
      if (!packageNumber) {
        const error = new Error(
          "Paket statu testi icin paket numarasi bulunamadi",
        );
        error.status = 409;
        throw error;
      }
      const packageAction = String(input.packageAction || "deliver_flow")
        .trim()
        .toLowerCase();
      const actions =
        packageAction === "deliver_flow"
          ? ["intransit", "deliver"]
          : packageAction === "undeliver_flow"
            ? ["intransit", "undeliver"]
            : [packageAction];
      for (const action of actions) {
        add(
          `Paket statu: ${action}`,
          await this.progressPackageStatus(packageNumber, action),
        );
      }
      result.ok = true;
      return result;
    }
    if (normalizedStep === "webhook") {
      result.ok = true;
      result.checklist.push({
        title: "Webhook endpoint hazir",
        ok: true,
        message:
          "BaseURL Hepsiburada'ya iletilmeli; resmi dokuman test tanimini Hepsiburada tarafinda yapacaklarini belirtiyor.",
      });
      return result;
    }
    const error = new Error("Bilinmeyen Hepsiburada SIT test adimi");
    error.status = 404;
    throw error;
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
    payload.packages ||
    []
  );
}

module.exports = {
  HepsiburadaService,
  DEFAULT_ENDPOINTS,
  SIT_TEST_GUIDES,
  normalizedEnvironment,
  normalizeRows,
  listingDeactivationSummary,
  packageNumberFromPayload,
};
