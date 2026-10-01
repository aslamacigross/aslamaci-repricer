const { estimatePackageDesi } = require("../domain/supplier-products");
const logger = require("../config/logger");
const { publicCatalogRequest, catalogError } = require("./public-catalog-http");

const GRATIS_API_URL =
  "https://api.gratis.retter.io/1oakekr4e/CALL/Search/search/default";
const GRATIS_PAGE_SIZE = 100;
const GRATIS_REQUEST_INTERVAL_MS = 1000;
const GRATIS_FORBIDDEN_COOLDOWNS_MS = Object.freeze([15000, 30000]);
const GRATIS_TOP_LEVEL_CATEGORIES = Object.freeze([
  { id: "501", name: "Makyaj" },
  { id: "502", name: "Cilt Bakım" },
  { id: "503", name: "Saç Bakım" },
  { id: "504", name: "Parfüm & Deodorant" },
  { id: "505", name: "Erkek Bakım" },
  { id: "506", name: "Kişisel Bakım" },
  { id: "507", name: "Anne & Bebek" },
  { id: "508", name: "Ev & Yaşam" },
  { id: "509", name: "Moda & Aksesuar" },
  { id: "510", name: "Süpermarket" },
  { id: "511", name: "Elektrikli Ürünler" },
  { id: "514", name: "Duş & Banyo" },
  { id: "515", name: "Hijyen & Bakım" },
  { id: "516", name: "Güneş Ürünleri" },
]);

function minorPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Number((amount / 100).toFixed(2));
}

function gratisPrice(prices = {}) {
  const regularPrice = minorPrice(prices.normalPrice);
  const onlinePrice = minorPrice(prices.discountedPrice);
  const memberPrice = minorPrice(prices.promotionPrice);
  if (onlinePrice && (!regularPrice || onlinePrice <= regularPrice))
    return {
      currentPrice: onlinePrice,
      priceType:
        regularPrice && onlinePrice < regularPrice ? "ONLINE_SALE" : "REGULAR",
      regularPrice,
      memberPrice,
    };
  if (regularPrice)
    return {
      currentPrice: regularPrice,
      priceType: "REGULAR",
      regularPrice,
      memberPrice,
    };
  return { currentPrice: null, priceType: null, regularPrice, memberPrice };
}

function gratisAvailability(product) {
  if (product?.isActive === false) return "UNAVAILABLE";
  const status = String(product?.stockStatus || "").toUpperCase();
  if (["HIGH", "MEDIUM", "LOW", "AVAILABLE", "IN_STOCK"].includes(status))
    return "AVAILABLE";
  return "UNAVAILABLE";
}

function firstImage(product) {
  const image = product?.imageUrls?.[0];
  return String(image?.fileUrl || image?.url || "").trim() || null;
}

function productRow(product, { observedAt } = {}) {
  const productId = String(product?.id || "").trim();
  const attributes = product?.attributes || {};
  const productName = String(
    attributes.displayName || product?.name || "",
  ).trim();
  const selected = gratisPrice(product?.prices);
  if (!productId || !productName || !selected.currentPrice) return null;
  const categories = Array.isArray(attributes.categories)
    ? attributes.categories
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const category = categories.join(" > ");
  const desi = estimatePackageDesi(productName);
  return {
    source_key: `gratis-api:${productId}`,
    product_name: productName,
    current_price: selected.currentPrice,
    brand: String(attributes.brand || "").trim(),
    availability: gratisAvailability(product),
    observed_at: observedAt,
    source_url: String(product?.shareLink || "").trim() || null,
    source_category: category || null,
    estimated_unit_desi: desi.value,
    desi_confidence: desi.confidence,
    raw_data: {
      provider: "gratis-retter-search",
      product_id: productId,
      sku: productId,
      barcode: String(attributes.eanUpc || "").trim() || null,
      regular_price: selected.regularPrice,
      online_price: minorPrice(product?.prices?.discountedPrice),
      gratis_card_price: selected.memberPrice,
      effective_price: selected.currentPrice,
      effective_price_type: selected.priceType,
      promotion_label:
        String(product?.prices?.promotionLabel || "").trim() || null,
      promotion_condition:
        String(product?.prices?.discountedText || "").trim() || null,
      discount_rate: Number(product?.prices?.discountRate || 0),
      currency: product?.prices?.currency || "TRY",
      stock_status: product?.stockStatus || null,
      active: product?.isActive !== false,
      image_url: firstImage(product),
      categories,
      category_ids: attributes.categoryIds || [],
      variant_type: product?.variants?.type || null,
      variant_id: productId,
      variant_label:
        attributes.colorName ||
        attributes.assortmentVariant ||
        attributes.colorShadeVariant ||
        null,
      variants: product?.variants?.values || [],
      variant_count: product?.variantCount || null,
      order_limit: attributes.orderLimit ?? null,
      campaign_badges: product?.badges || [],
      desi_basis: desi.basis,
    },
  };
}

function searchPayload(categoryId, from, size) {
  return {
    query: {
      searchTerm: "",
      from,
      size,
      filters: [
        {
          filterId: "categories",
          filterValues: [String(categoryId)],
          excludedValues: [],
        },
      ],
      inStock: false,
      sortBy: [],
      filterActiveProducts: true,
      fromHomepageBestsellers: false,
      fromHomepageNewProducts: false,
    },
  };
}

class GratisMarketService {
  constructor({
    apiUrl = GRATIS_API_URL,
    categories = GRATIS_TOP_LEVEL_CATEGORIES,
    pageSize = GRATIS_PAGE_SIZE,
    fetchImpl = fetch,
    timeoutMs = 20000,
    maxAttempts = 3,
    maxPagesPerCategory = 250,
    requestIntervalMs = GRATIS_REQUEST_INTERVAL_MS,
    forbiddenCooldownsMs = GRATIS_FORBIDDEN_COOLDOWNS_MS,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    nowMs = () => Date.now(),
    now = () => new Date(),
    log = logger,
  } = {}) {
    this.apiUrl = apiUrl;
    this.categories = categories;
    this.pageSize = pageSize;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.maxPagesPerCategory = maxPagesPerCategory;
    this.requestIntervalMs = Math.min(
      Math.max(Number(requestIntervalMs) || 0, 0),
      10000,
    );
    this.forbiddenCooldownsMs = [...forbiddenCooldownsMs].map((value) =>
      Math.min(Math.max(Number(value) || 0, 0), 30000),
    );
    this.sleep = sleep;
    this.nowMs = nowMs;
    this.now = now;
    this.log = log;
    this.lastRequestStartedAt = null;
  }

  async waitForRequestSlot() {
    const current = this.nowMs();
    if (this.lastRequestStartedAt != null) {
      const remaining =
        this.requestIntervalMs - (current - this.lastRequestStartedAt);
      if (remaining > 0) await this.sleep(remaining);
    }
    this.lastRequestStartedAt = this.nowMs();
  }

  retryDelayPolicy({ response, attempt, defaultDelayMs }) {
    if (response?.status !== 403) return defaultDelayMs;
    const cooldown = this.forbiddenCooldownsMs[attempt - 1];
    return Math.max(defaultDelayMs, Number(cooldown) || 0);
  }

  async fetchPage(categoryId, from = 0) {
    const url = new URL(this.apiUrl);
    url.searchParams.set(
      "data",
      Buffer.from(
        JSON.stringify(searchPayload(categoryId, from, this.pageSize)),
      ).toString("base64"),
    );
    url.searchParams.set("__isbase64", "true");
    url.searchParams.set("__culture", "tr_TR");
    url.searchParams.set("__platform", "WEB");
    const result = await publicCatalogRequest({
      url,
      supplier: "GRATIS",
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts,
      sleep: this.sleep,
      responseType: "json",
      headers: { "client-version": "4.8.1" },
      additionalRetryStatuses: [403],
      beforeAttempt: () => this.waitForRequestSlot(),
      retryDelayPolicy: (context) => this.retryDelayPolicy(context),
    });
    if (!result.data || !Array.isArray(result.data.data))
      throw catalogError(
        "GRATIS katalog yanıtı beklenen ürün dizisini içermiyor",
        "GRATIS_SCHEMA_ERROR",
        {
          supplier: "GRATIS",
          failureStage: "schema",
          httpStatus: 200,
          retryCount: result.retries,
        },
      );
    const total = Number(result.data.itemCount);
    if (!Number.isInteger(total) || total < 0)
      throw catalogError(
        "GRATIS katalog yanıtında geçerli itemCount yok",
        "GRATIS_SCHEMA_ERROR",
        {
          supplier: "GRATIS",
          failureStage: "schema",
          httpStatus: 200,
          retryCount: result.retries,
        },
      );
    return { products: result.data.data, total, retries: result.retries };
  }

  async livePriceRows() {
    const started = Date.now();
    const observedAt = this.now().toISOString();
    const rows = new Map();
    const failedPages = [];
    const categories = [];
    let pagesFetched = 0;
    let productsObserved = 0;
    let retryCount = 0;
    let completeTraversal = true;
    let firstError = null;
    let circuitBreaker = null;
    this.lastRequestStartedAt = null;

    for (const category of this.categories) {
      const categorySeen = new Set();
      let expectedTotal = null;
      let expectedPages = null;
      let categoryComplete = true;
      for (let page = 0; page < this.maxPagesPerCategory; page++) {
        try {
          const result = await this.fetchPage(
            category.id,
            page * this.pageSize,
          );
          pagesFetched++;
          retryCount += result.retries;
          if (expectedTotal == null) {
            expectedTotal = result.total;
            expectedPages = Math.max(
              1,
              Math.ceil(result.total / this.pageSize),
            );
            if (expectedPages > this.maxPagesPerCategory) {
              categoryComplete = false;
              failedPages.push({
                categoryId: category.id,
                page: page + 1,
                code: "GRATIS_PAGINATION_LIMIT",
              });
              break;
            }
          } else if (result.total !== expectedTotal) {
            throw catalogError(
              "GRATIS katalog sayfaları arasında itemCount değişti",
              "GRATIS_PAGINATION_CHANGED",
              {
                supplier: "GRATIS",
                failureStage: "pagination",
                httpStatus: 200,
                retryCount: result.retries,
              },
            );
          }
          for (const product of result.products) {
            productsObserved++;
            const row = productRow(product, { observedAt });
            if (!row) continue;
            categorySeen.add(row.source_key);
            rows.set(row.source_key, row);
          }
          if (page + 1 >= expectedPages) break;
          if (!result.products.length) {
            categoryComplete = false;
            failedPages.push({
              categoryId: category.id,
              page: page + 1,
              code: "GRATIS_UNEXPECTED_EMPTY_PAGE",
            });
            break;
          }
        } catch (error) {
          firstError ||= error;
          categoryComplete = false;
          const diagnostics = error.jobDiagnostics || {};
          retryCount += Number(diagnostics.retryCount || 0);
          failedPages.push({
            categoryId: category.id,
            page: page + 1,
            code: error.code || "GRATIS_PAGE_FAILED",
            httpStatus: diagnostics.httpStatus ?? null,
            attempt: diagnostics.attempt ?? null,
            retryCount: diagnostics.retryCount ?? 0,
          });
          this.log.warn("gratis_sync_page_failed", {
            supplier: "GRATIS",
            categoryId: category.id,
            page: page + 1,
            httpStatus: diagnostics.httpStatus ?? null,
            attempt: diagnostics.attempt ?? null,
            retryCount: diagnostics.retryCount ?? 0,
            productsSuccessfullyScanned: rows.size,
          });
          if (
            diagnostics.httpStatus === 403 &&
            diagnostics.attempt === this.maxAttempts
          ) {
            circuitBreaker = {
              open: true,
              reason: "PERSISTENT_HTTP_403",
              categoryId: category.id,
              page: page + 1,
              attempts: diagnostics.attempt,
              remainingCategoriesSkipped:
                this.categories.length - categories.length - 1,
            };
            this.log.warn("gratis_sync_circuit_open", {
              supplier: "GRATIS",
              ...circuitBreaker,
            });
          }
          break;
        }
      }
      if (
        categoryComplete &&
        expectedTotal != null &&
        categorySeen.size !== expectedTotal
      ) {
        failedPages.push({
          categoryId: category.id,
          page: null,
          code: "GRATIS_ITEM_COUNT_MISMATCH",
          expected: expectedTotal,
          observed: categorySeen.size,
        });
        this.log.warn("gratis_sync_category_incomplete", {
          supplier: "GRATIS",
          categoryId: category.id,
          expected: expectedTotal,
          observed: categorySeen.size,
        });
      }
      if (expectedTotal == null || categorySeen.size !== expectedTotal)
        categoryComplete = false;
      categories.push({
        id: category.id,
        name: category.name,
        expected: expectedTotal,
        observed: categorySeen.size,
        complete: categoryComplete,
      });
      if (!categoryComplete) completeTraversal = false;
      if (circuitBreaker) break;
    }

    if (!rows.size) {
      const source = firstError?.jobDiagnostics || {};
      throw catalogError(
        firstError?.message || "GRATIS kataloğundan geçerli ürün alınamadı",
        "GRATIS_CATALOG_EMPTY",
        {
          ...source,
          supplier: "GRATIS",
          productsScanned: 0,
          pagesFetched,
          retryCount,
          fullSnapshotStarted: false,
          failedPages,
          circuitBreaker,
        },
      );
    }

    const result = {
      rows: [...rows.values()],
      fullSnapshot: completeTraversal,
      stats: {
        supplier: "GRATIS",
        pagesFetched,
        productsObserved,
        productsImported: rows.size,
        categories,
        failedPages,
        retryCount,
        completeTraversal,
        circuitBreaker,
        durationMs: Date.now() - started,
      },
    };
    this.log.info("gratis_sync_completed", result.stats);
    return result;
  }
}

module.exports = {
  GRATIS_API_URL,
  GRATIS_REQUEST_INTERVAL_MS,
  GRATIS_FORBIDDEN_COOLDOWNS_MS,
  GRATIS_TOP_LEVEL_CATEGORIES,
  GratisMarketService,
  minorPrice,
  gratisPrice,
  gratisAvailability,
  productRow,
};
