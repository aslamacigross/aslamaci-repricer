const { estimatePackageDesi } = require("../domain/supplier-products");
const logger = require("../config/logger");

const ROSSMANN_BASE_URL = "https://www.rossmann.com.tr";
const ROSSMANN_CATALOG_CATEGORY_ID = 2;
const ROSSMANN_PAGE_SIZE = 36;
const ROSSMANN_IMAGE_BASE_URL =
  "https://cdn.rossmann.com.tr/mnpadding/400/400/FFFFFF/media/catalog/product";

function parseRossmannPrice(value) {
  if (typeof value === "number") return value;
  const text = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/₺|TL|TRY/gi, "");
  if (!text) return NaN;
  const normalized = text.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  return Number(normalized);
}

function positivePrice(value) {
  const price = parseRossmannPrice(value);
  return Number.isFinite(price) && price > 0 ? Number(price.toFixed(2)) : null;
}

function absoluteUrl(value, baseUrl = ROSSMANN_BASE_URL) {
  try {
    return new URL(String(value || ""), baseUrl).toString();
  } catch {
    return null;
  }
}

function imageUrl(value) {
  const path = String(value || "").trim();
  if (!path) return null;
  return absoluteUrl(path, ROSSMANN_IMAGE_BASE_URL);
}

function parseBreadcrumb(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function categoryFromProduct(product) {
  const breadcrumb = parseBreadcrumb(product?.breadcrumb);
  return breadcrumb
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)
    .filter((name) => name !== product?.name)
    .join(" > ");
}

function conditionalPromotion(product) {
  const candidates = [
    { threshold: 100, price: positivePrice(product?.cmp_100_price) },
    { threshold: 50, price: positivePrice(product?.cmp_50_price) },
    { threshold: 20, price: positivePrice(product?.cmp_20_price) },
  ].filter((item) => item.price);
  if (!candidates.length) return null;
  const selected = candidates[0];
  return {
    price: selected.price,
    label: `${selected.threshold} TL üzeri alışverişe`,
    threshold: selected.threshold,
  };
}

function effectivePrice(product) {
  const regularPrice = positivePrice(product?.price);
  const specialPrice =
    positivePrice(product?.ross_60_price) ||
    positivePrice(product?.special_price);
  const cardPrice = positivePrice(product?.crm_price);
  if (cardPrice && regularPrice && cardPrice < regularPrice)
    return { price: cardPrice, type: "ROSSMANN_CARD" };
  if (specialPrice && (!regularPrice || specialPrice < regularPrice))
    return { price: specialPrice, type: "SALE" };
  if (regularPrice) return { price: regularPrice, type: "REGULAR" };
  return { price: null, type: null };
}

function productRow(product, { observedAt, baseUrl = ROSSMANN_BASE_URL } = {}) {
  const productId = String(product?.id || product?.entity_id || "").trim();
  const sku = String(product?.sku || "").trim();
  const productName = String(product?.name || "").trim();
  const selected = effectivePrice(product);
  if (!productId || !productName || !selected.price) return null;
  const regularPrice = positivePrice(product?.price);
  const cardPrice = positivePrice(product?.crm_price);
  const salePrice =
    positivePrice(product?.ross_60_price) ||
    positivePrice(product?.special_price);
  const promo = conditionalPromotion(product);
  const category = categoryFromProduct(product);
  const desi = estimatePackageDesi(productName);
  const url = absoluteUrl(product.url_key || "", baseUrl);
  return {
    source_key: `rossmann-api:${productId}`,
    product_name: productName,
    current_price: selected.price,
    brand: String(product?.brand || product?.branding || "").trim(),
    availability:
      Number(product?.is_in_stock ?? product?.quantity_and_stock_status) > 0
        ? "AVAILABLE"
        : "UNAVAILABLE",
    observed_at: observedAt,
    source_url: url,
    source_category: category || null,
    estimated_unit_desi: desi.value,
    desi_confidence: desi.confidence,
    raw_data: {
      provider: "rossmann-elastic",
      product_id: productId,
      sku: sku || null,
      barcode: product?.barcode || null,
      regular_price: regularPrice,
      rossmann_card_price: cardPrice,
      sale_price: salePrice,
      promotion_price: promo?.price || null,
      promotion_label: promo?.label || null,
      effective_price: selected.price,
      effective_price_type: selected.type,
      image_url: imageUrl(product?.image),
      category: category || null,
      stock_quantity: product?.qty ?? null,
      stock_status: product?.mnm_stock_status || null,
      url_key: product?.url_key || null,
      freight: product?.freight || null,
      paths_label: product?.paths_label || [],
      desi_basis: desi.basis,
    },
  };
}

function safeResponseSnippet(value, limit = 160) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /(authorization|api[-_ ]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function diagnosticError(message, code, diagnostics) {
  const error = new Error(message);
  error.code = code;
  error.jobDiagnostics = diagnostics;
  return error;
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        "user-agent": "AslamaciERP/2.0 supplier-price-sync",
      },
    });
    if (!response.ok) {
      let responseSnippet = "";
      try {
        if (typeof response.text === "function")
          responseSnippet = safeResponseSnippet(await response.text());
      } catch {
        // The status and stage still provide a safe diagnostic.
      }
      throw diagnosticError(
        `Rossmann katalog ${response.status}: ${response.statusText}`,
        "ROSSMANN_HTTP_ERROR",
        {
          failureStage: "http_response",
          httpStatus: response.status,
          statusText: safeResponseSnippet(response.statusText, 80) || null,
          responseSnippet: responseSnippet || null,
          durationMs: Date.now() - started,
          attempt: 1,
        },
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw diagnosticError(
        `Rossmann katalog yanıtı JSON olarak okunamadı: ${error.message}`,
        "ROSSMANN_RESPONSE_PARSE_ERROR",
        {
          failureStage: "parse_response",
          httpStatus: response.status,
          statusText: safeResponseSnippet(response.statusText, 80) || null,
          responseSnippet: null,
          durationMs: Date.now() - started,
          attempt: 1,
        },
      );
    }
  } catch (error) {
    if (error.jobDiagnostics) throw error;
    const timedOut = controller.signal.aborted;
    throw diagnosticError(
      timedOut
        ? "Rossmann katalog isteği zaman aşımına uğradı"
        : `Rossmann katalog isteği başarısız: ${error.message}`,
      timedOut ? "ROSSMANN_TIMEOUT" : "ROSSMANN_NETWORK_ERROR",
      {
        failureStage: timedOut ? "timeout" : "network",
        httpStatus: null,
        statusText: null,
        responseSnippet: null,
        durationMs: Date.now() - started,
        attempt: 1,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

class RossmannMarketService {
  constructor({
    baseUrl = ROSSMANN_BASE_URL,
    categoryId = ROSSMANN_CATALOG_CATEGORY_ID,
    pageSize = ROSSMANN_PAGE_SIZE,
    fetchImpl = fetch,
    timeoutMs = 20000,
    maxPages = 1000,
    log = logger,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.categoryId = categoryId;
    this.pageSize = pageSize;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxPages = maxPages;
    this.log = log;
  }

  async fetchPage(from = 0) {
    const url = new URL(`${this.baseUrl}/elastic.php`);
    url.searchParams.set("categoryId", String(this.categoryId));
    url.searchParams.set("order", "position");
    url.searchParams.set("direction", "asc");
    if (from > 0) {
      url.searchParams.set("from", String(from));
      url.searchParams.set("size", String(this.pageSize));
    } else {
      url.searchParams.set("product_list_limit", String(this.pageSize));
      url.searchParams.set("size", String(this.pageSize));
    }
    return fetchJson(url.toString(), {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  async livePriceRows() {
    const observedAt = new Date().toISOString();
    const rowsBySource = new Map();
    const failures = [];
    let total = null;
    let productsScanned = 0;
    let priceParseFailures = 0;
    let availabilityParseFailures = 0;
    let cardPriceProducts = 0;
    let nonCardPriceProducts = 0;
    let duplicates = 0;
    const started = Date.now();

    for (let page = 0; page < this.maxPages; page++) {
      const from = page * this.pageSize;
      let body;
      try {
        body = await this.fetchPage(from);
      } catch (error) {
        const failure = {
          page: page + 1,
          from,
          failureStage: error.jobDiagnostics?.failureStage || "fetch_page",
          httpStatus: error.jobDiagnostics?.httpStatus || null,
          statusText: error.jobDiagnostics?.statusText || null,
          responseSnippet: error.jobDiagnostics?.responseSnippet || null,
          attempt: error.jobDiagnostics?.attempt || 1,
          durationMs: error.jobDiagnostics?.durationMs || 0,
          error: error.message,
          productsSuccessfullyScanned: productsScanned,
          fullSnapshotStarted: productsScanned > 0,
        };
        failures.push(failure);
        this.log.warn("rossmann_sync_page_failed", {
          provider: "rossmann-elastic",
          ...failure,
        });
        break;
      }
      const hits = body?.product?.hits?.hits;
      if (!Array.isArray(hits)) {
        const failure = {
          page: page + 1,
          from,
          failureStage: "parse_response",
          httpStatus: null,
          statusText: null,
          responseSnippet: null,
          attempt: 1,
          durationMs: 0,
          error: "Rossmann katalog ürün listesi geçersiz",
          productsSuccessfullyScanned: productsScanned,
          fullSnapshotStarted: productsScanned > 0,
        };
        failures.push(failure);
        this.log.warn("rossmann_sync_page_failed", {
          provider: "rossmann-elastic",
          ...failure,
        });
        break;
      }
      total = Number(body?.product?.hits?.total?.value ?? total);
      if (!hits.length) break;
      for (const hit of hits) {
        productsScanned++;
        const row = productRow(hit?._source || hit, {
          observedAt,
          baseUrl: this.baseUrl,
        });
        if (!row) {
          priceParseFailures++;
          continue;
        }
        if (!row.availability) availabilityParseFailures++;
        if (row.raw_data.effective_price_type === "ROSSMANN_CARD")
          cardPriceProducts++;
        else nonCardPriceProducts++;
        if (rowsBySource.has(row.source_key)) duplicates++;
        rowsBySource.set(row.source_key, row);
      }
      if (Number.isFinite(total) && rowsBySource.size >= total) break;
      if (hits.length < this.pageSize) break;
    }

    const rows = [...rowsBySource.values()];
    const fullSnapshot =
      failures.length === 0 &&
      Number.isFinite(total) &&
      rows.length > 0 &&
      rows.length >= total;
    if (!rows.length) {
      const firstFailure = failures[0] || {
        failureStage: "empty_catalog",
        httpStatus: null,
        page: 1,
        from: 0,
        attempt: 1,
        responseSnippet: null,
      };
      throw diagnosticError(
        `Rossmann canlı katalog boş döndü: ${failures
          .map((failure) => failure.error)
          .join("; ")}`,
        "ROSSMANN_CATALOG_EMPTY",
        {
          provider: "rossmann-elastic",
          failureStage: firstFailure.failureStage,
          httpStatus: firstFailure.httpStatus,
          statusText: firstFailure.statusText || null,
          page: firstFailure.page,
          from: firstFailure.from,
          attempt: firstFailure.attempt,
          durationMs: Date.now() - started,
          productsScanned,
          fullSnapshotStarted: productsScanned > 0,
          responseSnippet: firstFailure.responseSnippet,
        },
      );
    }
    return {
      rows,
      fullSnapshot,
      stats: {
        provider: "rossmann-elastic",
        endpoint: `${this.baseUrl}/elastic.php`,
        categoryId: this.categoryId,
        pageSize: this.pageSize,
        totalProducts: total,
        pagesScanned: Math.ceil(productsScanned / this.pageSize),
        productsScanned,
        targetProducts: rows.length,
        duplicates,
        cardPriceProducts,
        nonCardPriceProducts,
        priceParseFailures,
        availabilityParseFailures,
        failedPages: failures,
        fullSnapshot,
        elapsedMs: Date.now() - started,
      },
    };
  }
}

module.exports = {
  ROSSMANN_BASE_URL,
  ROSSMANN_CATALOG_CATEGORY_ID,
  ROSSMANN_PAGE_SIZE,
  RossmannMarketService,
  parseRossmannPrice,
  effectivePrice,
  productRow,
};
