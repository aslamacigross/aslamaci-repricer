const {
  estimatePackageDesi,
  parsePriceTiersFromText,
} = require("../domain/supplier-products");

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
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return null;
  }
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
    rows.push({
      source_key: `bizim-web:${id}`,
      product_name: productName,
      current_price: price,
      brand: decodeHtml(payload.item_brand).trim(),
      availability:
        stockMatch && Number(stockMatch[1]) <= 0 ? "UNAVAILABLE" : "AVAILABLE",
      estimated_unit_desi: desi.value,
      desi_confidence: desi.confidence,
      source_url: hrefMatch ? absoluteUrl(hrefMatch[1], baseUrl) : null,
      source_category: decodeHtml(payload.item_category).trim(),
      price_tiers: priceTiers,
      raw_data: {
        provider: "bizim-toptan-web",
        product_id: id,
        product_url: hrefMatch ? absoluteUrl(hrefMatch[1], baseUrl) : null,
        image_url: imageMatch ? absoluteUrl(imageMatch[1], baseUrl) : null,
        category: decodeHtml(payload.item_category) || null,
        subcategory: decodeHtml(payload.item_category2) || null,
        product_group: decodeHtml(payload.item_category3) || null,
        stock: stockMatch ? Number(stockMatch[1]) : null,
        desi_basis: desi.basis,
        price_tiers: priceTiers,
      },
    });
  }
  return rows;
}

function isFrozenRow(row) {
  return [
    row.source_category,
    row.raw_data?.category,
    row.raw_data?.subcategory,
    row.raw_data?.product_group,
  ].some((value) =>
    String(value || "")
      .toLocaleLowerCase("tr-TR")
      .includes("dondur"),
  );
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
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.categoryPaths = [...categoryPaths].filter(
      (path) => !String(path).toLocaleLowerCase("tr-TR").includes("dondur"),
    );
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.maxPagesPerCategory = maxPagesPerCategory;
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

  async livePriceRows() {
    const results = await Promise.all(
      this.categoryPaths.map((path) => this.crawlCategory(path)),
    );
    const rowsBySource = new Map();
    let duplicates = 0;
    let productsSkippedFrozen = 0;
    for (const result of results)
      for (const row of result.rows) {
        if (isFrozenRow(row)) {
          productsSkippedFrozen++;
          continue;
        }
        if (rowsBySource.has(row.source_key)) duplicates++;
        rowsBySource.set(row.source_key, row);
      }
    const observedAt = new Date().toISOString();
    const rows = [...rowsBySource.values()].map((row) => ({
      ...row,
      observed_at: observedAt,
    }));
    return {
      rows,
      fullSnapshot: true,
      stats: {
        provider: "bizim-toptan-web",
        categoriesScanned: this.categoryPaths.length,
        categoriesSkipped: 1,
        pagesScanned: results.reduce((sum, item) => sum + item.pages, 0),
        productsScanned: results.reduce(
          (sum, item) => sum + item.rows.length,
          0,
        ),
        targetProducts: rows.length,
        duplicates,
        productsSkippedFrozen,
      },
    };
  }
}

module.exports = {
  BIZIM_BASE_URL,
  BIZIM_CATEGORY_PATHS,
  BizimMarketService,
  decodeHtml,
  parseNextUrl,
  parseProductRows,
  isFrozenRow,
};
