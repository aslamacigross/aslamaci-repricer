const {
  estimatePackageDesi,
  normalizePriceTiers,
  parsePriceTiersFromText,
} = require("../domain/supplier-products");
const {
  isShippingExcludedCategory,
} = require("../domain/shipping-exclusions");

const BIZIM_BASE_URL = "https://www.bizimtoptan.com.tr";
const BIZIM_CATEGORY_PATHS = Object.freeze([
  "/horeca-urunleri",
  "/temel-gida-849195",
  "/sivi-yag-margarin",
  "/atistirmalik-895655",
  "/icecek-79449",
  "/unlu-mamuller",
  "/sarkuteri-kahvaltilik-573764",
  "/et-urunleri-ve-sarkuteri",
  "/bebek-urunleri-200363",
  "/temizlik-843170",
  "/kisisel-bakim-260581",
  "/gida-disi",
  "/evcil-hayvan",
]);
const BIZIM_SHIPPING_EXCLUDED_CATEGORY_PATHS = Object.freeze([
  "/unlu-mamuller",
  "/et-urunleri-ve-sarkuteri",
  "/dondurma",
]);
const BIZIM_TIER_SOURCE = "BIZIM_PRODUCT_DETAIL";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function absoluteUrl(value, baseUrl = BIZIM_BASE_URL) {
  if (String(value || "").includes("${")) return null;
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return null;
  }
}

function isShippingExcludedPath(path) {
  const normalized = String(path || "")
    .trim()
    .replace(/\/$/, "");
  return BIZIM_SHIPPING_EXCLUDED_CATEGORY_PATHS.includes(normalized);
}

function parseNextUrl(html, baseUrl = BIZIM_BASE_URL) {
  const match = String(html || "").match(
    /<link\s+[^>]*rel=["']next["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  );
  return match ? absoluteUrl(match[1], baseUrl) : null;
}

function parseProductRows(html, { baseUrl = BIZIM_BASE_URL } = {}) {
  const rows = [];
  const blocks = String(html || "")
    .split("<!-- Product Box -->")
    .slice(1);
  for (const block of blocks) {
    const payloadMatch = block.match(/data-enhanced-productclick='([^']+)'/i);
    if (!payloadMatch) continue;
    let payload;
    try {
      payload = JSON.parse(decodeHtml(payloadMatch[1]));
    } catch {
      continue;
    }
    const id = String(payload.item_id || "").trim();
    const productName = decodeHtml(payload.item_name).trim();
    const price = Number(payload.price);
    if (!id || !productName || !Number.isFinite(price) || price <= 0) continue;
    const stockMatch = block.match(/data-stock=["']([^"']*)["']/i);
    const hrefMatch = block.match(
      /<a\s+href=["']([^"']+)["'][^>]*class=["'][^"']*product-item/i,
    );
    const imageMatch = block.match(
      /<img\s+[^>]*(?:data-src|src)=["']([^"']+)["'][^>]*>/i,
    );
    const desi = estimatePackageDesi(productName);
    const blockText = decodeHtml(block.replace(/<[^>]+>/g, " "));
    const priceTiers = parsePriceTiersFromText(blockText, price);
    const sourceUrl = hrefMatch ? absoluteUrl(hrefMatch[1], baseUrl) : null;
    rows.push({
      source_key: `bizim-web:${id}`,
      product_name: productName,
      current_price: price,
      brand: decodeHtml(payload.item_brand).trim(),
      availability:
        stockMatch && Number(stockMatch[1]) <= 0 ? "UNAVAILABLE" : "AVAILABLE",
      estimated_unit_desi: desi.value,
      desi_confidence: desi.confidence,
      source_url: sourceUrl,
      source_category: decodeHtml(payload.item_category).trim(),
      price_tiers: priceTiers,
      raw_data: {
        provider: "bizim-toptan-web",
        product_id: id,
        product_url: sourceUrl,
        image_url: imageMatch ? absoluteUrl(imageMatch[1], baseUrl) : null,
        category: decodeHtml(payload.item_category) || null,
        subcategory: decodeHtml(payload.item_category2) || null,
        product_group: decodeHtml(payload.item_category3) || null,
        stock: stockMatch ? Number(stockMatch[1]) : null,
        desi_basis: desi.basis,
        card_price_tiers: priceTiers,
        price_tiers: priceTiers,
      },
    });
  }
  return rows;
}

function isShippingExcludedRow(row) {
  return [
    row.source_category,
    row.raw_data?.category,
    row.raw_data?.subcategory,
    row.raw_data?.product_group,
  ].some((value) => isShippingExcludedCategory(value));
}

function parseBizimPrice(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "")
    .replace(/\s/g, "")
    .replace(/₺|TL|TRY/gi, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  return Number(normalized);
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseProductDetailPriceTiers(html, basePrice = null) {
  const source = String(html || "");
  if (
    !/data-enhanced-productdetail=/i.test(source) &&
    !/productdetail-price-table/i.test(source)
  )
    throw new Error("Bizim product detail doğrulanamadı");

  const badgeLabels = [
    ...source.matchAll(
      /<span[^>]*class=["'][^"']*badge-other[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    ),
  ]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
  const priceTiers = normalizePriceTiers(
    badgeLabels.flatMap((label) =>
      parsePriceTiersFromText(
        label.replace(/\b(adet|ad|paket)\s+üzeri\b/giu, "$1 ve üzeri"),
        basePrice,
      ).map((tier) => ({
        ...tier,
        label: tier.label || label,
      })),
    ),
  );

  const tableMatch = source.match(
    /<table[^>]*class=["'][^"']*productdetail-price-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i,
  );
  const packagePrices = [];
  if (tableMatch) {
    const rows = [
      ...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi),
    ].map((match) => match[1]);
    for (let index = 0; index < rows.length; index++) {
      const rowText = stripHtml(rows[index]);
      const quantityMatch = rowText.match(
        /\((\d+(?:[.,]\d+)?)\s*Adet\s*\)/i,
      );
      const totalMatch = rowText.match(
        /(\d+(?:\.\d{3})*(?:,\d{1,2})?)\s*TL\s*$/i,
      );
      const unitMatch = stripHtml(rows[index + 1] || "").match(
        /Adet\s*:\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?)\s*TL/i,
      );
      if (!quantityMatch && !unitMatch) continue;
      const quantity = quantityMatch
        ? Number(quantityMatch[1].replace(",", "."))
        : 1;
      const packageTotal = totalMatch ? parseBizimPrice(totalMatch[1]) : null;
      const unitPrice = unitMatch ? parseBizimPrice(unitMatch[1]) : packageTotal;
      if (!Number.isFinite(quantity) || quantity <= 1) continue;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
      packagePrices.push({
        package_quantity: quantity,
        unit_price: Number(unitPrice.toFixed(2)),
        package_total_price:
          Number.isFinite(packageTotal) && packageTotal > 0
            ? Number(packageTotal.toFixed(2))
            : null,
      });
    }
  }

  return {
    price_tiers: priceTiers,
    price_tiers_source: BIZIM_TIER_SOURCE,
    price_tiers_verified: true,
    badge_labels: badgeLabels,
    package_prices: packagePrices,
  };
}

async function fetchText(
  url,
  { fetchImpl = fetch, timeoutMs = 20000, retries = 2 } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "AslamaciERP/2.0 supplier-price-sync",
        },
      });
      if (!response.ok)
        throw new Error(
          `Bizim Toptan ${response.status}: ${response.statusText}`,
        );
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

class BizimMarketService {
  constructor({
    baseUrl = BIZIM_BASE_URL,
    categoryPaths = BIZIM_CATEGORY_PATHS,
    fetchImpl = fetch,
    timeoutMs = 20000,
    retries = 2,
    maxPagesPerCategory = 100,
    detailConcurrency = 6,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    const pathList = [...categoryPaths];
    this.excludedCategoryPaths = pathList.filter(isShippingExcludedPath);
    this.categoryPaths = pathList.filter((path) => !isShippingExcludedPath(path));
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.maxPagesPerCategory = maxPagesPerCategory;
    this.detailConcurrency = detailConcurrency;
  }

  async fetchText(url) {
    return fetchText(url, {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
    });
  }

  async crawlCategory(path) {
    const rows = [];
    const visited = new Set();
    let url = absoluteUrl(path, this.baseUrl);
    let pages = 0;
    while (url && !visited.has(url) && pages < this.maxPagesPerCategory) {
      visited.add(url);
      const html = await this.fetchText(url);
      rows.push(...parseProductRows(html, { baseUrl: this.baseUrl }));
      pages++;
      url = parseNextUrl(html, this.baseUrl);
    }
    return { rows, pages };
  }

  async verifyProductDetail(row, observedAt) {
    if (!row.source_url) throw new Error("Bizim ürün detay URL'si yok");
    const html = await this.fetchText(row.source_url);
    const detail = parseProductDetailPriceTiers(html, row.current_price);
    return {
      ...row,
      observed_at: observedAt,
      price_tiers: detail.price_tiers,
      raw_data: {
        ...row.raw_data,
        price_tiers: detail.price_tiers,
        price_tiers_source: detail.price_tiers_source,
        price_tiers_verified: true,
        price_tiers_verified_at: observedAt,
        product_detail_url: row.source_url,
        product_detail_badges: detail.badge_labels,
        package_prices: detail.package_prices,
      },
    };
  }

  async verifyProductDetails(rows, observedAt) {
    const verified = [];
    const failures = [];
    let nextIndex = 0;
    const workerCount = Math.min(this.detailConcurrency, rows.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < rows.length) {
        const index = nextIndex++;
        const row = rows[index];
        try {
          verified.push(await this.verifyProductDetail(row, observedAt));
        } catch (error) {
          failures.push({
            source_key: row.source_key,
            product_name: row.product_name,
            product_detail_url: row.source_url,
            error: error.message || "Bizim ürün detayı doğrulanamadı",
          });
        }
      }
    });
    await Promise.all(workers);
    return { rows: verified, failures };
  }

  async livePriceRows() {
    const results = await Promise.all(
      this.categoryPaths.map((path) => this.crawlCategory(path)),
    );
    const rowsBySource = new Map();
    let duplicates = 0;
    let productsSkippedShippingExcluded = 0;
    for (const result of results)
      for (const row of result.rows) {
        if (isShippingExcludedRow(row)) {
          productsSkippedShippingExcluded++;
          continue;
        }
        if (rowsBySource.has(row.source_key)) duplicates++;
        rowsBySource.set(row.source_key, row);
      }
    const observedAt = new Date().toISOString();
    const detailResult = await this.verifyProductDetails(
      [...rowsBySource.values()],
      observedAt,
    );
    const rows = detailResult.rows;
    return {
      rows,
      fullSnapshot: detailResult.failures.length === 0,
      stats: {
        provider: "bizim-toptan-web",
        categoriesScanned: this.categoryPaths.length,
        categoriesSkipped: this.excludedCategoryPaths.length,
        excludedCategoryPaths: this.excludedCategoryPaths,
        pagesScanned: results.reduce((sum, item) => sum + item.pages, 0),
        productsScanned: results.reduce(
          (sum, item) => sum + item.rows.length,
          0,
        ),
        targetProducts: rows.length,
        duplicates,
        productsSkippedShippingExcluded,
        productDetailRequests: rows.length + detailResult.failures.length,
        productDetailsVerified: rows.length,
        productDetailsFailed: detailResult.failures.length,
        failedProductDetails: detailResult.failures,
        productsWithPriceTiers: rows.filter((row) => row.price_tiers.length)
          .length,
        productsWithMultiplePriceTiers: rows.filter(
          (row) => row.price_tiers.length > 1,
        ).length,
        productsWithoutPriceTiers: rows.filter((row) => !row.price_tiers.length)
          .length,
      },
    };
  }
}

module.exports = {
  BIZIM_BASE_URL,
  BIZIM_CATEGORY_PATHS,
  BIZIM_SHIPPING_EXCLUDED_CATEGORY_PATHS,
  BIZIM_TIER_SOURCE,
  BizimMarketService,
  decodeHtml,
  absoluteUrl,
  parseNextUrl,
  parseProductRows,
  isShippingExcludedPath,
  isShippingExcludedRow,
  parseBizimPrice,
  parseProductDetailPriceTiers,
};
