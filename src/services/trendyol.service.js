const { env } = require("../config/env");

class TrendyolService {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.baseUrl = options.baseUrl || "https://apigw.trendyol.com/integration";
    this.timeoutMs = options.timeoutMs || 20000;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs || 250;
    this.sleep =
      options.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  headers() {
    return {
      Authorization: `Basic ${Buffer.from(`${env.trendyolApiKey}:${env.trendyolApiSecret}`).toString("base64")}`,
      "User-Agent": `${env.trendyolSupplierId} - SelfIntegration`,
      "Content-Type": "application/json",
    };
  }
  async request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const attempts = method === "GET" ? this.retryAttempts : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers: { ...this.headers(), ...(options.headers || {}) },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new Error(
            `Trendyol HTTP ${response.status}: ${text.slice(0, 500)}`,
          );
          error.status = response.status;
          throw error;
        }
        try {
          return text ? JSON.parse(text) : {};
        } catch (error) {
          error.message = `Trendyol geçersiz JSON yanıtı: ${error.message}`;
          throw error;
        }
      } catch (error) {
        lastError = error;
        const retryable =
          !error.status || [429, 500, 502, 503, 504].includes(error.status);
        if (!retryable || attempt === attempts) throw error;
      } finally {
        clearTimeout(timer);
      }
      await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
    }
    throw lastError;
  }
  firstImageUrl(product, variant = {}) {
    const sources = [
      variant.images,
      variant.imageUrls,
      variant.productImages,
      product.images,
      product.imageUrls,
      product.productImages,
    ];
    for (const source of sources) {
      const list = Array.isArray(source) ? source : source ? [source] : [];
      for (const item of list) {
        const url =
          typeof item === "string"
            ? item
            : item?.url || item?.imageUrl || item?.path || item?.thumbnailUrl;
        if (url) return String(url);
      }
    }
    return variant.imageUrl || product.imageUrl || product.image || null;
  }
  normalizeProductPage(data) {
    const content = [];
    for (const product of data.content || []) {
      const variants = product.variants || [product];
      for (const variant of variants) {
        content.push({
          ...variant,
          id: variant.variantId || variant.id,
          barcode: variant.barcode,
          title: product.title || variant.title,
          brand:
            typeof product.brand === "object"
              ? product.brand?.name
              : product.brand || variant.brand,
          categoryName:
            typeof product.category === "object"
              ? product.category?.name
              : product.categoryName || variant.categoryName,
          pimCategoryId:
            product.category?.id || product.pimCategoryId || variant.categoryId,
          categoryId:
            product.category?.id || product.categoryId || variant.categoryId,
          salePrice: variant.price?.salePrice ?? variant.salePrice,
          listPrice: variant.price?.listPrice ?? variant.listPrice,
          priceSeenByCustomer:
            variant.price?.priceSeenByCustomer ?? variant.priceSeenByCustomer,
	          commission: variant.commission ?? product.commission,
	          quantity: variant.stock?.quantity ?? variant.quantity,
	          approved: variant.approved ?? product.approved ?? true,
	          archived: variant.archived ?? product.archived ?? false,
	          locked: variant.locked ?? product.locked ?? false,
	          onSale: variant.onSale ?? product.onSale ?? false,
	          productImageUrl: this.firstImageUrl(product, variant),
	        });
      }
    }
    const currentPage = Number(data.page || 0);
    const totalPages = Number(data.totalPages || 0);
    return {
      ...data,
      content,
      last:
        totalPages > 0 ? currentPage + 1 >= totalPages : content.length === 0,
    };
  }
  async listProducts(page = 0, size = 100) {
    const data = await this.request(
      `/product/sellers/${env.trendyolSupplierId}/products/approved?page=${page}&size=${Math.min(Number(size) || 100, 100)}`,
    );
    return this.normalizeProductPage(data);
  }
  async getProductByBarcode(barcode) {
    const data = await this.request(
      `/product/sellers/${env.trendyolSupplierId}/products/approved?barcode=${encodeURIComponent(barcode)}&page=0&size=1`,
    );
    return this.normalizeProductPage(data).content.find(
      (item) => String(item.barcode) === String(barcode),
    );
  }
  async getBatchResult(batchRequestId) {
    return this.request(
      `/product/sellers/${env.trendyolSupplierId}/products/batch-requests/${encodeURIComponent(batchRequestId)}`,
    );
  }
  async buybox(barcodes) {
    return this.request(
      `/product/sellers/${env.trendyolSupplierId}/products/buybox-information`,
      { method: "POST", body: JSON.stringify({ barcodes }) },
    );
  }
  async updatePrices(items, { dryRun = true } = {}) {
    if (dryRun) return { dryRun: true, itemCount: items.length, items };
    return this.request(
      `/inventory/sellers/${env.trendyolSupplierId}/products/price-and-inventory`,
      { method: "POST", body: JSON.stringify({ items }) },
    );
  }
  configured() {
    return Boolean(
      env.trendyolApiKey && env.trendyolApiSecret && env.trendyolSupplierId,
    );
  }
}

module.exports = { TrendyolService };
