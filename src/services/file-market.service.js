const FILE_API_BASE_URL = "https://api.filemarket.com.tr";

const TARGET_BRANDS = ["Harras", "Daycare", "Actisoft"];
const EXCLUDED_CATEGORIES = new Set([
  "Fırın Pastane",
  "Et Tavuk Balık",
  "Meyve Sebze",
]);

function includesTargetBrand(value) {
  const text = String(value || "").toLocaleLowerCase("tr-TR");
  return TARGET_BRANDS.some((brand) =>
    new RegExp(`\\b${brand.toLocaleLowerCase("tr-TR")}\\b`, "iu").test(text),
  );
}

function detectBrand(value) {
  const text = String(value || "").toLocaleLowerCase("tr-TR");
  return (
    TARGET_BRANDS.find((brand) =>
      new RegExp(`\\b${brand.toLocaleLowerCase("tr-TR")}\\b`, "iu").test(text),
    ) || ""
  );
}

function isExcludedCategory(value) {
  return EXCLUDED_CATEGORIES.has(String(value || "").trim());
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`File API ${response.status}: ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

class FileMarketService {
  constructor({
    baseUrl = FILE_API_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = 15000,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async fetchJson(path) {
    return fetchJson(`${this.baseUrl}${path}`, {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  async livePriceRows() {
    const categories = await this.fetchJson("/v1/categories");
    const rowsBySource = new Map();
    const stats = {
      categoriesScanned: 0,
      categoriesSkipped: 0,
      subcategoriesScanned: 0,
      productsScanned: 0,
      targetProducts: 0,
      duplicates: 0,
    };
    const observedAt = new Date().toISOString();

    for (const category of Array.isArray(categories) ? categories : []) {
      if (isExcludedCategory(category.name)) {
        stats.categoriesSkipped++;
        continue;
      }
      stats.categoriesScanned++;
      const subcategories = await this.fetchJson(
        `/v1/categories/${encodeURIComponent(category.id)}/subcategories`,
      );
      for (const subcategory of Array.isArray(subcategories)
        ? subcategories
        : []) {
        if (isExcludedCategory(subcategory.name)) continue;
        stats.subcategoriesScanned++;
        for (const product of subcategory.products || []) {
          stats.productsScanned++;
          if (!includesTargetBrand(product.productName)) continue;
          stats.targetProducts++;
          const price = Number(product.discountedPrice ?? product.productPrice);
          if (!Number.isFinite(price) || price <= 0) continue;
          const sourceKey = `file-api:${product.productCode || product.id}`;
          if (rowsBySource.has(sourceKey)) stats.duplicates++;
          rowsBySource.set(sourceKey, {
            source_key: sourceKey,
            product_name: product.productName,
            current_price: price,
            brand: detectBrand(product.productName),
            availability:
              product.enabled === false ? "UNAVAILABLE" : "AVAILABLE",
            observed_at: observedAt,
            raw_data: {
              provider: "file-market-api",
              category_id: category.id,
              category_name: category.name,
              subcategory_id: subcategory.id,
              subcategory_name: subcategory.name,
              product_id: product.id,
              product_code: product.productCode,
              amount_unit: product.amountUnit,
              initial_amount: product.initialAmount,
              amount_step: product.amountStep,
              max_amount: product.maxAmount,
              image_urls: product.imageURLs || [],
              discounted_price: product.discountedPrice ?? null,
              product_price: product.productPrice,
            },
          });
        }
      }
    }

    return { rows: [...rowsBySource.values()], stats };
  }
}

module.exports = {
  FileMarketService,
  TARGET_BRANDS,
  EXCLUDED_CATEGORIES,
  includesTargetBrand,
  detectBrand,
};
