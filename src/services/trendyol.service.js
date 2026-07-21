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
  normalizeImageUrl(url) {
    if (!url) return null;
    const value = String(url).trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    if (value.startsWith("/")) return `https://cdn.dsmcdn.com${value}`;
    return `https://cdn.dsmcdn.com/${value.replace(/^\/+/, "")}`;
  }
  collectImageCandidates(value, depth = 0, imageContext = false) {
    if (depth > 5 || value == null) return [];
    if (typeof value === "string") {
      return imageContext ? [value] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) =>
        this.collectImageCandidates(item, depth + 1, imageContext),
      );
    }
    if (typeof value !== "object") return [];
    const candidates = [];
    for (const [key, child] of Object.entries(value)) {
      const keyLooksImage = /(image|photo|media|thumbnail|picture)/i.test(key);
      const keyLooksUrl = /^(url|path|href|src|imageUrl|thumbnailUrl)$/i.test(
        key,
      );
      if (typeof child === "string" && (imageContext || keyLooksImage)) {
        candidates.push(child);
        continue;
      }
      candidates.push(
        ...this.collectImageCandidates(
          child,
          depth + 1,
          imageContext || keyLooksImage || keyLooksUrl,
        ),
      );
    }
    return candidates;
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
        const normalized = this.normalizeImageUrl(url);
        if (normalized) return normalized;
      }
    }
    return this.normalizeImageUrl(
      variant.imageUrl ||
        product.imageUrl ||
        product.image ||
        this.collectImageCandidates({ product, variant })[0],
    );
  }
  async imageDiagnostics(size = 10) {
    const data = await this.request(
      `/product/sellers/${env.trendyolSupplierId}/products/approved?page=0&size=${Math.min(Number(size) || 10, 20)}`,
    );
    const rows = [];
    for (const product of data.content || []) {
      const variants = product.variants || [product];
      for (const variant of variants.slice(0, 3)) {
        const candidate = this.firstImageUrl(product, variant);
        rows.push({
          barcode: variant.barcode || product.barcode || null,
          productKeys: Object.keys(product).sort(),
          variantKeys: Object.keys(variant).sort(),
          hasProductImages: Array.isArray(product.images)
            ? product.images.length
            : 0,
          hasVariantImages: Array.isArray(variant.images)
            ? variant.images.length
            : 0,
          candidate,
        });
      }
      if (rows.length >= 10) break;
    }
    return {
      totalElements: data.totalElements ?? null,
      contentCount: Array.isArray(data.content) ? data.content.length : 0,
      rows,
    };
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
  async listOrders({
    startDate,
    endDate,
    page = 0,
    size = 200,
    status,
    orderByField = "PackageLastModifiedDate",
    orderByDirection = "ASC",
  } = {}) {
    const query = new URLSearchParams({
      startDate: String(startDate),
      endDate: String(endDate),
      page: String(page),
      size: String(Math.min(Number(size) || 200, 200)),
      orderByField,
      orderByDirection,
    });
    if (status) query.set("status", status);
    return this.request(
      `/order/sellers/${env.trendyolSupplierId}/orders?${query}`,
      { headers: { storeFrontCode: env.trendyolStorefrontCode } },
    );
  }
  async listSettlements({
    startDate,
    endDate,
    transactionTypes,
    page = 0,
    size = 1000,
  } = {}) {
    const query = new URLSearchParams({
      startDate: String(startDate),
      endDate: String(endDate),
      page: String(page),
      size: String(Math.min(Number(size) || 1000, 1000)),
      transactionTypes: Array.isArray(transactionTypes)
        ? transactionTypes.join(",")
        : String(transactionTypes || "Sale"),
    });
    return this.request(
      `/finance/che/sellers/${env.trendyolSupplierId}/settlements?${query}`,
    );
  }
  async listOtherFinancials({
    startDate,
    endDate,
    transactionType = "DeductionInvoices",
    page = 0,
    size = 500,
  } = {}) {
    const query = new URLSearchParams({
      startDate: String(startDate),
      endDate: String(endDate),
      transactionType,
      page: String(page),
      size: String(Math.min(Number(size) || 500, 500)),
    });
    return this.request(
      `/finance/che/sellers/${env.trendyolSupplierId}/otherfinancials?${query}`,
    );
  }
  async listCargoInvoiceItems(invoiceSerialNumber, page = 0, size = 500) {
    const query = new URLSearchParams({
      page: String(page),
      size: String(Math.min(Number(size) || 500, 500)),
    });
    return this.request(
      `/finance/che/sellers/${env.trendyolSupplierId}/cargo-invoice/${encodeURIComponent(invoiceSerialNumber)}/items?${query}`,
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
