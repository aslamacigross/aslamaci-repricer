const { estimatePackageDesi } = require("../domain/supplier-products");
const logger = require("../config/logger");
const {
  publicCatalogRequest,
  catalogError,
} = require("./public-catalog-http");

const WATSONS_CATALOG_URL =
  "https://www.watsons.com.tr/tum-urunler/c/50110";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function positivePrice(value) {
  const price = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(price) && price > 0 ? Number(price.toFixed(2)) : null;
}

function stableProductId(url) {
  const match = decodeHtml(url).match(/\/p\/(BP_[A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function cleanProductName(value, brand) {
  let name = decodeHtml(value);
  const normalizedBrand = decodeHtml(brand);
  if (!normalizedBrand) return name;
  const escaped = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repeated = new RegExp(`^(?:${escaped}\\s+){2,}`, "i");
  if (repeated.test(name)) name = name.replace(repeated, `${normalizedBrand} `);
  return name.trim();
}

function availabilityFromOffer(offer) {
  const value = String(offer?.availability || "").toLowerCase();
  return value.endsWith("/instock") ? "AVAILABLE" : "UNAVAILABLE";
}

function productRow(item, { observedAt, category } = {}) {
  const product = item?.item || item;
  const offer = Array.isArray(product?.offers)
    ? product.offers[0]
    : product?.offers || {};
  const productId = stableProductId(product?.url);
  const brand = decodeHtml(product?.brand?.name || product?.brand || "");
  const productName = cleanProductName(product?.name, brand);
  const currentPrice = positivePrice(offer.price ?? offer.lowPrice);
  if (!productId || !productName || !currentPrice) return null;
  const desi = estimatePackageDesi(productName);
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  return {
    source_key: `watsons-web:${productId}`,
    product_name: productName,
    current_price: currentPrice,
    brand,
    availability: availabilityFromOffer(offer),
    observed_at: observedAt,
    source_url: decodeHtml(product.url) || null,
    source_category: category || null,
    estimated_unit_desi: desi.value,
    desi_confidence: desi.confidence,
    raw_data: {
      provider: "watsons-jsonld",
      product_id: productId,
      sku: productId,
      barcode: null,
      regular_price: currentPrice,
      list_price: null,
      watsons_club_price: null,
      effective_price: currentPrice,
      effective_price_type: "PUBLIC_OFFER",
      currency: offer.priceCurrency || "TRY",
      availability: offer.availability || null,
      image_url: decodeHtml(image) || null,
      category: category || null,
      description: decodeHtml(product.description) || null,
      variant_id: productId,
      variant_label: null,
      conditional_promotions: [],
      desi_basis: desi.basis,
    },
  };
}

function jsonLdText(html) {
  const scripts = String(html || "").match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  const script =
    scripts.find((value) => /\bid=["']json-ld["']/i.test(value)) ||
    scripts.find((value) =>
      /\btype=["']application\/ld\+json["']/i.test(value),
    );
  if (!script) return null;
  const match = script.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  return match?.[1]?.trim() || null;
}

function parseTotal(html) {
  const match = decodeHtml(html).match(/([\d.]+)\s*ürün bulundu/i);
  if (!match) return null;
  const total = Number(match[1].replace(/\./g, ""));
  return Number.isInteger(total) && total >= 0 ? total : null;
}

function parseLastPage(html) {
  const pages = [...String(html || "").matchAll(/[?&]currentPage=(\d+)/gi)].map(
    (match) => Number(match[1]),
  );
  return pages.length ? Math.max(...pages) : 0;
}

function parseWatsonsPage(html, { observedAt } = {}) {
  const text = jsonLdText(html);
  if (!text)
    throw catalogError(
      "WATSONS sayfasında JSON-LD katalog verisi bulunamadı",
      "WATSONS_SCHEMA_ERROR",
      {
        supplier: "WATSONS",
        failureStage: "schema",
        httpStatus: 200,
      },
    );
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw catalogError(
      `WATSONS JSON-LD verisi okunamadı: ${error.message}`,
      "WATSONS_RESPONSE_PARSE_ERROR",
      {
        supplier: "WATSONS",
        failureStage: "parse_response",
        httpStatus: 200,
      },
    );
  }
  const graph = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.["@graph"])
      ? payload["@graph"]
      : [payload];
  const collection = graph.find((node) => node?.["@type"] === "CollectionPage");
  const itemList = graph.find((node) => node?.["@type"] === "ItemList");
  if (!itemList || !Array.isArray(itemList.itemListElement))
    throw catalogError(
      "WATSONS JSON-LD verisi ürün listesi içermiyor",
      "WATSONS_SCHEMA_ERROR",
      {
        supplier: "WATSONS",
        failureStage: "schema",
        httpStatus: 200,
      },
    );
  const category = decodeHtml(collection?.name) || "Tüm Ürünler";
  const rows = itemList.itemListElement
    .map((item) => productRow(item, { observedAt, category }))
    .filter(Boolean);
  return {
    rows,
    listedProducts: itemList.itemListElement.length,
    total: parseTotal(html),
    lastPage: parseLastPage(html),
    category,
  };
}

class WatsonsMarketService {
  constructor({
    catalogUrl = WATSONS_CATALOG_URL,
    fetchImpl = fetch,
    timeoutMs = 20000,
    maxAttempts = 3,
    maxPages = 500,
    requestDelayMs = 250,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    now = () => new Date(),
    log = logger,
  } = {}) {
    this.catalogUrl = catalogUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.maxPages = maxPages;
    this.requestDelayMs = requestDelayMs;
    this.sleep = sleep;
    this.now = now;
    this.log = log;
  }

  async fetchPage(page = 0) {
    const url = new URL(this.catalogUrl);
    if (page > 0) url.searchParams.set("currentPage", String(page));
    const response = await publicCatalogRequest({
      url,
      supplier: "WATSONS",
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts,
      sleep: this.sleep,
      responseType: "text",
    });
    return { html: response.data, retries: response.retries };
  }

  async livePriceRows() {
    const started = Date.now();
    const observedAt = this.now().toISOString();
    const rows = new Map();
    const failedPages = [];
    let pagesFetched = 0;
    let productsObserved = 0;
    let retryCount = 0;
    let expectedTotal = null;
    let expectedPages = null;
    let category = "Tüm Ürünler";
    let completeTraversal = true;
    let firstError = null;

    for (let page = 0; page < this.maxPages; page++) {
      try {
        const response = await this.fetchPage(page);
        pagesFetched++;
        retryCount += response.retries;
        const parsed = parseWatsonsPage(response.html, { observedAt });
        category = parsed.category;
        productsObserved += parsed.listedProducts;
        if (page === 0) {
          expectedTotal = parsed.total;
          expectedPages = parsed.lastPage + 1;
          if (expectedTotal == null) {
            throw catalogError(
              "WATSONS katalog toplam ürün sayısı bulunamadı",
              "WATSONS_SCHEMA_ERROR",
              {
                supplier: "WATSONS",
                failureStage: "pagination",
                httpStatus: 200,
              },
            );
          }
          if (expectedPages > this.maxPages) {
            completeTraversal = false;
            failedPages.push({ page: 1, code: "WATSONS_PAGINATION_LIMIT" });
            break;
          }
        } else if (parsed.total !== expectedTotal) {
          throw catalogError(
            "WATSONS katalog sayfaları arasında ürün sayısı değişti",
            "WATSONS_PAGINATION_CHANGED",
            {
              supplier: "WATSONS",
              failureStage: "pagination",
              httpStatus: 200,
            },
          );
        }
        for (const row of parsed.rows) rows.set(row.source_key, row);
        if (page + 1 >= expectedPages) break;
        if (!parsed.listedProducts) {
          completeTraversal = false;
          failedPages.push({
            page: page + 1,
            code: "WATSONS_UNEXPECTED_EMPTY_PAGE",
          });
          break;
        }
        if (this.requestDelayMs > 0) await this.sleep(this.requestDelayMs);
      } catch (error) {
        firstError ||= error;
        completeTraversal = false;
        const diagnostics = error.jobDiagnostics || {};
        failedPages.push({
          page: page + 1,
          code: error.code || "WATSONS_PAGE_FAILED",
          httpStatus: diagnostics.httpStatus ?? null,
          attempt: diagnostics.attempt ?? null,
        });
        this.log.warn("watsons_sync_page_failed", {
          supplier: "WATSONS",
          page: page + 1,
          httpStatus: diagnostics.httpStatus ?? null,
          attempt: diagnostics.attempt ?? null,
          productsSuccessfullyScanned: rows.size,
        });
        break;
      }
    }

    if (!rows.size && expectedTotal !== 0) {
      const source = firstError?.jobDiagnostics || {};
      throw catalogError(
        firstError?.message || "WATSONS kataloğundan geçerli ürün alınamadı",
        "WATSONS_CATALOG_EMPTY",
        {
          ...source,
          supplier: "WATSONS",
          productsScanned: 0,
          pagesFetched,
          retryCount,
          fullSnapshotStarted: false,
          failedPages,
        },
      );
    }

    if (expectedPages == null || rows.size !== expectedTotal)
      completeTraversal = false;
    const result = {
      rows: [...rows.values()],
      fullSnapshot: completeTraversal,
      stats: {
        supplier: "WATSONS",
        pagesFetched,
        productsObserved,
        productsImported: rows.size,
        expectedProducts: expectedTotal,
        category,
        failedPages,
        retryCount,
        completeTraversal,
        durationMs: Date.now() - started,
      },
    };
    this.log.info("watsons_sync_completed", result.stats);
    return result;
  }
}

module.exports = {
  WATSONS_CATALOG_URL,
  WatsonsMarketService,
  decodeHtml,
  positivePrice,
  stableProductId,
  cleanProductName,
  productRow,
  parseWatsonsPage,
};
