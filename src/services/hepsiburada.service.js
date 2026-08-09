const { env } = require("../config/env");
const { canonicalGtin } = require("../domain/catalog-gtin");

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

function safeKeys(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Object.keys(payload).sort();
}

function compactProductSummary(payload) {
  const row = normalizeRows(payload)[0] || null;
  if (!row)
    return {
      count: normalizeRows(payload).length,
      firstKeys: [],
      first: null,
    };
  return {
    count: normalizeRows(payload).length,
    firstKeys: safeKeys(row),
    first: safeResponseSummary({
      merchantSku: row.merchantSku,
      barcode: row.barcode,
      hbSku: row.hbSku || row.hepsiburadaSku || firstMatchedInfo(row)?.hbSku,
      variantGroupId: row.variantGroupId,
      productName: row.productName || firstMatchedInfo(row)?.productName,
      brand: row.brand || firstMatchedInfo(row)?.brand,
      categoryId: row.categoryId || firstMatchedInfo(row)?.categoryId,
      categoryName: row.categoryName || firstMatchedInfo(row)?.categoryName,
      imagesCount: Array.isArray(row.images)
        ? row.images.length
        : Array.isArray(firstMatchedInfo(row)?.images)
          ? firstMatchedInfo(row).images.length
          : 0,
      firstImage: Array.isArray(row.images)
        ? row.images[0]
        : firstMatchedInfo(row)?.images?.[0],
      status: row.status || row.productStatus,
      isSalable: row.isSalable,
    }),
  };
}

function matchedInfos(row) {
  const value =
    row?.matchedHbProductInfo ||
    row?.matchedHBProductInfo ||
    row?.matchedProductInfo ||
    row?.matchedProductInfos;
  if (Array.isArray(value)) return value.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

function firstMatchedInfo(row) {
  return matchedInfos(row)[0] || null;
}

function rowSignatureIdentifier(row) {
  const matched = firstMatchedInfo(row);
  return (
    row?.merchantSku ||
    row?.merchantSKU ||
    row?.hbSku ||
    row?.hepsiburadaSku ||
    row?.sku ||
    row?.barcode ||
    row?.productId ||
    row?.variantGroupId ||
    matched?.hbSku ||
    matched?.hepsiburadaSku ||
    matched?.productName ||
    row?.productName ||
    row?.name ||
    ""
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

function orderLineItemRequestsFromPayload(payload, orderNumber) {
  const targetOrderNumber = String(orderNumber || "").trim();
  const requests = [];
  const seen = new Set();

  function pushLineItem(row) {
    if (!row || typeof row !== "object") return;
    const candidateOrderNumber = String(
      row.orderNumber ||
        row.OrderNumber ||
        row.orderNo ||
        row.orderId ||
        row.order?.orderNumber ||
        "",
    ).trim();
    if (
      targetOrderNumber &&
      candidateOrderNumber &&
      candidateOrderNumber !== targetOrderNumber
    )
      return;
    const lineItemId =
      row.lineItemId ||
      row.lineitemid ||
      row.lineItemID ||
      row.LineItemId ||
      row.LineItemID ||
      (row.canCreatePackage === true ? row.id : null);
    if (!lineItemId) return;
    const key = String(lineItemId);
    if (seen.has(key)) return;
    seen.add(key);
    requests.push({
      lineItemId: key,
      quantity: Number(row.quantity || row.Quantity || 1) || 1,
    });
  }

  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    const rowOrderNumber = String(
      value.orderNumber ||
        value.OrderNumber ||
        value.orderNo ||
        value.orderId ||
        "",
    ).trim();
    const orderMatches =
      !targetOrderNumber ||
      !rowOrderNumber ||
      rowOrderNumber === targetOrderNumber;
    if (orderMatches) {
      pushLineItem(value);
      visit(value.lineItems);
      visit(value.LineItems);
      visit(value.items);
      visit(value.orderItems);
      visit(value.lines);
    }
  }

  visit(payload);
  return requests;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizePublicIdentifier(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function publicMetadataResult(fields, method, confidence = 0.82) {
  if (!fields?.productName) return null;
  const gtin = canonicalGtin(fields.gtin || fields.barcode || "");
  const images = Array.isArray(fields.images)
    ? fields.images
    : fields.image
      ? [fields.image]
      : [];
  return {
    productName: firstText(fields.productName, fields.name),
    brand: firstText(fields.brand, fields.brandName),
    categoryName: firstText(fields.categoryName, fields.category),
    categoryId: firstText(fields.categoryId),
    gtin,
    images: images.map((image) => String(image || "").trim()).filter(Boolean),
    url: firstText(fields.url),
    metadataSource: "HB_PUBLIC_CATALOG",
    metadataDetectionMethod: method,
    metadataConfidence: confidence,
  };
}

function mergePublicMetadata(primary, enrichment) {
  if (!primary) return enrichment || null;
  if (!enrichment) return primary;
  return {
    ...primary,
    brand: firstText(primary.brand, enrichment.brand),
    categoryName: firstText(primary.categoryName, enrichment.categoryName),
    categoryId: firstText(primary.categoryId, enrichment.categoryId),
    gtin: firstText(primary.gtin, enrichment.gtin),
    images: primary.images?.length ? primary.images : enrichment.images || [],
    url: firstText(primary.url, enrichment.url),
    metadataDetectionMethod: [
      primary.metadataDetectionMethod,
      enrichment.metadataDetectionMethod,
    ]
      .filter(Boolean)
      .join("+"),
    metadataConfidence: Math.max(
      Number(primary.metadataConfidence) || 0,
      Number(enrichment.metadataConfidence) || 0,
    ),
  };
}

function findJsonLdProducts(value, products = []) {
  if (!value) return products;
  if (Array.isArray(value)) {
    for (const item of value) findJsonLdProducts(item, products);
    return products;
  }
  if (typeof value !== "object") return products;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item || "").toLowerCase() === "product"))
    products.push(value);
  for (const key of ["@graph", "itemListElement", "mainEntity", "offers"])
    findJsonLdProducts(value[key], products);
  return products;
}

function findJsonLdBreadcrumbs(value, names = []) {
  if (!value) return names;
  if (Array.isArray(value)) {
    for (const item of value) findJsonLdBreadcrumbs(item, names);
    return names;
  }
  if (typeof value !== "object") return names;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item || "").toLowerCase() === "breadcrumblist")) {
    const elements = Array.isArray(value.itemListElement)
      ? value.itemListElement
      : [];
    for (const element of elements) {
      const name = element?.item?.name || element?.name;
      if (name) names.push(String(name));
    }
  }
  for (const nested of Object.values(value)) findJsonLdBreadcrumbs(nested, names);
  return names;
}

function parseJsonLdBlocks(html) {
  const blocks = [];
  const pattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    const body = htmlDecode(match[1]);
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch (_) {
      // Public pages occasionally include malformed tracking fragments. Ignore them.
    }
  }
  return blocks;
}

function extractBalancedObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let quote = "";
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function readPublicField(fragment, field) {
  const escapedPattern = new RegExp(
    `\\\\?"${field}\\\\?"\\s*:\\s*\\\\?"([\\s\\S]*?)\\\\?"(?=,|}|\\])`,
  );
  const match = fragment.match(escapedPattern);
  if (!match) return "";
  return htmlDecode(
    match[1]
      .replace(/\\u002F/g, "/")
      .replace(/\\u003C/g, "<")
      .replace(/\\u003E/g, ">")
      .replace(/\\u0026/g, "&")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\"),
  );
}

function publicSearchIdentifiers({ hbSku, merchantSku, productId } = {}) {
  return new Set(
    [hbSku, merchantSku, productId]
      .map(normalizePublicIdentifier)
      .filter(Boolean),
  );
}

function productUrlFromPublicPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `https://www.hepsiburada.com${value}`;
  return "";
}

function parseHepsiburadaPublicSearchHtml(html, identifiers = []) {
  const source = String(html || "");
  const idSet = new Set(
    [...identifiers].map(normalizePublicIdentifier).filter(Boolean),
  );
  if (!idSet.size) return null;

  const skuMatches = [
    ...source.matchAll(/\\?"sku\\?"\s*:\s*\\?"(HBC?V[0-9A-Z]+)\\?"/gi),
  ];
  for (const match of skuMatches) {
    const sku = normalizePublicIdentifier(match[1]);
    if (!idSet.has(sku)) continue;
    const productStart = Math.max(
      source.lastIndexOf('{\\"productId\\"', match.index),
      source.lastIndexOf('{"productId"', match.index),
      source.lastIndexOf('{\\"brand\\"', match.index),
      source.lastIndexOf('{"brand"', match.index),
    );
    const fragment = source.slice(
      productStart >= 0 ? productStart : Math.max(0, match.index - 3000),
      Math.min(source.length, match.index + 7000),
    );
    const name = readPublicField(
      source.slice(match.index, Math.min(source.length, match.index + 1500)),
      "name",
    );
    const brand = readPublicField(fragment, "brand");
    const url = productUrlFromPublicPath(
      readPublicField(
        source.slice(match.index, Math.min(source.length, match.index + 2000)),
        "url",
      ),
    );
    const image = readPublicField(
      source.slice(match.index, Math.min(source.length, match.index + 5000)),
      "link",
    );
    return publicMetadataResult(
      {
        productName: name,
        brand,
        images: image ? [image.replace("{size}", "500")] : [],
        url,
      },
      "EMBEDDED_STATE",
      0.8,
    );
  }
  return null;
}

function parseReduxStoreHtml(html) {
  const match = String(html || "").match(
    /<script[^>]+id=["']reduxStore["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  try {
    const state = JSON.parse(htmlDecode(match[1]));
    const product = state?.productState?.product;
    if (!product) return null;
    const categories = Array.isArray(product.categories)
      ? product.categories
      : [];
    const lastCategory = categories.at(-1) || {};
    const image =
      product.media?.[0]?.url ||
      product.media?.[0]?.link ||
      product.images?.[0]?.url ||
      product.images?.[0];
    return publicMetadataResult(
      {
        productName: product.name
          ? `${product.brand || ""} ${product.name}`.trim()
          : "",
        brand: product.brand,
        categoryName: lastCategory.categoryName || lastCategory.name,
        categoryId: lastCategory.categoryId || lastCategory.id,
        gtin: product.barcode || product.gtin,
        images: image ? [String(image).replace("{size}", "500")] : [],
        url: product.url,
      },
      "EMBEDDED_STATE",
      0.84,
    );
  } catch (_) {
    return null;
  }
}

function parseUtagDataHtml(html) {
  const source = String(html || "");
  const marker = "const utagData =";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf("{", markerIndex);
  const body = start >= 0 ? extractBalancedObject(source, start) : "";
  if (!body) return null;
  try {
    const data = JSON.parse(body);
    return publicMetadataResult(
      {
        productName: data.product_names?.[0] || data.product_name_array,
        brand: data.product_brands?.[0] || data.product_brand,
        categoryName:
          data.category_name_hierarchy ||
          (Array.isArray(data.product_categories)
            ? data.product_categories.join(" > ")
            : ""),
        categoryId: Array.isArray(data.product_category_ids)
          ? data.product_category_ids.at(-1)
          : "",
        gtin: data.product_barcodes?.[0] || data.product_barcode,
        url: data.canonical_url,
      },
      "EMBEDDED_STATE",
      0.84,
    );
  } catch (_) {
    return null;
  }
}

function parseHepsiburadaPublicCatalogHtml(html) {
  const blocks = parseJsonLdBlocks(html);
  const products = blocks.flatMap((block) => findJsonLdProducts(block, []));
  const product = products.find((item) => item?.name) || products[0];
  let metadata = null;
  if (product) {
    const brand =
      typeof product.brand === "string"
        ? product.brand
        : product.brand?.name || product.manufacturer?.name || "";
    const images = Array.isArray(product.image)
      ? product.image
      : product.image
        ? [product.image]
        : [];
    const breadcrumbs = blocks.flatMap((block) =>
      findJsonLdBreadcrumbs(block, []),
    );
    metadata = publicMetadataResult(
      {
        productName: product.name,
        brand,
        categoryName: firstText(product.category, breadcrumbs.at(-1)),
        gtin:
          product.gtin13 ||
          product.gtin14 ||
          product.gtin12 ||
          product.gtin8 ||
          product.gtin ||
          product.ean ||
          "",
        images,
        url: product.offers?.url || product.url,
      },
      "JSON_LD",
      0.86,
    );
  }
  metadata = mergePublicMetadata(metadata, parseReduxStoreHtml(html));
  metadata = mergePublicMetadata(metadata, parseUtagDataHtml(html));
  return metadata;
}

function extractPublicProductLinks(html, identifiers = []) {
  const idSet = new Set(
    [...identifiers].map(normalizePublicIdentifier).filter(Boolean),
  );
  if (!idSet.size) return [];
  const links = [];
  const seen = new Set();
  const pattern = /href=["']([^"']+-p(?:m)?-HBC?[V]?[0-9A-Z][^"']*)["']/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    const href = htmlDecode(match[1]);
    const upperHref = href.toUpperCase();
    const matched = [...idSet].some((id) => upperHref.includes(id));
    if (!matched && !/-PM?-HBC?[0-9A-Z]+/i.test(href)) continue;
    const url = productUrlFromPublicPath(href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

function publicResolutionDiagnostics(errorCode, details = {}) {
  return {
    resolved: false,
    errorCode,
    ...details,
  };
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

  async publicRequest(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || Math.min(this.timeoutMs, 6000),
    );
    try {
      const response = await this.fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": this.userAgent(),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        if (options.diagnostics)
          return { ok: false, status: response.status, url: response.url, body };
        return null;
      }
      if (options.diagnostics)
        return { ok: true, status: response.status, url: response.url, body };
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async resolvePublicCatalogMetadata({
    hbSku,
    merchantSku,
    productId,
    diagnostics = false,
  } = {}) {
    const identifiers = [
      hbSku,
      merchantSku,
      productId,
      String(productId || "").replace(/^HBC/i, "HBCV"),
    ]
      .map(normalizePublicIdentifier)
      .filter(Boolean);
    if (!identifiers.some((identifier) => /^HBC?[V]?[0-9A-Z]+$/i.test(identifier)))
      return diagnostics
        ? publicResolutionDiagnostics("UNSUPPORTED_IDENTIFIER")
        : null;

    const searchUrl = `https://www.hepsiburada.com/ara?q=${encodeURIComponent(
      identifiers[0],
    )}`;
    const searchResponse = await this.publicRequest(searchUrl, { diagnostics });
    const searchHtml = diagnostics ? searchResponse?.body : searchResponse;
    if (!searchHtml) {
      const code = searchResponse?.status
        ? `SEARCH_HTTP_${searchResponse.status}`
        : "SEARCH_NO_RESPONSE";
      return diagnostics ? publicResolutionDiagnostics(code) : null;
    }

    let metadata = parseHepsiburadaPublicSearchHtml(searchHtml, identifiers);
    const links = extractPublicProductLinks(searchHtml, identifiers);
    if (!metadata?.productName && !links.length)
      return diagnostics
        ? publicResolutionDiagnostics("SEARCH_RESULT_WITHOUT_MATCH", {
            searchFound: true,
          })
        : null;

    const productUrls = [
      metadata?.url,
      ...links,
    ].filter(Boolean);
    for (const url of [...new Set(productUrls)].slice(0, 3)) {
      const productResponse = await this.publicRequest(url, { diagnostics });
      const productHtml = diagnostics ? productResponse?.body : productResponse;
      if (!productHtml) continue;
      const productMetadata = parseHepsiburadaPublicCatalogHtml(productHtml);
      if (productMetadata?.productName)
        metadata = mergePublicMetadata(metadata, productMetadata);
      if (metadata?.productName && (metadata.categoryName || metadata.gtin))
        break;
    }

    if (metadata?.productName) {
      if (diagnostics)
        return {
          resolved: true,
          metadata,
          searchFound: true,
          productPagesFound: productUrls.length,
        };
      return metadata;
    }
    return diagnostics
      ? publicResolutionDiagnostics("PRODUCT_PAGE_METADATA_MISSING", {
          searchFound: true,
          productPagesFound: productUrls.length,
        })
      : null;
  }

  async fetchOrderMetadata({ days = 90, limit = 100 } = {}) {
    const end = new Date();
    const begin = new Date(end.getTime() - Math.max(Number(days) || 90, 1) * 86400000);
    const payload = await this.listOrders({
      beginDate: begin.toISOString(),
      endDate: end.toISOString(),
      offset: 0,
      limit: Math.min(Math.max(Number(limit) || 100, 1), 100),
    });
    return normalizeRows(payload);
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

  async waitForPackages({ attempts = 3, delayMs = 2000 } = {}) {
    let payload = null;
    const safeAttempts = Math.max(Number(attempts) || 1, 1);
    for (let attempt = 0; attempt < safeAttempts; attempt++) {
      payload = await this.listPackages({ limit: 100, offset: 0 });
      if (packageNumberFromPayload(payload)) return payload;
      if (attempt < safeAttempts - 1) await sleep(delayMs);
    }
    return payload;
  }

  async waitForOrderLineItems({
    orderNumber,
    attempts = 5,
    delayMs = 2000,
  } = {}) {
    let payload = null;
    const safeAttempts = Math.max(Number(attempts) || 1, 1);
    for (let attempt = 0; attempt < safeAttempts; attempt++) {
      payload = await this.listOrders({ limit: 100, offset: 0 });
      if (orderLineItemRequestsFromPayload(payload, orderNumber).length)
        return payload;
      if (attempt < safeAttempts - 1) await sleep(delayMs);
    }
    return payload;
  }

  async createPackageFromLineItems({
    lineItemRequests,
    parcelQuantity = 1,
    deci = 1,
  } = {}) {
    const body = {
      parcelQuantity: Math.max(Number(parcelQuantity) || 1, 1),
      deci: Math.max(Number(deci) || 1, 1),
      lineItemRequests: (lineItemRequests || []).map((item) => ({
        id: String(item.lineItemId || item.id || ""),
        quantity: String(Math.max(Number(item.quantity) || 1, 1)),
      })),
    };
    if (!body.lineItemRequests.some((item) => item.id)) {
      const error = new Error("Paketleme icin lineItemId bulunamadi");
      error.status = 409;
      throw error;
    }
    return this.request(
      `${this.orderBaseUrl}/packages/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async progressPackageStatus(packageNumber, status) {
    const normalizedStatus = String(status || "").toLowerCase();
    if (!["intransit", "deliver", "undeliver"].includes(normalizedStatus)) {
      const error = new Error("Desteklenmeyen Hepsiburada paket statü adımı");
      error.status = 400;
      throw error;
    }
    const now = new Date().toISOString();
    const body =
      normalizedStatus === "deliver"
        ? {
            receivedDate: now,
            receivedBy: "Aşlamacı ERP SIT Test",
            digitalCodes: [],
          }
        : normalizedStatus === "intransit"
          ? { shippedDate: now }
          : {};
    return this.request(
      `${this.orderBaseUrl}/packages/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}/packagenumber/${encodeURIComponent(
        String(packageNumber),
      )}/${normalizedStatus}`,
      { method: "POST", body: JSON.stringify(body) },
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

  async listCommissions(skus = []) {
    const skuList = [
      ...new Set(
        (skus || []).map((sku) => String(sku || "").trim()).filter(Boolean),
      ),
    ].slice(0, 50);
    const query = new URLSearchParams();
    if (skuList.length) query.set("skuList", skuList.join(","));
    const suffix = query.size ? `?${query}` : "";
    return this.request(
      `${this.listingBaseUrl}/commissions/merchantid/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}${suffix}`,
    );
  }

  async fetchCommissions(skus = []) {
    const unique = [
      ...new Set(
        (skus || []).map((sku) => String(sku || "").trim()).filter(Boolean),
      ),
    ];
    const rows = [];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const payload = await this.listCommissions(
        unique.slice(offset, offset + 50),
      );
      rows.push(...normalizeCommissionRows(payload));
    }
    return rows;
  }

  async listMerchantProducts({
    page = 0,
    size = 1000,
    merchantSku,
    hbSku,
    barcode,
  } = {}) {
    const query = new URLSearchParams({
      page: String(Math.max(Number(page) || 0, 0)),
      size: String(Math.min(Math.max(Number(size) || 1000, 1), 1000)),
    });
    if (merchantSku) query.set("merchantSku", String(merchantSku));
    if (hbSku) query.set("hbSku", String(hbSku));
    if (barcode) query.set("barcode", String(barcode));
    return this.request(
      `${this.productBaseUrl}/products/all-products-of-merchant/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}?${query}`,
    );
  }

  async fetchAllMerchantProducts({ pageSize = 1000, maxPages = 50 } = {}) {
    const items = [];
    const seenPages = new Set();
    for (let page = 0; page < maxPages; page++) {
      const payload = await this.listMerchantProducts({
        page,
        size: pageSize,
      });
      const rows = normalizeRows(payload);
      const pageSignature = JSON.stringify(
        rows.map((row) => rowSignatureIdentifier(row)),
      );
      if (page > 0 && pageSignature && seenPages.has(pageSignature)) break;
      seenPages.add(pageSignature);
      items.push(...rows);
      const totalPages = Number(
        payload?.totalPages ||
          payload?.data?.totalPages ||
          payload?.page?.totalPages ||
          0,
      );
      const currentPage = Number(
        payload?.number ??
          payload?.data?.number ??
          payload?.page?.number ??
          page,
      );
      if (!rows.length || payload?.last === true) break;
      if (totalPages > 0 && currentPage + 1 >= totalPages) break;
    }
    return items;
  }

  async getMerchantProductMetadata({ merchantSku, hbSku, barcode } = {}) {
    const payload = await this.listMerchantProducts({
      merchantSku,
      hbSku,
      barcode,
      page: 0,
      size: 10,
    });
    return normalizeRows(payload)[0] || null;
  }

  async catalogDiagnostics({ merchantSku, hbSku, barcode } = {}) {
    const result = {
      environment: this.environment,
      configured: this.configured(),
      productBaseUrl: this.productBaseUrl.replace(/^https?:\/\//, ""),
      listingBaseUrl: this.listingBaseUrl.replace(/^https?:\/\//, ""),
      input: {
        merchantSku: merchantSku ? "provided" : "missing",
        hbSku: hbSku ? "provided" : "missing",
        barcode: barcode ? "provided" : "missing",
      },
      listing: null,
      catalogFiltered: null,
      catalogFirstPage: null,
      errors: [],
    };
    try {
      const listingPayload = merchantSku
        ? await this.listListingsFiltered({
            merchantSkuList: merchantSku,
            limit: 5,
          })
        : await this.listListings({ limit: 5 });
      result.listing = compactProductSummary(listingPayload);
    } catch (error) {
      result.errors.push({
        source: "listing",
        message: error.message,
        status: error.status || null,
      });
    }
    try {
      const filteredPayload = await this.listMerchantProducts({
        merchantSku,
        hbSku,
        barcode,
        page: 0,
        size: 10,
      });
      result.catalogFiltered = compactProductSummary(filteredPayload);
    } catch (error) {
      result.errors.push({
        source: "catalog-filtered",
        message: error.message,
        status: error.status || null,
      });
    }
    try {
      const firstPagePayload = await this.listMerchantProducts({
        page: 0,
        size: 10,
      });
      result.catalogFirstPage = compactProductSummary(firstPagePayload);
    } catch (error) {
      result.errors.push({
        source: "catalog-first-page",
        message: error.message,
        status: error.status || null,
      });
    }
    return result;
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
    const response = await this.request(
      `https://oms-stub-external-sit.hepsiburada.com/orders/merchantId/${encodeURIComponent(
        env.hepsiburadaMerchantId,
      )}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return {
      orderNumber: body.OrderNumber,
      cargoCompanyId: Number(cargoCompanyId) || 89100,
      merchantSku,
      hbSku,
      response,
    };
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
    const addWarning = (title, message) => {
      result.checklist.push({ title, ok: false, message });
      return { title, ok: false, message };
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
      const orderNumber = result.responses.at(-1)?.response?.orderNumber;
      const orderPayload = add(
        "Paketlenecek siparisi /orders uzerinden okuma",
        await this.waitForOrderLineItems({
          orderNumber,
          attempts: Number(input.orderPollAttempts) || 5,
          delayMs: Number(input.orderPollDelayMs) || 2000,
        }),
      );
      const lineItemRequests = orderLineItemRequestsFromPayload(
        orderPayload,
        orderNumber,
      );
      if (!lineItemRequests.length) {
        addWarning(
          "LineItemId dogrulama",
          "Siparis olustu ancak /orders cevabinda paketleme icin lineItemId bulunamadi.",
        );
        result.ok = true;
        return result;
      }
      add(
        "LineItemId ile paket olusturma",
        await this.createPackageFromLineItems({
          lineItemRequests,
          parcelQuantity: Number(input.parcelQuantity) || 1,
          deci: Number(input.deci) || 1,
        }),
      );
      const packagePayload = add(
        "Saticiya ait paket bilgilerini listeleme",
        await this.waitForPackages({
          attempts: Number(input.packagePollAttempts) || 3,
          delayMs: Number(input.packagePollDelayMs) || 2000,
        }),
      );
      if (!packageNumberFromPayload(packagePayload)) {
        addWarning(
          "Paket olusumu dogrulama",
          "Siparis olustu ancak Hepsiburada SIT paket listesi bos dondu. Paket statu ilerletme icin siparisin once Paketlenecek/Gonderime Hazir surecine alinmasi veya paket numarasinin panelden girilmesi gerekiyor.",
        );
      }
      result.ok = true;
      return result;
    }
    if (normalizedStep === "package-status") {
      let packagePayload = null;
      try {
        packagePayload = add(
          "Saticiya ait paket bilgilerini listeleme",
          await this.waitForPackages({
            attempts: Number(input.packagePollAttempts) || 2,
            delayMs: Number(input.packagePollDelayMs) || 2000,
          }),
        );
      } catch (error) {
        if (!String(input.packageNumber || "").trim()) {
          addWarning(
            "Paket bilgisi alinamadi",
            "Hepsiburada SIT paket listeleme servisi hata verdi; paketlenecek siparis /orders uzerinden bulunup paket olusturma adimina gecilecek.",
          );
          result.responses.push({
            title: "Hepsiburada paket listeleme hatasi",
            response: safeResponseSummary({
              status: error.status || 500,
              message: error.message,
            }),
          });
          packagePayload = { packages: [] };
        } else {
          throw error;
        }
      }
      let packageNumber =
        String(input.packageNumber || "").trim() ||
        packageNumberFromPayload(packagePayload);
      if (!packageNumber) {
        const listingPayload = merchantSku
          ? await this.listListingsFiltered({
              merchantSkuList: merchantSku,
              limit: 1,
            })
          : await this.listListings({ limit: 1 });
        const listing = normalizeRows(listingPayload)[0];
        add("Paket icin listing sorgulama", listingPayload);
        if (listing) {
          add(
            "Paket statu icin test siparisi olusturma",
            await this.createSitOrder({ listing, cargoCompanyId: 89100 }),
          );
          const orderNumber = result.responses.at(-1)?.response?.orderNumber;
          const orderPayload = add(
            "Paketlenecek siparisi /orders uzerinden okuma",
            await this.waitForOrderLineItems({
              orderNumber,
              attempts: Number(input.orderPollAttempts) || 5,
              delayMs: Number(input.orderPollDelayMs) || 2000,
            }),
          );
          const lineItemRequests = orderLineItemRequestsFromPayload(
            orderPayload,
            orderNumber,
          );
          if (!lineItemRequests.length) {
            const error = new Error(
              "Paket statu testi icin lineItemId bulunamadi. Hepsiburada SIT /orders cevabinda paketlenecek satir olusmadi.",
            );
            error.status = 409;
            throw error;
          }
          add(
            "LineItemId ile paket olusturma",
            await this.createPackageFromLineItems({
              lineItemRequests,
              parcelQuantity: Number(input.parcelQuantity) || 1,
              deci: Number(input.deci) || 1,
            }),
          );
          packagePayload = add(
            "Yeni test siparisi sonrasi paket bilgilerini listeleme",
            await this.waitForPackages({
              attempts: Number(input.packagePollAttempts) || 4,
              delayMs: Number(input.packagePollDelayMs) || 2500,
            }),
          );
          packageNumber = packageNumberFromPayload(packagePayload);
        }
      }
      if (!packageNumber) {
        const error = new Error(
          "Paket statu testi icin paket numarasi bulunamadi. Hepsiburada SIT paketi henuz olusturmadi; 1-2 dakika sonra tekrar deneyin veya SIT paneldeki paket numarasini elle girin.",
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
  if (payload.data && !Array.isArray(payload.data))
    return normalizeRows(payload.data);
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

function normalizeCommissionRows(payload) {
  const rows = [];
  const seen = new Set();
  const identifierKeys = [
    "merchantSku",
    "merchantSKU",
    "merchantSkuCode",
    "merchantStockCode",
    "hbSku",
    "hbsku",
    "hepsiburadaSku",
    "productSku",
    "variantSku",
    "stockCode",
    "barcode",
    "sku",
  ];
  const rateKeys = [
    "commissionRate",
    "commissionrate",
    "commission_rate",
    "commissionPercentage",
    "commissionPercent",
    "rate",
  ];
  const wrappers = new Set([
    "commissions",
    "commissionRates",
    "commissionInfoList",
    "items",
    "listings",
    "content",
    "results",
    "data",
  ]);

  function push(row, impliedSku = null) {
    const normalized =
      impliedSku && !identifierKeys.some((key) => row[key])
        ? { ...row, sku: impliedSku }
        : row;
    const identifier = identifierKeys
      .map((key) => normalized[key])
      .find((value) => String(value || "").trim());
    const rate = rateKeys
      .map((key) => normalized[key])
      .concat([
        normalized.commission?.rate,
        normalized.commission?.value,
        normalized.commission?.percentage,
        normalized.commissionRate?.value,
      ])
      .find((value) => Number.isFinite(Number(value)));
    if (!identifier || rate === undefined) return false;
    const key = `${String(identifier).trim().toUpperCase()}:${Number(rate)}`;
    if (seen.has(key)) return true;
    seen.add(key);
    rows.push(normalized);
    return true;
  }

  function visit(value, impliedSku = null) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, impliedSku);
      return;
    }
    if (!value || typeof value !== "object") return;
    const rowLike =
      Boolean(impliedSku) || identifierKeys.some((key) => value[key]);
    push(value, impliedSku);
    if (rowLike) return;
    for (const [key, nested] of Object.entries(value)) {
      if (wrappers.has(key)) {
        visit(nested, impliedSku);
        continue;
      }
      if (nested && typeof nested === "object") visit(nested, key);
      else if (
        Number.isFinite(Number(nested)) &&
        !["code", "status", "total", "count", "page", "size"].includes(key)
      )
        push({ sku: key, commissionRate: nested });
    }
  }

  visit(payload);
  return rows;
}

module.exports = {
  HepsiburadaService,
  DEFAULT_ENDPOINTS,
  SIT_TEST_GUIDES,
  normalizedEnvironment,
  normalizeRows,
  normalizeCommissionRows,
  parseHepsiburadaPublicCatalogHtml,
  parseHepsiburadaPublicSearchHtml,
  listingDeactivationSummary,
  packageNumberFromPayload,
  orderLineItemRequestsFromPayload,
};
