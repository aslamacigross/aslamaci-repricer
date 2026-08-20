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

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function identifierVariants(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (/^HBCV[0-9A-Z]+$/.test(normalized))
    variants.add(normalized.replace(/^HBCV/, "HBC"));
  if (/^HBC[0-9A-Z]+$/.test(normalized) && !normalized.startsWith("HBCV"))
    variants.add(normalized.replace(/^HBC/, "HBCV"));
  return [...variants];
}

function normalizeSeller(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("tr-TR");
}

function parseTurkishPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    return parseTurkishPrice(
      value.value ??
        value.amount ??
        value.price ??
        value.formattedPrice ??
        value.text,
    );
  }
  const text = String(value)
    .replace(/\s+/g, " ")
    .replace(/[₺]|TL|TRY/gi, "")
    .trim();
  if (!text) return null;
  const compact = text.replace(/\./g, "").replace(",", ".");
  const parsed = Number(compact);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function parseJsonBlock(body) {
  if (!body) return null;
  const raw = String(body).trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    try {
      return JSON.parse(htmlDecode(raw));
    } catch (__) {
      return null;
    }
  }
}

function extractPublicJsonObjects(html) {
  const source = String(html || "");
  const objects = [];
  const reduxPattern =
    /<script[^>]+id=["']reduxStore["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = reduxPattern.exec(source))) {
    const parsed = parseJsonBlock(match[1]);
    if (parsed) objects.push({ source: "REDUX_STATE", value: parsed });
  }

  const jsonLdPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = jsonLdPattern.exec(source))) {
    const parsed = parseJsonBlock(match[1]);
    if (parsed) objects.push({ source: "JSON_LD", value: parsed });
  }

  const statePattern = /['"]STATE['"]\s*:\s*/g;
  while ((match = statePattern.exec(source))) {
    const start = source.indexOf("{", statePattern.lastIndex);
    const body = start >= 0 ? extractBalancedObject(source, start) : "";
    const parsed = parseJsonBlock(body);
    if (parsed) objects.push({ source: "EMBEDDED_STATE", value: parsed });
  }
  return objects;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return value;
  }
  return "";
}

function priceFromOffer(value) {
  return parseTurkishPrice(
    value?.priceInfo?.price ??
      value?.priceInfo?.finalPrice ??
      value?.priceInfo?.formattedPrice ??
      value?.prices?.[0]?.value ??
      value?.prices?.[0]?.formattedPrice ??
      value?.finalPrice ??
      value?.salePrice ??
      value?.sellingPrice ??
      value?.price?.value ??
      value?.price?.amount ??
      value?.price ??
      value?.formattedPrice,
  );
}

function offerFromObject(value, context = {}, source = "EMBEDDED_STATE") {
  if (!value || typeof value !== "object") return null;
  const listing = value.listing && typeof value.listing === "object";
  const candidate = listing ? value.listing : value;
  const seller = first(
    candidate.merchantName,
    candidate.sellerName,
    candidate.vendorName,
    candidate.merchant?.name,
    candidate.seller?.name,
  );
  const sellerId = first(
    candidate.merchantId,
    candidate.sellerId,
    candidate.vendorId,
    candidate.merchant?.id,
    candidate.seller?.id,
  );
  const price = priceFromOffer(candidate);
  if (!seller && !sellerId) return null;
  if (!price) return null;
  return {
    sku: normalizeIdentifier(first(value.sku, candidate.sku, context.sku)),
    seller: String(seller || "").trim(),
    sellerId: String(sellerId || "").trim(),
    listingId: String(first(candidate.listingId, value.listingId)).trim(),
    price,
    isMultiSeller:
      typeof value.isMultiSeller === "boolean"
        ? value.isMultiSeller
        : typeof candidate.isMultiSeller === "boolean"
          ? candidate.isMultiSeller
          : null,
    source,
  };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function collectOffers(
  value,
  options = {},
  context = {},
  source = "EMBEDDED_STATE",
) {
  const offers = [];
  const targetIds = new Set(
    [options.hbSku, options.merchantSku, options.productId]
      .flatMap(identifierVariants)
      .filter(Boolean),
  );
  const matchesTarget = (offer) => {
    const hasSku = Boolean(offer.sku);
    const skuMatches = hasSku && targetIds.has(offer.sku);
    return !targetIds.size || !hasSku || skuMatches;
  };

  const visit = (node, current = context) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, current);
      return;
    }

    const next = {
      ...current,
      sku: first(node.sku, node.hbSku, node.hepsiburadaSku, current.sku),
    };
    const offer = offerFromObject(node, next, source);
    if (offer && matchesTarget(offer)) offers.push(offer);

    if (isPlainObject(node.productState?.product))
      visit(node.productState.product, next);
    if (Array.isArray(node.productState?.allListings))
      visit(node.productState.allListings, next);
    if (Array.isArray(node.productState?.otherMerchants))
      visit(node.productState.otherMerchants, next);
    if (Array.isArray(node.productState?.product?.allListings))
      visit(node.productState.product.allListings, next);
    if (Array.isArray(node.productState?.product?.otherMerchants))
      visit(node.productState.product.otherMerchants, next);
    if (Array.isArray(node.variantList)) visit(node.variantList, next);
    if (Array.isArray(node.variants)) visit(node.variants, next);
    if (Array.isArray(node.products)) visit(node.products, next);
    if (Array.isArray(node.data?.products)) visit(node.data.products, next);
    if (Array.isArray(node.data?.items)) visit(node.data.items, next);
    if (isPlainObject(node.data)) visit(node.data, next);

    if (node.offers && typeof node.offers === "object") {
      const jsonLdOffer = offerFromJsonLd(node.offers, node, source);
      if (jsonLdOffer && matchesTarget(jsonLdOffer)) offers.push(jsonLdOffer);
    }
  };

  visit(value, context);
  return offers;
}

function offerFromJsonLd(offer, product, source) {
  const firstOffer = Array.isArray(offer) ? offer[0] : offer;
  if (!firstOffer || typeof firstOffer !== "object") return null;
  const price = parseTurkishPrice(firstOffer.price ?? firstOffer.lowPrice);
  if (!price) return null;
  return {
    sku: normalizeIdentifier(
      first(product.sku, product.productID, product.mpn),
    ),
    seller: String(
      first(firstOffer.seller?.name, firstOffer.offeredBy?.name),
    ).trim(),
    sellerId: String(first(firstOffer.seller?.identifier)).trim(),
    listingId: "",
    price,
    isMultiSeller: null,
    source,
  };
}

function dedupeOffers(offers) {
  const seen = new Set();
  const result = [];
  for (const offer of offers) {
    const key = [
      offer.listingId,
      normalizeSeller(offer.seller),
      offer.sellerId,
      offer.price,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(offer);
  }
  return result;
}

function isOwnOffer(offer, options = {}) {
  const merchantId = String(options.ownMerchantId || "").trim();
  if (merchantId && offer.sellerId && offer.sellerId === merchantId)
    return true;
  const sellerNames = new Set(
    (options.ownSellerNames || []).map(normalizeSeller).filter(Boolean),
  );
  return sellerNames.size > 0 && sellerNames.has(normalizeSeller(offer.seller));
}

function parseHepsiburadaPublicBuyboxHtml(html, options = {}) {
  const objects = extractPublicJsonObjects(html);
  const offers = dedupeOffers(
    objects.flatMap((entry) =>
      collectOffers(entry.value, options, {}, entry.source),
    ),
  );
  if (!offers.length)
    return {
      ok: false,
      status: "PARSE_FAILED",
      offers: [],
      source: null,
      failureReason: "PUBLIC_OFFERS_NOT_FOUND",
    };

  const rankedOffers = offers.slice(0, 3);
  const ownIndex = rankedOffers.findIndex((offer) =>
    isOwnOffer(offer, options),
  );
  const rank = ownIndex >= 0 ? ownIndex + 1 : null;
  const explicitMulti = offers.find(
    (offer) => typeof offer.isMultiSeller === "boolean",
  )?.isMultiSeller;
  return {
    ok: true,
    status: "OK",
    offers,
    source: rankedOffers[0]?.source || offers[0]?.source || "EMBEDDED_STATE",
    buyboxPrice: rankedOffers[0]?.price ?? null,
    buyboxSeller: rankedOffers[0]?.seller || null,
    secondPrice: rankedOffers[1]?.price ?? null,
    secondSeller: rankedOffers[1]?.seller || null,
    thirdPrice: rankedOffers[2]?.price ?? null,
    thirdSeller: rankedOffers[2]?.seller || null,
    sellerCount: offers.length > 1 ? offers.length : null,
    rank,
    hasMultipleSeller:
      offers.length > 1
        ? true
        : explicitMulti === false
          ? false
          : explicitMulti === true
            ? true
            : null,
  };
}

module.exports = {
  normalizeSeller,
  parseHepsiburadaPublicBuyboxHtml,
  parseTurkishPrice,
};
