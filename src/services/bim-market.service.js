const { estimatePackageDesi } = require("../domain/supplier-products");

const BIM_API_URL = "https://tr.fd-api.com/api/v5/graphql";
const BIM_VENDOR_ID = "fu9o";
const BIM_GLOBAL_ENTITY_ID = "YS_TR";
const BIM_LOCALE = "tr_TR";
const BIM_EXCLUDED_CATEGORY_PATTERN = /dondur/i;

const BIM_CATEGORY_DEFINITIONS = Object.freeze([
  {
    id: "61e2c593-865c-4688-bb2b-9b98a4420eb1",
    name: "Meyve & Sebze",
  },
  {
    id: "cc16e944-fbc8-4b60-bdba-0d2907e3b983",
    name: "Et, Tavuk & Şarküteri",
  },
  { id: "ba231c36-6034-460f-a70c-d7ac1d8ab8d8", name: "Su & İçecek" },
  { id: "90bf1742-e5c8-4f56-b1e7-c09684f9e7b1", name: "Dondurma" },
  { id: "829c4f2e-fbf7-468c-bd6e-2c84a65cf092", name: "Atıştırmalık" },
  { id: "b26d3ebb-9e5c-468c-91b0-1efe6c8b7a05", name: "Kahvaltılık" },
  {
    id: "b4aaa90a-6362-4ffa-81e7-3f9cc916ea68",
    name: "Gurme Ürünler",
  },
  {
    id: "cb97ffca-30e5-4131-9e44-b0845cb30873",
    name: "Süt & Süt Ürünleri",
  },
  { id: "c7b6e3d0-17d4-4c29-99da-00c3ca5091ce", name: "Fırından" },
  { id: "c474e2d9-fc4e-4715-909b-a243d000b63e", name: "Çay & Kahve" },
  { id: "9a8fcf31-3534-44e8-9abc-950ee7e7135c", name: "Temel Gıda" },
  { id: "db5c8530-0ea4-4074-a826-614d21b1d503", name: "Ev Bakım" },
  {
    id: "c5c5f0ca-dc9e-46cc-9a74-4d59097047ac",
    name: "Kağıt Ürünleri",
  },
  {
    id: "a334ed1b-2cd2-44a2-bf77-f8c2b3bc180d",
    name: "Kişisel Bakım",
  },
  { id: "97736585-20b5-4b02-9946-10d988a68f1c", name: "Kozmetik" },
  { id: "e1cdb718-16d0-4474-8fee-b594c2d9e042", name: "Hızlı Yemek" },
  {
    id: "1182b010-9fbc-4620-b924-c3a7d6bb72a7",
    name: "Sağlıklı Yaşam",
  },
  { id: "bb8f3912-3149-4a28-8ff6-9e56bfaab5d8", name: "Ev & Yaşam" },
  { id: "7d1cd6ca-ee33-4d78-8dae-64058f1ce4d5", name: "Pet Shop" },
  { id: "085ebfcd-53ce-4c72-b718-6a355348224b", name: "Bebek" },
  {
    id: "46a7f5c6-a163-4479-98e3-f29ce1358c71",
    name: "Giyim & Aksesuar",
  },
]);

const BIM_CATALOG_QUERY = `
  query BimCatalog(
    $categoryId: String!
    $globalEntityId: String!
    $isDarkstore: Boolean!
    $locale: String!
    $vendorID: String!
  ) {
    categoryProductList(
      input: {
        categoryID: $categoryId
        globalEntityID: $globalEntityId
        isDarkstore: $isDarkstore
        locale: $locale
        platform: "web"
        vendorID: $vendorID
      }
    ) {
      categoryProducts {
        id
        name
        items {
          activeCampaigns {
            benefitQuantity
            description
            discountType
            discountValue
            endTime
            id
            name
            totalTriggerThresholdFloat
            triggerQuantity
            type
          }
          attributes(keys: ["baseContentValue", "baseUnit", "maximumSalesQuantity", "sku"]) {
            key
            value
          }
          badges
          globalCatalogID
          isAvailable
          name
          originalPrice
          parentID
          price
          productBadges {
            text
            type
            variant
          }
          productID
          stockAmount
          type
          urls
        }
      }
    }
  }
`;

function brandFromName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0];
}

function attributesObject(attributes = []) {
  return Object.fromEntries(
    (Array.isArray(attributes) ? attributes : [])
      .filter((item) => item?.key)
      .map((item) => [item.key, item.value]),
  );
}

function productRow(
  product,
  { category, group, observedAt, vendorId = BIM_VENDOR_ID },
) {
  const productId = String(product?.productID || "").trim();
  const productName = String(product?.name || "").trim();
  const price = Number(product?.price ?? product?.originalPrice);
  if (!productId || !productName || !Number.isFinite(price) || price <= 0)
    return null;
  const desi = estimatePackageDesi(productName);
  const categoryUrl = `https://www.yemeksepeti.com/shop/${vendorId}/bim-${vendorId}/category/${category.id}`;
  return {
    source_key: `bim-yemeksepeti:${productId}`,
    product_name: productName,
    current_price: price,
    brand: brandFromName(productName),
    availability: product.isAvailable === false ? "UNAVAILABLE" : "AVAILABLE",
    observed_at: observedAt,
    source_url: categoryUrl,
    source_category: group?.name || category.name,
    estimated_unit_desi: desi.value,
    desi_confidence: desi.confidence,
    raw_data: {
      provider: "yemeksepeti-bim-graphql",
      vendor_id: vendorId,
      product_id: productId,
      parent_id: product.parentID || null,
      global_catalog_id: product.globalCatalogID || null,
      top_category_id: category.id,
      top_category_name: category.name,
      category_id: group?.id || null,
      category_name: group?.name || category.name,
      original_price: product.originalPrice ?? null,
      stock_amount: product.stockAmount ?? null,
      product_type: product.type || null,
      attributes: attributesObject(product.attributes),
      image_urls: Array.isArray(product.urls) ? product.urls : [],
      active_campaigns: product.activeCampaigns || [],
      product_badges: product.productBadges || [],
      badges: product.badges || [],
      desi_basis: desi.basis,
    },
  };
}

class BimMarketService {
  constructor({
    apiUrl = BIM_API_URL,
    vendorId = BIM_VENDOR_ID,
    globalEntityId = BIM_GLOBAL_ENTITY_ID,
    locale = BIM_LOCALE,
    categories = BIM_CATEGORY_DEFINITIONS,
    fetchImpl = fetch,
    timeoutMs = 20000,
    retries = 2,
  } = {}) {
    this.apiUrl = apiUrl;
    this.vendorId = vendorId;
    this.globalEntityId = globalEntityId;
    this.locale = locale;
    const categoryList = [...categories];
    this.excludedCategories = categoryList.filter((category) =>
      BIM_EXCLUDED_CATEGORY_PATTERN.test(category.name),
    );
    this.categories = categoryList.filter(
      (category) => !BIM_EXCLUDED_CATEGORY_PATTERN.test(category.name),
    );
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  async fetchCategory(category) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.apiUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            origin: "https://www.yemeksepeti.com",
            referer: "https://www.yemeksepeti.com/",
            platform: "web",
            "user-agent": "AslamaciERP/2.0 supplier-price-sync",
            "x-apollo-operation-name": "BimCatalog",
            "x-pd-language-id": "2",
            "x-requested-with": "XMLHttpRequest",
          },
          body: JSON.stringify({
            query: BIM_CATALOG_QUERY,
            variables: {
              categoryId: category.id,
              globalEntityId: this.globalEntityId,
              isDarkstore: false,
              locale: this.locale,
              vendorID: this.vendorId,
            },
          }),
        });
        if (!response.ok)
          throw new Error(
            `BİM katalog API ${response.status}: ${response.statusText}`,
          );
        const body = await response.json();
        if (body.errors?.length)
          throw new Error(
            `BİM katalog API: ${body.errors
              .map((error) => error.message)
              .join(", ")}`,
          );
        const groups = body.data?.categoryProductList?.categoryProducts;
        if (!Array.isArray(groups))
          throw new Error("BİM katalog API ürün listesi geçersiz");
        return groups;
      } catch (error) {
        lastError = error;
        if (attempt >= this.retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async livePriceRows() {
    const observedAt = new Date().toISOString();
    const attempts = await Promise.allSettled(
      this.categories.map(async (category) => ({
        category,
        groups: await this.fetchCategory(category),
      })),
    );
    const results = attempts
      .filter((attempt) => attempt.status === "fulfilled")
      .map((attempt) => attempt.value);
    const failures = attempts
      .map((attempt, index) =>
        attempt.status === "rejected"
          ? {
              category: this.categories[index].name,
              categoryId: this.categories[index].id,
              error: attempt.reason?.message || "BİM kategori taranamadı",
            }
          : null,
      )
      .filter(Boolean);
    if (!results.length)
      throw new Error(
        `BİM canlı katalog tüm kategorilerde başarısız: ${failures
          .map((failure) => `${failure.category}: ${failure.error}`)
          .join("; ")}`,
      );
    const rowsBySource = new Map();
    let productsScanned = 0;
    let duplicates = 0;
    let unavailable = 0;
    for (const result of results)
      for (const group of result.groups)
        for (const product of group.items || []) {
          productsScanned++;
          const row = productRow(product, {
            category: result.category,
            group,
            observedAt,
            vendorId: this.vendorId,
          });
          if (!row) continue;
          if (rowsBySource.has(row.source_key)) duplicates++;
          if (row.availability === "UNAVAILABLE") unavailable++;
          rowsBySource.set(row.source_key, row);
        }
    const rows = [...rowsBySource.values()];
    if (!rows.length) throw new Error("BİM canlı katalog boş döndü");
    return {
      rows,
      fullSnapshot: failures.length === 0,
      stats: {
        provider: "yemeksepeti-bim-graphql",
        vendorId: this.vendorId,
        categoriesRequested: this.categories.length,
        categoriesScanned: results.length,
        categoriesFailed: failures.length,
        categoriesSkipped: this.excludedCategories.length,
        excludedCategories: this.excludedCategories.map(
          (category) => category.name,
        ),
        failedCategories: failures,
        categoryGroupsScanned: results.reduce(
          (sum, result) => sum + result.groups.length,
          0,
        ),
        productsScanned,
        targetProducts: rows.length,
        duplicates,
        unavailable,
      },
    };
  }
}

module.exports = {
  BIM_API_URL,
  BIM_VENDOR_ID,
  BIM_CATEGORY_DEFINITIONS,
  BIM_CATALOG_QUERY,
  BimMarketService,
  attributesObject,
  productRow,
};
