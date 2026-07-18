const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const {
  normalizeText,
  tokens,
  diceCoefficient,
  extractPackCount,
  extractSizes,
  compareProducts,
  scaleRecipe,
  confidenceBand,
} = require("../domain/product-matching");
const {
  FILE_PRICE_MAX_AGE_DAYS,
  isSupplierPriceFresh,
} = require("../domain/file-market");
const {
  SUPPLIER_CODES,
  estimatePackageDesi,
  normalizePriceTiers,
  priceTierForQuantity,
  supplier,
} = require("../domain/supplier-products");
const {
  buildMappingLearningKey,
  buildMappingRecipeKey,
  mappingLearningAdjustment,
} = require("../domain/mapping-learning");

const ALGORITHM_VERSION = "multi-supplier-v1";

const PRODUCT_FAMILY_TOKENS = new Set([
  "actisoft",
  "aromali",
  "bahcesi",
  "daycare",
  "harras",
  "bulasik",
  "camasir",
  "cikolata",
  "cicegi",
  "dus",
  "jeli",
  "kolonya",
  "konsantre",
  "filtre",
  "kahve",
  "kokulu",
  "kokusu",
  "makinesi",
  "meyve",
  "oda",
  "parfum",
  "sabun",
  "sivi",
  "suyu",
  "tekli",
  "temizleyici",
  "yumusatici",
  "yuzey",
]);

const COMPOSITE_SPLIT_PATTERN = /\s+(?:ve|\+|\/|,)\s+/i;
const COMPOSITE_MARKER_PATTERN =
  /\b(?:set|karma|karisik|karışık|cesit|çeşit|cesitleri|çeşitleri|mix|ve)\b|(?:\s[+/,]\s)/i;

function filePriceMode(target, fileItem) {
  const targetVariants = tokens(target.product_name || target.item_name).filter(
    (token) => !PRODUCT_FAMILY_TOKENS.has(token),
  );
  const fileVariants = tokens(
    fileItem.product_name || fileItem.item_name,
  ).filter((token) => !PRODUCT_FAMILY_TOKENS.has(token));
  if (!targetVariants.length || !fileVariants.length) return "DIRECT";
  return targetVariants.some((token) => fileVariants.includes(token))
    ? "DIRECT"
    : "SIBLING_VARIANT";
}

function parsePrice(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "")
    .replace(/\s/g, "")
    .replace(/₺|TL|TRY/gi, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  return Number(normalized);
}

function cleanExplicitCorrectionName(value) {
  return String(value || "")
    .replace(
      /^(?:dogru|doğru|correct|olmasi gereken|olması gereken|urun|ürün)\s*[:\-–]\s*/i,
      "",
    )
    .replace(/^(?:ve|ile|,|;)\s*/i, "")
    .trim();
}

function parseExplicitCorrectionItems(reason) {
  const text = String(reason || "").replace(/\r/g, "\n");
  const matches = [];
  const pattern =
    /(.+?)\s*[-–:]\s*(\d+(?:[.,]\d{1,2})?)\s*(?:₺|tl|try)?(?=$|[;\n]|\s+ve\s+|,\s+(?!\d))/giu;
  let match;
  while ((match = pattern.exec(text))) {
    const productName = cleanExplicitCorrectionName(match[1]);
    const price = parsePrice(match[2]);
    if (
      productName &&
      productName.length >= 4 &&
      Number.isFinite(price) &&
      price > 0
    )
      matches.push({ productName, price });
  }
  return matches;
}

function canonicalSuggestion(suggestion) {
  return {
    barcode: suggestion.barcode,
    supplierCode: suggestion.supplier_code || "FILE_MARKET",
    sourceType: suggestion.source_type,
    sourceBarcode: suggestion.source_barcode || null,
    algorithmVersion: suggestion.algorithm_version,
    items: suggestion.items.map((item) => ({
      code: item.cost_item_code,
      quantity: Number(item.quantity),
      fileItemId: item.file_market_item_id || null,
      supplierCode:
        item.supplier_code || suggestion.supplier_code || "FILE_MARKET",
      supplierPrice: Number(
        item.supplier_effective_unit_price ||
          item.supplier_current_price ||
          item.file_current_price ||
          item.suggested_unit_cost ||
          0,
      ),
    })),
  };
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function generatedCostCode(fileItem) {
  const raw = normalizeText(`${fileItem.brand || ""} ${fileItem.product_name}`)
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("_")
    .toUpperCase();
  const size =
    fileItem.size_value && fileItem.size_unit
      ? `_${Number(fileItem.size_value).toLocaleString("tr-TR", {
          maximumFractionDigits: 0,
          useGrouping: false,
        })}${String(fileItem.size_unit).toUpperCase()}`
      : "";
  const supplierPrefix =
    fileItem.supplier_code && fileItem.supplier_code !== "FILE_MARKET"
      ? `${fileItem.supplier_code}_`
      : "";
  return `${supplierPrefix}${raw || "TEDARIKCI_URUN"}${size}`.replace(
    /[^A-Z0-9_]/g,
    "_",
  );
}

function uniqueCostCode(baseCode, item, index) {
  const suffix = item.file_market_item_id
    ? `_F${item.file_market_item_id}`
    : `_${index + 1}`;
  const clean = `${baseCode}${suffix}`.replace(/[^A-Z0-9_]/g, "_");
  return clean.length > 120 ? clean.slice(0, 120) : clean;
}

function ensureUniqueSuggestionItems(items) {
  const counts = new Map();
  for (const item of items)
    counts.set(item.cost_item_code, (counts.get(item.cost_item_code) || 0) + 1);
  const seen = new Map();
  return items.map((item, index) => {
    if ((counts.get(item.cost_item_code) || 0) <= 1) return item;
    const previous = seen.get(item.cost_item_code) || 0;
    seen.set(item.cost_item_code, previous + 1);
    return {
      ...item,
      original_cost_item_code:
        item.original_cost_item_code || item.cost_item_code,
      cost_item_code: uniqueCostCode(item.cost_item_code, item, index),
    };
  });
}

function remapEvidenceCostCodes(evidence = {}, items = []) {
  const byFileId = new Map(
    items
      .filter((item) => item.file_market_item_id)
      .map((item) => [String(item.file_market_item_id), item.cost_item_code]),
  );
  const byOriginalCode = new Map(
    items.map((item) => [
      item.original_cost_item_code || item.cost_item_code,
      item.cost_item_code,
    ]),
  );
  const fileMatches = (evidence.fileMatches || []).map((match) => {
    const nextCode =
      byFileId.get(
        String(match.fileMarketItemId || match.file_market_item_id),
      ) ||
      byOriginalCode.get(match.costItemCode) ||
      match.costItemCode;
    return { ...match, costItemCode: nextCode };
  });
  return { ...evidence, fileMatches };
}

function estimateUnitDesi(fileItem) {
  const stored = Number(fileItem.estimated_unit_desi);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const sizeValue = Number(fileItem.size_value);
  if (Number.isFinite(sizeValue) && sizeValue > 0)
    return Number(Math.max(sizeValue / 1000, 0.02).toFixed(4));
  return estimatePackageDesi(
    fileItem.product_name || fileItem.item_name || "",
    fileItem.unit_desi,
  ).value;
}

function supplierPriceForQuantity(fileItem, quantity = 1) {
  if (fileItem.supplier_code !== "BIZIM_MARKET")
    return priceTierForQuantity(fileItem.current_price, [], quantity);
  return priceTierForQuantity(
    fileItem.current_price,
    fileItem.price_tiers || [],
    quantity,
  );
}

function withSupplierPrice(item, fileItem, quantity = item.quantity || 1) {
  const price = supplierPriceForQuantity(fileItem, quantity);
  return {
    ...item,
    current_unit_cost: price.unitPrice,
    suggested_unit_cost: price.unitPrice,
    supplier_current_price: Number(fileItem.current_price),
    supplier_effective_unit_price: price.unitPrice,
    supplier_price_tiers: price.tiers,
    selected_price_tier: price.tier,
  };
}

function extractExplicitBundleCount(value) {
  const text = normalizeText(value);
  const patterns = [
    /\b(\d+(?:[.,]\d+)?)\s*(?:adet|paket)\b/,
    /\b(\d+(?:[.,]\d+)?)\s*x\s*\d+(?:[.,]\d+)?\s*(?:ml|lt|l|gr|g|kg)\b/,
    /\b\d+(?:[.,]\d+)?\s*(?:ml|lt|l|gr|g|kg)\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:adet|paket)?\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(String(match[1]).replace(",", "."));
    if (Number.isFinite(count) && count > 0 && count <= 1000) return count;
  }
  return null;
}

function extractInternalPackCount(value) {
  const match = normalizeText(value).match(/\b(\d+)\s*(?:li|lu)\b/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 && count <= 1000 ? count : null;
}

function fileBackedQuantity(target, fileItem) {
  const explicit = extractExplicitBundleCount(target.product_name);
  const fileExplicit = extractExplicitBundleCount(fileItem.product_name);
  const targetInternal = extractInternalPackCount(target.product_name);
  const fileInternal = extractInternalPackCount(fileItem.product_name);
  if (explicit && fileExplicit && explicit === fileExplicit) return 1;
  if (explicit && fileInternal && explicit === fileInternal) return 1;
  if (explicit) return explicit;
  if (targetInternal && fileInternal && targetInternal === fileInternal)
    return 1;
  return extractPackCount(target.product_name);
}

function learnedRecipeScale(sourceProduct, targetProduct) {
  const sourceExplicit = extractExplicitBundleCount(sourceProduct.product_name);
  const targetExplicit = extractExplicitBundleCount(targetProduct.product_name);
  const sourceInternal = extractInternalPackCount(sourceProduct.product_name);
  const targetInternal = extractInternalPackCount(targetProduct.product_name);
  if (targetExplicit) {
    if (sourceExplicit) return targetExplicit / sourceExplicit;
    if (sourceInternal && sourceInternal === targetInternal)
      return targetExplicit;
  }
  if (sourceExplicit && targetInternal && sourceExplicit === targetInternal)
    return 1 / sourceExplicit;
  return null;
}

function scaleLearnedRecipe(sourceProduct, targetProduct, recipe) {
  const scale = learnedRecipeScale(sourceProduct, targetProduct);
  if (!Number.isFinite(scale) || scale <= 0)
    return scaleRecipe(sourceProduct, targetProduct, recipe);
  return recipe.map((item) => ({
    ...item,
    quantity: Number((Number(item.quantity) * scale).toFixed(4)),
  }));
}

function significantProductTokens(value, brand = "") {
  const brandTokens = new Set(tokens(brand));
  return tokens(value).filter(
    (token) =>
      token.length > 2 &&
      !brandTokens.has(token) &&
      !PRODUCT_FAMILY_TOKENS.has(token),
  );
}

function splitCompositeFragments(value) {
  const normalized = normalizeText(value);
  if (!COMPOSITE_MARKER_PATTERN.test(normalized)) return [];
  return String(value || "")
    .split(COMPOSITE_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter((part) => significantProductTokens(part).length >= 1)
    .slice(0, 6);
}

function sameSizeValue(left, right) {
  if (!left || !right) return false;
  return (
    left.unit === right.unit &&
    Math.abs(left.value - right.value) <=
      Math.max(left.value, right.value) * 0.03
  );
}

function targetHasSize(targetSizes, itemSize) {
  if (!itemSize) return true;
  return targetSizes.some((size) => sameSizeValue(size, itemSize));
}

function productFamilySignature(value, brand = "") {
  const sizeTokens = new Set(
    extractSizes(value).map((size) => `${Math.round(size.value)}${size.unit}`),
  );
  const family = tokens(value)
    .filter((token) => !tokens(brand).includes(token))
    .filter(
      (token) => PRODUCT_FAMILY_TOKENS.has(token) || sizeTokens.has(token),
    )
    .slice(0, 5);
  return family.join("_") || normalizeText(brand) || "file";
}

function normalizedProductIdentity(fileItem) {
  return normalizeText(fileItem.product_name)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|lt|l|gr|g|kg)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compositeSingleItemRisk(target, items) {
  if (items.length !== 1) return null;
  const text = normalizeText(target.product_name);
  if (!COMPOSITE_MARKER_PATTERN.test(text)) return null;
  const fragments = splitCompositeFragments(target.product_name);
  const targetTokens = significantProductTokens(
    target.product_name,
    target.brand,
  );
  if (targetTokens.length < 3) return null;
  const candidateTokens = new Set(
    significantProductTokens(
      `${items[0].file_product_name || ""} ${items[0].item_name || ""} ${items[0].cost_item_code || ""}`,
      target.brand,
    ),
  );
  const missing = targetTokens.filter((token) => !candidateTokens.has(token));
  const missingRatio = missing.length / targetTokens.length;
  if (fragments.length >= 2 && missing.length >= 1)
    return {
      missingTokens: missing.slice(0, 8),
      missingRatio: Number(missingRatio.toFixed(4)),
      fragments,
    };
  if (missing.length < 2 && missingRatio < 0.45) return null;
  return {
    missingTokens: missing.slice(0, 8),
    missingRatio: Number(missingRatio.toFixed(4)),
    fragments,
  };
}

function sortCandidatesForTarget(target, left, right) {
  const leftExplicit = Boolean(left.evidence?.explicitFeedbackRecipe);
  const rightExplicit = Boolean(right.evidence?.explicitFeedbackRecipe);
  if (leftExplicit !== rightExplicit) return rightExplicit - leftExplicit;
  const targetComposite = COMPOSITE_MARKER_PATTERN.test(
    normalizeText(target.product_name),
  );
  if (targetComposite) {
    const leftComposite =
      Boolean(left.evidence?.compositeProduct) && left.items.length > 1;
    const rightComposite =
      Boolean(right.evidence?.compositeProduct) && right.items.length > 1;
    if (leftComposite !== rightComposite) return rightComposite - leftComposite;
    if (
      leftComposite &&
      rightComposite &&
      left.items.length !== right.items.length
    )
      return right.items.length - left.items.length;
  }
  return right.confidence - left.confidence;
}

const FEEDBACK_HINT_STOP_WORDS = new Set([
  "bu",
  "icin",
  "ile",
  "oldu",
  "olan",
  "olarak",
  "olmali",
  "urun",
  "urunu",
  "fiyat",
  "fiyati",
  "file",
  "market",
  "mapping",
  "onerisi",
  "sistem",
  "yanlis",
]);

function extractHintFragment(text) {
  const patterns = [
    /\b(?:dogru urun|dogrusu|olmasi gereken|olması gereken)\s+(.+)$/,
    /\b(?:aslinda|aslında)\s+(.+)$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function extractNegativeHintFragment(text) {
  const patterns = [
    /\b(.+?)\s+(?:degil|değil|yanlis|yanlış)\b/,
    /\b(.+?)\s+(?:ile|le|la)\s+karistir/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function noteTokens(value) {
  return tokens(value).filter((token) => !FEEDBACK_HINT_STOP_WORDS.has(token));
}

function parseRejectionHint(row) {
  const raw = String(row.reason || "");
  const text = normalizeText(raw);
  const positive = extractHintFragment(text);
  const negative = extractNegativeHintFragment(text);
  return {
    barcode: row.barcode,
    created_at: row.created_at,
    forceQuantityOne:
      /\b(?:adet\s*1|1\s*adet|tek\s*adet|tekli|ic\s*paket|iç\s*paket|paket\s*icerigi|paketin\s*icerigi|iceriginde|içeriğinde)\b/.test(
        text,
      ),
    preferredTokens: noteTokens(positive),
    rejectedTokens: noteTokens(negative),
    explicitItems: parseExplicitCorrectionItems(raw),
    reason: raw,
  };
}

function scoreTokensAgainstItems(hintTokens, candidate) {
  if (!hintTokens.length) return 0;
  return Math.max(
    0,
    ...candidate.items.map((item) =>
      diceCoefficient(
        hintTokens,
        noteTokens(
          `${item.file_product_name || ""} ${item.item_name || ""} ${item.cost_item_code || ""}`,
        ),
      ),
    ),
  );
}

function applyRejectionHints(candidate, hints = []) {
  if (!hints.length) return candidate;
  let quantityOne = false;
  let boost = 0;
  let penalty = 0;
  const matched = [];
  for (const hint of hints) {
    if (hint.forceQuantityOne) quantityOne = true;
    const preferredScore = scoreTokensAgainstItems(
      hint.preferredTokens,
      candidate,
    );
    const rejectedScore = scoreTokensAgainstItems(
      hint.rejectedTokens,
      candidate,
    );
    if (preferredScore >= 0.28) {
      boost += Math.min(preferredScore * 0.22, 0.18);
      matched.push("PREFERRED_PRODUCT_NOTE");
    }
    if (rejectedScore >= 0.28) {
      penalty += Math.min(rejectedScore * 0.2, 0.16);
      matched.push("REJECTED_PRODUCT_NOTE");
    }
  }
  if (!quantityOne && boost === 0 && penalty === 0) return candidate;
  return {
    ...candidate,
    confidence: Math.max(
      0.3,
      Math.min(0.95, candidate.confidence + boost - penalty),
    ),
    items: quantityOne
      ? candidate.items.map((item) => ({ ...item, quantity: 1 }))
      : candidate.items,
    evidence: {
      ...candidate.evidence,
      rejectionNoteHints: {
        quantityForcedToOne: quantityOne,
        confidenceBoost: Number(boost.toFixed(5)),
        confidencePenalty: Number(penalty.toFixed(5)),
        matched: [...new Set(matched)],
      },
    },
  };
}

class MappingAutomationService {
  constructor({ repository, costs, costEngine }) {
    this.repository = repository;
    this.costs = costs;
    this.costEngine = costEngine;
  }

  normalizeSupplierRows(supplierCode, rows) {
    const supplierDefinition = supplier(supplierCode);
    if (!supplierDefinition)
      throw new AppError(
        "Tedarikçi havuzu geçersiz",
        400,
        "INVALID_SUPPLIER_CODE",
      );
    if (!Array.isArray(rows) || !rows.length)
      throw new AppError(
        `${supplierDefinition.label} ürün listesi boş`,
        400,
        "EMPTY_SUPPLIER_ITEMS",
      );
    if (rows.length > 10000)
      throw new AppError(
        "Tek işlemde en fazla 10000 tedarikçi ürünü yüklenebilir",
        400,
        "TOO_MANY_SUPPLIER_ITEMS",
      );
    const seen = new Set();
    return rows.map((row, index) => {
      const productName = String(row.product_name || row.name || "").trim();
      const normalizedName = normalizeText(productName);
      const currentPrice = parsePrice(row.current_price ?? row.price);
      const observedAt = row.observed_at
        ? new Date(row.observed_at)
        : new Date();
      if (
        !productName ||
        !normalizedName ||
        !Number.isFinite(currentPrice) ||
        currentPrice <= 0 ||
        Number.isNaN(observedAt.getTime())
      )
        throw new AppError(
          `${index + 1}. ${supplierDefinition.label} ürün satırı geçersiz`,
          400,
          "INVALID_SUPPLIER_ITEM",
        );
      const sourceKey = String(
        row.source_key ||
          (supplierCode === "FILE_MARKET"
            ? crypto.createHash("sha1").update(normalizedName).digest("hex")
            : `${supplierCode.toLowerCase()}:${crypto
                .createHash("sha1")
                .update(normalizedName)
                .digest("hex")}`),
      ).trim();
      if (seen.has(sourceKey))
        throw new AppError(
          `${index + 1}. ${supplierDefinition.label} ürünü aynı yüklemede tekrarlanmış`,
          400,
          "DUPLICATE_SUPPLIER_ITEM",
        );
      seen.add(sourceKey);
      const size = extractSizes(productName)[0];
      const desi = estimatePackageDesi(
        productName,
        row.estimated_unit_desi ?? row.unit_desi,
      );
      const priceTiers =
        supplierCode === "BIZIM_MARKET"
          ? normalizePriceTiers(
              row.price_tiers ||
                row.priceTiers ||
                row.bulk_prices ||
                row.bulkPrices ||
                row.tier_prices ||
                row.tierPrices ||
                row.raw_data?.price_tiers ||
                [],
            )
          : [];
      return {
        source_key: sourceKey,
        product_name: productName,
        normalized_name: normalizedName,
        brand: String(row.brand || productName.split(/\s+/)[0] || "").trim(),
        size_value: size?.value || null,
        size_unit: size?.unit || null,
        current_price: Number(currentPrice.toFixed(2)),
        currency: "TRY",
        availability: String(row.availability || "AVAILABLE").toUpperCase(),
        raw_data: row.raw_data || row,
        observed_at: observedAt.toISOString(),
        supplier_code: supplierCode,
        source_url: row.source_url || null,
        source_category: row.source_category || null,
        estimated_unit_desi: desi.value,
        desi_confidence: row.desi_confidence || desi.confidence,
        price_tiers: priceTiers,
      };
    });
  }

  async updateSupplierItemPricing(supplierCode, id, input = {}) {
    const normalizedCode = String(supplierCode || "").toUpperCase();
    if (!SUPPLIER_CODES.includes(normalizedCode))
      throw new AppError(
        "Tedarikçi havuzu geçersiz",
        400,
        "INVALID_SUPPLIER_CODE",
      );
    if (normalizedCode !== "BIZIM_MARKET")
      throw new AppError(
        "Çoklu alım fiyat kademesi yalnız Bizim Toptan için kullanılır",
        400,
        "SUPPLIER_TIERS_ONLY_BIZIM",
      );
    const currentPrice =
      input.current_price === undefined
        ? undefined
        : parsePrice(input.current_price);
    if (
      currentPrice !== undefined &&
      (!Number.isFinite(currentPrice) || currentPrice <= 0)
    )
      throw new AppError(
        "Güncel fiyat pozitif olmalı",
        400,
        "INVALID_SUPPLIER_PRICE",
      );
    const priceTiers = normalizePriceTiers(input.price_tiers || []);
    const updated = await this.repository.updateSupplierItemPricing(
      normalizedCode,
      id,
      {
        current_price:
          currentPrice === undefined
            ? undefined
            : Number(currentPrice.toFixed(2)),
        price_tiers: priceTiers,
      },
    );
    if (!updated) return null;
    const updatedBarcodes = [
      ...new Set((updated?.tier_price_updates || []).map((row) => row.barcode)),
    ];
    for (const barcode of updatedBarcodes)
      await this.costEngine.recalculate(barcode);
    return {
      ...updated,
      recalculated_barcodes: updatedBarcodes,
    };
  }

  normalizeFileRows(rows) {
    return this.normalizeSupplierRows("FILE_MARKET", rows);
  }

  async importSupplierItems(supplierCode, rows, options = {}) {
    const normalizedCode = String(supplierCode || "").toUpperCase();
    return this.repository.importSupplierItems(
      normalizedCode,
      this.normalizeSupplierRows(normalizedCode, rows),
      options,
    );
  }

  async importFileItems(rows) {
    return this.importSupplierItems("FILE_MARKET", rows);
  }

  async syncLiveFileItems(fileMarket) {
    const live = await fileMarket.livePriceRows();
    const imported = await this.importSupplierItems("FILE_MARKET", live.rows, {
      replaceAvailability: Boolean(live.fullSnapshot),
    });
    return {
      ...imported,
      metadata: {
        ...live.stats,
        provider: "file-market-api",
      },
    };
  }

  async listFileItems(filters) {
    return this.listSupplierItems("FILE_MARKET", filters);
  }

  async syncLiveSupplierItems(supplierCode, sourceService) {
    const normalizedCode = String(supplierCode || "").toUpperCase();
    const definition = supplier(normalizedCode);
    if (!definition)
      throw new AppError(
        "Tedarikçi havuzu geçersiz",
        400,
        "INVALID_SUPPLIER_CODE",
      );
    if (!sourceService?.livePriceRows)
      throw new AppError(
        `${definition.label} için canlı katalog kaynağı yapılandırılmamış`,
        409,
        "SUPPLIER_LIVE_SOURCE_UNAVAILABLE",
      );
    const live = await sourceService.livePriceRows();
    const imported = await this.importSupplierItems(normalizedCode, live.rows, {
      replaceAvailability: Boolean(live.fullSnapshot),
    });
    return {
      ...imported,
      metadata: {
        ...live.stats,
        supplierCode: normalizedCode,
      },
    };
  }

  async listSupplierItems(supplierCode, filters) {
    const normalizedCode = String(supplierCode || "").toUpperCase();
    if (!SUPPLIER_CODES.includes(normalizedCode))
      throw new AppError(
        "Tedarikçi havuzu geçersiz",
        400,
        "INVALID_SUPPLIER_CODE",
      );
    return this.repository.listSupplierItems({
      ...filters,
      supplierCode: normalizedCode,
    });
  }

  groupTrainingRows(rows) {
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.barcode))
        grouped.set(row.barcode, {
          barcode: row.barcode,
          product_name: row.product_name,
          brand: row.brand,
          category_id: row.category_id,
          category_name: row.category_name,
          recipe: [],
        });
      grouped.get(row.barcode).recipe.push({
        cost_item_code: row.cost_item_code,
        item_name: row.item_name,
        quantity: Number(row.quantity),
        current_unit_cost: Number(row.unit_cost),
        unit_desi: Number(row.unit_desi),
      });
    }
    return [...grouped.values()];
  }

  bestFileMatch(target, item, fileItems) {
    let best = null;
    const itemIdentity = {
      product_name: `${item.item_name || ""} ${item.cost_item_code || ""}`,
    };
    for (const fileItem of fileItems) {
      const itemMatch = compareProducts(itemIdentity, fileItem);
      const targetMatch = compareProducts(target, fileItem);
      const score = itemMatch.score * 0.65 + targetMatch.score * 0.35;
      if (!best || score > best.score)
        best = {
          item: fileItem,
          score,
          itemMatch,
          targetMatch,
          priceMode: filePriceMode(target, fileItem),
        };
    }
    return best && best.score >= 0.36 ? best : null;
  }

  enrichRecipe(target, recipe, fileItems) {
    return recipe.map((item) => {
      const fileMatch = this.bestFileMatch(target, item, fileItems);
      return {
        ...item,
        file_market_item_id: fileMatch?.item.id || null,
        suggested_unit_cost: fileMatch
          ? supplierPriceForQuantity(fileMatch.item, item.quantity).unitPrice
          : Number(item.current_unit_cost),
        file_match_score: fileMatch ? Number(fileMatch.score.toFixed(5)) : null,
        file_product_name: fileMatch?.item.product_name || null,
        supplier_product_name: fileMatch?.item.product_name || null,
        supplier_code: fileMatch?.item.supplier_code || null,
        supplier_current_price: fileMatch
          ? Number(fileMatch.item.current_price)
          : null,
        supplier_effective_unit_price: fileMatch
          ? supplierPriceForQuantity(fileMatch.item, item.quantity).unitPrice
          : null,
        supplier_price_tiers: fileMatch
          ? normalizePriceTiers(fileMatch.item.price_tiers || [])
          : [],
        selected_price_tier: fileMatch
          ? supplierPriceForQuantity(fileMatch.item, item.quantity).tier
          : null,
        supplier_estimated_unit_desi:
          fileMatch?.item.estimated_unit_desi || null,
        desi_confidence: fileMatch?.item.desi_confidence || null,
        file_price_mode: fileMatch?.priceMode || null,
      };
    });
  }

  buildTrainingCandidate(target, example, comparison, fileItems) {
    if (comparison.score < 0.42) return null;
    const scaled = scaleLearnedRecipe(example, target, example.recipe);
    const items = this.enrichRecipe(target, scaled, fileItems);
    const supported = items.filter((item) => item.file_market_item_id);
    const fileSupport = supported.length
      ? supported.reduce((sum, item) => sum + item.file_match_score, 0) /
        items.length
      : 0;
    const confidence = Math.min(1, comparison.score * 0.9 + fileSupport * 0.1);
    const variantPriceInferred = items.some(
      (item) => item.file_price_mode === "SIBLING_VARIANT",
    );
    return {
      confidence,
      source_type: supported.length
        ? "MANUAL_HISTORY_AND_FILE"
        : "MANUAL_HISTORY",
      source_barcode: example.barcode,
      items,
      evidence: {
        sourceProductName: example.product_name,
        reasons: comparison.reasons,
        sourcePackCount: comparison.candidatePackCount,
        targetPackCount: comparison.targetPackCount,
        fileMatches: items
          .filter((item) => item.file_market_item_id)
          .map((item) => ({
            costItemCode: item.cost_item_code,
            fileMarketItemId: item.file_market_item_id,
            fileProductName: item.file_product_name,
            score: item.file_match_score,
            priceMode: item.file_price_mode,
          })),
        variantPriceInferred,
      },
    };
  }

  buildTrainingCandidates(target, examples, fileItems) {
    return examples
      .map((example) => ({
        example,
        comparison: compareProducts(target, example),
      }))
      .sort((left, right) => right.comparison.score - left.comparison.score)
      .map(({ example, comparison }) =>
        this.buildTrainingCandidate(target, example, comparison, fileItems),
      )
      .filter(Boolean);
  }

  buildFromTraining(target, examples, fileItems) {
    return this.buildTrainingCandidates(target, examples, fileItems)[0] || null;
  }

  bestFileItemForExplicitCorrection(correction, fileItems, usedIds) {
    let best = null;
    const correctionTarget = {
      product_name: correction.productName,
      brand: tokens(correction.productName)[0] || "",
    };
    for (const fileItem of fileItems) {
      if (usedIds.has(fileItem.id)) continue;
      const comparison = compareProducts(correctionTarget, fileItem);
      const filePrice = Number(fileItem.current_price);
      const priceDistance =
        Number.isFinite(filePrice) && filePrice > 0
          ? Math.abs(filePrice - correction.price)
          : Number.POSITIVE_INFINITY;
      const priceTolerance = Math.max(1, correction.price * 0.08);
      const priceScore =
        priceDistance <= priceTolerance
          ? 1 - priceDistance / priceTolerance
          : 0;
      const score = comparison.score * 0.78 + priceScore * 0.22;
      if (comparison.score < 0.38 && priceScore < 0.65) continue;
      if (!best || score > best.score)
        best = { fileItem, comparison, priceScore, score };
    }
    return best;
  }

  buildFromFeedbackCorrection(target, hints, fileItems) {
    const latestExplicitHint = [...(hints || [])]
      .filter((hint) => hint.explicitItems?.length)
      .sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() -
          new Date(left.created_at || 0).getTime(),
      )[0];
    const corrections = (latestExplicitHint?.explicitItems || []).filter(
      Boolean,
    );
    if (!corrections.length) return null;
    const usedIds = new Set();
    const usedProductIdentities = new Set();
    const matched = [];
    for (const correction of corrections) {
      const best = this.bestFileItemForExplicitCorrection(
        correction,
        fileItems,
        usedIds,
      );
      if (!best) continue;
      const identity = normalizedProductIdentity(best.fileItem);
      if (identity && usedProductIdentities.has(identity)) continue;
      usedIds.add(best.fileItem.id);
      if (identity) usedProductIdentities.add(identity);
      matched.push({ correction, ...best });
    }
    if (!matched.length) return null;
    const avgScore =
      matched.reduce((sum, item) => sum + item.score, 0) / matched.length;
    const items = matched.map(({ correction, fileItem, comparison }) => {
      const unitDesi = estimateUnitDesi(fileItem);
      return withSupplierPrice(
        {
          cost_item_code: generatedCostCode(fileItem),
          item_name: fileItem.product_name,
          quantity: 1,
          unit_desi: unitDesi,
          file_market_item_id: fileItem.id,
          supplier_code: fileItem.supplier_code || "FILE_MARKET",
          file_match_score: comparison.score,
          file_product_name: fileItem.product_name,
          supplier_product_name: fileItem.product_name,
          supplier_estimated_unit_desi:
            fileItem.estimated_unit_desi || unitDesi,
          desi_confidence: fileItem.desi_confidence || "LOW",
          file_price_mode: "DIRECT",
          creates_cost_item: true,
        },
        fileItem,
        1,
      );
    });
    return {
      confidence: Math.min(0.94, Math.max(0.74, avgScore)),
      source_type: "FEEDBACK_EXPLICIT_FILE_RECIPE",
      source_barcode: null,
      items,
      evidence: {
        reasons: [{ code: "EXPLICIT_REJECTION_NOTE_RECIPE" }],
        explicitFeedbackRecipe: true,
        targetPackCount: extractPackCount(target.product_name),
        correctedItems: matched.map(
          ({ correction, fileItem, comparison, priceScore }) => ({
            noteProductName: correction.productName,
            notePrice: correction.price,
            fileMarketItemId: fileItem.id,
            fileProductName: fileItem.product_name,
            fileCurrentPrice: Number(fileItem.current_price),
            score: comparison.score,
            priceScore,
          }),
        ),
        fileMatches: items.map((item) => ({
          costItemCode: item.cost_item_code,
          fileMarketItemId: item.file_market_item_id,
          fileProductName: item.file_product_name,
          score: item.file_match_score,
          priceMode: "DIRECT",
          createsCostItem: true,
          estimatedUnitDesi: item.unit_desi,
        })),
        variantPriceInferred: false,
        createsCostItem: true,
        compositeProduct: items.length > 1,
      },
    };
  }

  buildFromCostItems(target, costItems, fileItems) {
    let best = null;
    for (const item of costItems) {
      const comparison = compareProducts(target, {
        product_name: `${item.item_name} ${item.item_code}`,
      });
      if (!best || comparison.score > best.comparison.score)
        best = { item, comparison };
    }
    if (!best || best.comparison.score < 0.36) return null;
    const items = this.enrichRecipe(
      target,
      [
        {
          cost_item_code: best.item.item_code,
          item_name: best.item.item_name,
          quantity: extractPackCount(target.product_name),
          current_unit_cost: Number(best.item.unit_cost),
          unit_desi: Number(best.item.unit_desi),
        },
      ],
      fileItems,
    ).map((item) => {
      if (!item.file_market_item_id) return item;
      const fileItem = fileItems.find(
        (candidate) => candidate.id === item.file_market_item_id,
      );
      const quantity = fileBackedQuantity(target, {
        product_name: item.file_product_name || "",
      });
      return fileItem
        ? withSupplierPrice({ ...item, quantity }, fileItem, quantity)
        : { ...item, quantity };
    });
    const fileSupport = items[0].file_match_score || 0;
    const variantPriceInferred = items[0].file_price_mode === "SIBLING_VARIANT";
    const confidence = Math.min(
      1,
      best.comparison.score * 0.85 + fileSupport * 0.15,
    );
    return {
      confidence,
      source_type: items[0].file_market_item_id
        ? "FILE_MARKET"
        : "COST_ITEM_CATALOG",
      source_barcode: null,
      items,
      evidence: {
        reasons: best.comparison.reasons,
        targetPackCount: extractPackCount(target.product_name),
        fileMatches: items[0].file_market_item_id
          ? [
              {
                costItemCode: items[0].cost_item_code,
                fileMarketItemId: items[0].file_market_item_id,
                fileProductName: items[0].file_product_name,
                score: items[0].file_match_score,
                priceMode: items[0].file_price_mode,
              },
            ]
          : [],
        variantPriceInferred,
      },
    };
  }

  buildFromFileItems(target, fileItems, { minScore = 0.54 } = {}) {
    return fileItems
      .map((fileItem) => ({
        fileItem,
        comparison: compareProducts(target, fileItem),
      }))
      .filter(({ comparison }) => comparison.score >= minScore)
      .sort((left, right) => right.comparison.score - left.comparison.score)
      .map(({ fileItem, comparison }) => {
        const unitDesi = estimateUnitDesi(fileItem);
        const quantity = fileBackedQuantity(target, fileItem);
        return {
          confidence: Math.min(0.88, comparison.score),
          source_type: "FILE_DIRECT_COST_ITEM",
          source_barcode: null,
          items: [
            withSupplierPrice(
              {
                cost_item_code: generatedCostCode(fileItem),
                item_name: fileItem.product_name,
                quantity,
                unit_desi: unitDesi,
                file_market_item_id: fileItem.id,
                supplier_code: fileItem.supplier_code || "FILE_MARKET",
                file_match_score: comparison.score,
                file_product_name: fileItem.product_name,
                supplier_product_name: fileItem.product_name,
                supplier_estimated_unit_desi:
                  fileItem.estimated_unit_desi || unitDesi,
                desi_confidence: fileItem.desi_confidence || "LOW",
                file_price_mode: "DIRECT",
                creates_cost_item: true,
              },
              fileItem,
              quantity,
            ),
          ],
          evidence: {
            reasons: comparison.reasons,
            targetPackCount: comparison.targetPackCount,
            fileMatches: [
              {
                costItemCode: generatedCostCode(fileItem),
                fileMarketItemId: fileItem.id,
                fileProductName: fileItem.product_name,
                score: comparison.score,
                priceMode: "DIRECT",
                createsCostItem: true,
                estimatedUnitDesi: unitDesi,
              },
            ],
            variantPriceInferred: false,
            createsCostItem: true,
          },
        };
      });
  }

  buildFromCompositeFileItems(target, fileItems) {
    const fragments = splitCompositeFragments(target.product_name);
    if (fragments.length < 2) return null;
    const used = new Set();
    const matched = [];
    for (const fragment of fragments) {
      const fragmentTarget = {
        ...target,
        product_name: target.brand ? `${target.brand} ${fragment}` : fragment,
      };
      const best = fileItems
        .map((fileItem) => ({
          fileItem,
          comparison: compareProducts(fragmentTarget, fileItem),
        }))
        .filter(
          ({ fileItem, comparison }) =>
            comparison.score >= 0.54 && !used.has(fileItem.id),
        )
        .sort(
          (left, right) => right.comparison.score - left.comparison.score,
        )[0];
      if (!best) continue;
      used.add(best.fileItem.id);
      matched.push({ fragment, ...best });
    }
    if (matched.length < 2) return null;
    const avgScore =
      matched.reduce((sum, item) => sum + item.comparison.score, 0) /
      matched.length;
    const confidence = Math.min(0.86, avgScore * 0.92);
    const items = matched.map(({ fragment, fileItem, comparison }) => {
      const unitDesi = estimateUnitDesi(fileItem);
      const quantity = fileBackedQuantity({ product_name: fragment }, fileItem);
      return withSupplierPrice(
        {
          cost_item_code: generatedCostCode(fileItem),
          item_name: fileItem.product_name,
          quantity,
          unit_desi: unitDesi,
          file_market_item_id: fileItem.id,
          supplier_code: fileItem.supplier_code || "FILE_MARKET",
          file_match_score: comparison.score,
          file_product_name: fileItem.product_name,
          supplier_product_name: fileItem.product_name,
          supplier_estimated_unit_desi:
            fileItem.estimated_unit_desi || unitDesi,
          desi_confidence: fileItem.desi_confidence || "LOW",
          file_price_mode: "DIRECT",
          creates_cost_item: true,
        },
        fileItem,
        quantity,
      );
    });
    return {
      confidence,
      source_type: "FILE_COMPOSITE_COST_ITEMS",
      source_barcode: null,
      items,
      evidence: {
        reasons: [{ code: "COMPOSITE_FILE_MATCH" }],
        targetPackCount: extractPackCount(target.product_name),
        compositeFragments: matched.map(
          ({ fragment, fileItem, comparison }) => ({
            fragment,
            fileProductName: fileItem.product_name,
            score: comparison.score,
          }),
        ),
        fileMatches: items.map((item) => ({
          costItemCode: item.cost_item_code,
          fileMarketItemId: item.file_market_item_id,
          fileProductName: item.file_product_name,
          score: item.file_match_score,
          priceMode: "DIRECT",
          createsCostItem: true,
          estimatedUnitDesi: item.unit_desi,
        })),
        variantPriceInferred: false,
        createsCostItem: true,
        compositeProduct: true,
      },
    };
  }

  buildFromMultiVariantFileItems(target, fileItems) {
    const targetText = normalizeText(target.product_name);
    if (!COMPOSITE_MARKER_PATTERN.test(targetText)) return null;
    const targetTokens = new Set(
      significantProductTokens(target.product_name, target.brand),
    );
    const targetSizes = extractSizes(target.product_name);
    const targetBrand = normalizeText(target.brand);
    const candidates = fileItems
      .map((fileItem) => {
        const itemTokens = significantProductTokens(
          fileItem.product_name,
          fileItem.brand,
        );
        const itemSize = extractSizes(fileItem.product_name)[0];
        const overlap = itemTokens.filter((token) => targetTokens.has(token));
        const coverage = itemTokens.length
          ? overlap.length / itemTokens.length
          : 0;
        const comparison = compareProducts(target, fileItem);
        const brandMatches =
          !targetBrand ||
          normalizeText(fileItem.brand) === targetBrand ||
          normalizeText(fileItem.product_name).includes(targetBrand);
        return {
          fileItem,
          comparison,
          itemTokens,
          itemSize,
          overlap,
          coverage,
          brandMatches,
        };
      })
      .filter(
        (candidate) =>
          candidate.brandMatches &&
          targetHasSize(targetSizes, candidate.itemSize) &&
          candidate.overlap.length >= 1 &&
          candidate.coverage >= 0.5 &&
          (candidate.comparison.score >= 0.42 ||
            (candidate.coverage >= 0.9 && candidate.comparison.score >= 0.32)),
      )
      .sort((left, right) => {
        if (right.overlap.length !== left.overlap.length)
          return right.overlap.length - left.overlap.length;
        return right.comparison.score - left.comparison.score;
      });
    if (candidates.length < 2) return null;

    const selected = [];
    const used = new Set();
    const usedProductIdentities = new Set();
    for (const candidate of candidates) {
      const key = String(candidate.fileItem.id);
      const identity = normalizedProductIdentity(candidate.fileItem);
      if (used.has(key)) continue;
      if (identity && usedProductIdentities.has(identity)) continue;
      selected.push(candidate);
      used.add(key);
      if (identity) usedProductIdentities.add(identity);
      if (selected.length >= 6) break;
    }
    if (selected.length < 2) return null;
    const avgScore =
      selected.reduce((sum, item) => sum + item.comparison.score, 0) /
      selected.length;
    const items = selected.map(({ fileItem, comparison }) => {
      const unitDesi = estimateUnitDesi(fileItem);
      return withSupplierPrice(
        {
          cost_item_code: generatedCostCode(fileItem),
          item_name: fileItem.product_name,
          quantity: 1,
          unit_desi: unitDesi,
          file_market_item_id: fileItem.id,
          supplier_code: fileItem.supplier_code || "FILE_MARKET",
          file_match_score: comparison.score,
          file_product_name: fileItem.product_name,
          supplier_product_name: fileItem.product_name,
          supplier_estimated_unit_desi:
            fileItem.estimated_unit_desi || unitDesi,
          desi_confidence: fileItem.desi_confidence || "LOW",
          file_price_mode: "DIRECT",
          creates_cost_item: true,
        },
        fileItem,
        1,
      );
    });
    return {
      confidence: Math.min(0.84, avgScore * 0.9),
      source_type: "FILE_MULTI_VARIANT_COST_ITEMS",
      source_barcode: null,
      items,
      evidence: {
        reasons: [{ code: "MULTI_VARIANT_FILE_MATCH" }],
        targetPackCount: extractPackCount(target.product_name),
        familySignature: productFamilySignature(
          target.product_name,
          target.brand,
        ),
        variantMatches: selected.map(({ fileItem, comparison, overlap }) => ({
          fileProductName: fileItem.product_name,
          score: comparison.score,
          matchedTokens: overlap,
        })),
        fileMatches: items.map((item) => ({
          costItemCode: item.cost_item_code,
          fileMarketItemId: item.file_market_item_id,
          fileProductName: item.file_product_name,
          score: item.file_match_score,
          priceMode: "DIRECT",
          createsCostItem: true,
          estimatedUnitDesi: item.unit_desi,
        })),
        variantPriceInferred: false,
        createsCostItem: true,
        compositeProduct: true,
        multiVariantProduct: true,
      },
    };
  }

  applyCompositeSafety(target, candidate) {
    const risk = compositeSingleItemRisk(target, candidate.items);
    if (!risk) return candidate;
    return {
      ...candidate,
      confidence: Math.min(candidate.confidence, 0.69),
      evidence: {
        ...candidate.evidence,
        compositeReviewNeeded: true,
        compositeRisk: risk,
      },
    };
  }

  buildSuggestion(target, candidate) {
    const baseConfidence = Number(candidate.confidence.toFixed(5));
    const items = ensureUniqueSuggestionItems(candidate.items);
    const fileIds = [
      ...new Set(items.map((item) => item.file_market_item_id).filter(Boolean)),
    ];
    const manualHistoryOnly =
      candidate.source_type === "MANUAL_HISTORY" &&
      items.every(
        (item) =>
          item.cost_item_code &&
          Number(item.current_unit_cost) > 0 &&
          Number(item.unit_desi) > 0,
      );
    if (!fileIds.length && !manualHistoryOnly) return null;
    const suggestion = {
      barcode: target.barcode,
      base_confidence: baseConfidence,
      algorithm_version: ALGORITHM_VERSION,
      source_type: candidate.source_type,
      source_barcode: candidate.source_barcode,
      file_market_item_id: fileIds.length === 1 ? fileIds[0] : null,
      supplier_code:
        candidate.supplier_code ||
        items[0]?.supplier_code ||
        (manualHistoryOnly ? null : "FILE_MARKET"),
      update_file_price: fileIds.length > 0,
      evidence: remapEvidenceCostCodes(candidate.evidence, items),
      product_snapshot: target,
      items,
    };
    suggestion.learning_key = buildMappingLearningKey(suggestion);
    suggestion.recipe_key = buildMappingRecipeKey(suggestion.items);
    suggestion.fingerprint = hashValue(canonicalSuggestion(suggestion));
    return suggestion;
  }

  supplierPools(items) {
    const grouped = new Map();
    for (const item of items) {
      const code = item.supplier_code || "FILE_MARKET";
      if (!grouped.has(code)) grouped.set(code, []);
      grouped.get(code).push(item);
    }
    return [...grouped.entries()].map(([code, poolItems]) => ({
      code,
      items: poolItems,
      brands: new Set(
        poolItems.map((item) => normalizeText(item.brand)).filter(Boolean),
      ),
    }));
  }

  targetBelongsToPool(target, pool) {
    const targetBrand = normalizeText(target.brand);
    const targetName = normalizeText(target.product_name);
    return (
      pool.brands.has(targetBrand) ||
      [...pool.brands].some(
        (brand) => brand.length >= 3 && targetName.includes(brand),
      )
    );
  }

  candidatesForPool(target, examples, costItems, pool, targetHints) {
    return [
      this.buildFromFeedbackCorrection(target, targetHints, pool.items),
      ...this.buildTrainingCandidates(target, examples, pool.items),
      this.buildFromCompositeFileItems(target, pool.items),
      this.buildFromMultiVariantFileItems(target, pool.items),
      this.buildFromCostItems(target, costItems, pool.items),
      ...this.buildFromFileItems(target, pool.items, { minScore: 0.3 }),
    ]
      .filter(
        (candidate) =>
          candidate && candidate.confidence >= 0.3 && candidate.items.length,
      )
      .map((candidate) => ({ ...candidate, supplier_code: pool.code }))
      .map((candidate) => applyRejectionHints(candidate, targetHints))
      .map((candidate) => this.applyCompositeSafety(target, candidate));
  }

  manualHistoryCandidatesForTarget(target, examples, targetHints) {
    return this.buildTrainingCandidates(target, examples, [])
      .filter((candidate) => candidate.source_type === "MANUAL_HISTORY")
      .map((candidate) => applyRejectionHints(candidate, targetHints))
      .map((candidate) => this.applyCompositeSafety(target, candidate));
  }

  async generate({ limit = 500, barcode = null, supplier_code = null } = {}) {
    const supplierCode = supplier_code
      ? String(supplier_code).toUpperCase()
      : null;
    if (supplierCode && !SUPPLIER_CODES.includes(supplierCode))
      throw new AppError(
        "Tedarikçi havuzu geçersiz",
        400,
        "INVALID_SUPPLIER_CODE",
      );
    const [targets, trainingRows, fileItems, costItems] = await Promise.all([
      this.repository.targetProducts({ limit, barcode }),
      this.repository.trainingRows(),
      this.repository.fileItemsForMatching(supplierCode),
      this.repository.costItemsForMatching(),
    ]);
    const examples = this.groupTrainingRows(trainingRows);
    const pools = this.supplierPools(fileItems);
    const rejectedFingerprints = new Set(
      this.repository.rejectedFingerprints
        ? await this.repository.rejectedFingerprints(
            targets.map((target) => target.barcode),
          )
        : [],
    );
    const rejectedRecipes = new Set(
      this.repository.rejectedRecipeKeys
        ? await this.repository.rejectedRecipeKeys(
            targets.map((target) => target.barcode),
          )
        : [],
    );
    const rejectedSources = new Set(
      this.repository.rejectedSourceBarcodes
        ? await this.repository.rejectedSourceBarcodes(
            targets.map((target) => target.barcode),
          )
        : [],
    );
    const feedbackHints = new Map();
    if (this.repository.rejectedFeedbackHints) {
      const rows = await this.repository.rejectedFeedbackHints(
        targets.map((target) => target.barcode),
      );
      for (const row of rows) {
        const hint = parseRejectionHint(row);
        if (
          !hint.forceQuantityOne &&
          !hint.preferredTokens.length &&
          !hint.rejectedTokens.length &&
          !hint.explicitItems.length
        )
          continue;
        if (!feedbackHints.has(row.barcode)) feedbackHints.set(row.barcode, []);
        feedbackHints.get(row.barcode).push(hint);
      }
    }
    const drafts = [];
    let scoped = 0;
    let withoutCandidate = 0;
    let withoutFileSupport = 0;
    let rejectedCandidateCount = 0;
    for (const target of targets) {
      const targetHints = feedbackHints.get(target.barcode);
      const manualCandidates = supplierCode
        ? []
        : this.manualHistoryCandidatesForTarget(target, examples, targetHints);
      const matchingPools = pools.filter((pool) =>
        this.targetBelongsToPool(target, pool),
      );
      if (!matchingPools.length && !manualCandidates.length) continue;
      scoped++;
      const poolCandidates = matchingPools.flatMap((pool) =>
        this.candidatesForPool(target, examples, costItems, pool, targetHints),
      );
      const candidates = [...manualCandidates, ...poolCandidates].sort(
        (left, right) => sortCandidatesForTarget(target, left, right),
      );
      if (!candidates.length) {
        withoutCandidate++;
        continue;
      }
      let accepted = false;
      for (const candidate of candidates) {
        const suggestion = this.buildSuggestion(target, candidate);
        if (!suggestion) {
          withoutFileSupport++;
          continue;
        }
        if (
          rejectedFingerprints.has(
            `${suggestion.barcode}:${suggestion.fingerprint}`,
          )
        ) {
          rejectedCandidateCount++;
          continue;
        }
        if (
          rejectedRecipes.has(`${suggestion.barcode}:${suggestion.recipe_key}`)
        ) {
          rejectedCandidateCount++;
          continue;
        }
        if (
          suggestion.source_barcode &&
          rejectedSources.has(
            `${suggestion.barcode}:${suggestion.source_barcode}`,
          )
        ) {
          rejectedCandidateCount++;
          continue;
        }
        drafts.push(suggestion);
        accepted = true;
        break;
      }
      if (!accepted && candidates.length) withoutCandidate++;
    }
    const profileRows = await this.repository.learningProfiles(
      drafts.map((suggestion) => suggestion.learning_key),
    );
    const profiles = new Map(
      profileRows.map((profile) => [profile.learning_key, profile]),
    );
    const suggestions = drafts.map((suggestion) => {
      const learning = mappingLearningAdjustment(
        suggestion.base_confidence,
        profiles.get(suggestion.learning_key),
        {
          variantPriceInferred: Boolean(
            suggestion.evidence.variantPriceInferred,
          ),
        },
      );
      suggestion.confidence = learning.confidence;
      suggestion.learning_adjustment = learning.adjustment;
      suggestion.confidence_band = confidenceBand(learning.confidence);
      suggestion.evidence = { ...suggestion.evidence, learning };
      suggestion.fingerprint = hashValue(canonicalSuggestion(suggestion));
      return suggestion;
    });
    const saved = await this.repository.saveSuggestions(
      suggestions,
      targets.map((target) => target.barcode),
    );
    return {
      processed: targets.length,
      scoped,
      eligible: suggestions.length,
      withoutCandidate,
      withoutFileSupport,
      rejectedCandidateCount,
      filePoolSize: fileItems.length,
      supplierPools: pools.map((pool) => ({
        code: pool.code,
        label: supplier(pool.code)?.label || pool.code,
        productCount: pool.items.length,
      })),
      trainingProductCount: examples.length,
      ...saved,
    };
  }

  async listSuggestions(filters) {
    return this.repository.listSuggestions(filters);
  }

  async diagnostics({ limit = 1000, supplier_code = null } = {}) {
    const supplierCode = supplier_code
      ? String(supplier_code).toUpperCase()
      : null;
    if (supplierCode && !SUPPLIER_CODES.includes(supplierCode))
      throw new AppError(
        "Tedarikçi havuzu geçersiz",
        400,
        "INVALID_SUPPLIER_CODE",
      );
    const [targets, trainingRows, fileItems, costItems] = await Promise.all([
      this.repository.targetProducts(limit),
      this.repository.trainingRows(),
      this.repository.fileItemsForMatching(supplierCode),
      this.repository.costItemsForMatching(),
    ]);
    const examples = this.groupTrainingRows(trainingRows);
    const pools = this.supplierPools(fileItems);
    const rejectedFingerprints = new Set(
      this.repository.rejectedFingerprints
        ? await this.repository.rejectedFingerprints(
            targets.map((target) => target.barcode),
          )
        : [],
    );
    const rejectedRecipes = new Set(
      this.repository.rejectedRecipeKeys
        ? await this.repository.rejectedRecipeKeys(
            targets.map((target) => target.barcode),
          )
        : [],
    );
    const items = targets.map((target) => {
      const matchingPools = pools.filter((pool) =>
        this.targetBelongsToPool(target, pool),
      );
      if (!matchingPools.length)
        return {
          ...target,
          diagnosis: "NOT_SUPPLIER_BRAND",
          diagnosis_label: "Tedarikçi havuzlarında marka bulunamadı",
        };
      const scopedItems = matchingPools.flatMap((pool) => pool.items);
      const fileMatches = scopedItems
        .map((fileItem) => ({
          fileItem,
          comparison: compareProducts(target, fileItem),
        }))
        .sort((left, right) => right.comparison.score - left.comparison.score);
      const bestFile = fileMatches[0] || null;
      const candidates = matchingPools.flatMap((pool) =>
        this.candidatesForPool(target, examples, costItems, pool),
      );
      if (!scopedItems.length)
        return {
          ...target,
          diagnosis: "SUPPLIER_POOL_EMPTY",
          diagnosis_label: "Tedarikçi havuzu boş",
        };
      if (!candidates.length)
        return {
          ...target,
          diagnosis:
            bestFile?.comparison?.score >= 0.18
              ? "LOW_SCORE"
              : "NO_SUPPLIER_CANDIDATE",
          diagnosis_label:
            bestFile?.comparison?.score >= 0.18
              ? "Aday var ama skor çok düşük"
              : "Tedarikçi havuzunda aday yok",
          best_file_product_name: bestFile?.fileItem?.product_name || null,
          best_supplier_product_name: bestFile?.fileItem?.product_name || null,
          best_supplier_code: bestFile?.fileItem?.supplier_code || null,
          best_supplier_label:
            supplier(bestFile?.fileItem?.supplier_code)?.label || null,
          best_file_score: bestFile?.comparison?.score || null,
          best_file_price: bestFile?.fileItem?.current_price || null,
        };
      const suggestions = candidates
        .map((candidate) => this.buildSuggestion(target, candidate))
        .filter(Boolean);
      const rejected = suggestions.find(
        (suggestion) =>
          rejectedFingerprints.has(
            `${suggestion.barcode}:${suggestion.fingerprint}`,
          ) ||
          rejectedRecipes.has(`${suggestion.barcode}:${suggestion.recipe_key}`),
      );
      const available = suggestions.find(
        (suggestion) =>
          !rejectedFingerprints.has(
            `${suggestion.barcode}:${suggestion.fingerprint}`,
          ) &&
          !rejectedRecipes.has(
            `${suggestion.barcode}:${suggestion.recipe_key}`,
          ),
      );
      if (available)
        return {
          ...target,
          diagnosis:
            available.base_confidence >= 0.54
              ? "SUGGESTION_AVAILABLE"
              : "LOW_CONFIDENCE_AVAILABLE",
          diagnosis_label:
            available.base_confidence >= 0.54
              ? "Öneri üretilebilir"
              : "Düşük güvenli öneri üretilebilir",
          best_file_product_name:
            available.items.find((item) => item.file_product_name)
              ?.file_product_name ||
            bestFile?.fileItem?.product_name ||
            null,
          best_supplier_product_name:
            available.items.find((item) => item.supplier_product_name)
              ?.supplier_product_name ||
            bestFile?.fileItem?.product_name ||
            null,
          best_supplier_code:
            available.supplier_code ||
            bestFile?.fileItem?.supplier_code ||
            null,
          best_supplier_label:
            supplier(
              available.supplier_code || bestFile?.fileItem?.supplier_code,
            )?.label || null,
          best_file_score: bestFile?.comparison?.score || null,
          best_file_price:
            available.items.find((item) => item.suggested_unit_cost)
              ?.suggested_unit_cost ||
            bestFile?.fileItem?.current_price ||
            null,
          confidence: available.base_confidence,
        };
      return {
        ...target,
        diagnosis: rejected ? "REJECTED_PATTERN" : "NO_SUPPLIER_SUPPORT",
        diagnosis_label: rejected
          ? "Benzer öneri daha önce reddedilmiş"
          : "Tedarikçi fiyat desteği yok",
        best_file_product_name: bestFile?.fileItem?.product_name || null,
        best_supplier_product_name: bestFile?.fileItem?.product_name || null,
        best_supplier_code: bestFile?.fileItem?.supplier_code || null,
        best_supplier_label:
          supplier(bestFile?.fileItem?.supplier_code)?.label || null,
        best_file_score: bestFile?.comparison?.score || null,
        best_file_price: bestFile?.fileItem?.current_price || null,
      };
    });
    const summary = items.reduce((acc, item) => {
      acc[item.diagnosis] = (acc[item.diagnosis] || 0) + 1;
      return acc;
    }, {});
    return {
      processed: targets.length,
      filePoolSize: fileItems.length,
      supplierPools: pools.map((pool) => ({
        code: pool.code,
        label: supplier(pool.code)?.label || pool.code,
        productCount: pool.items.length,
      })),
      summary,
      items,
    };
  }

  async listLearningFeedback(filters) {
    return this.repository.listLearningFeedback(filters);
  }

  async manualCostQueue(filters) {
    return this.repository.manualCostQueue(filters);
  }

  async regenerateDiagnosticBarcode(barcode) {
    const result = await this.generate({ barcode, limit: 1 });
    if (!result.processed)
      throw new AppError(
        "Bu barkod öneri üretimi için uygun aktif mapping hedefi değil",
        404,
        "DIAGNOSTIC_TARGET_NOT_FOUND",
      );
    if (result.created > 0)
      return { ...result, reason: "CREATED", existingSuggestions: [] };
    if (result.skippedApproved > 0) {
      const existingSuggestions =
        await this.repository.latestSuggestionsForBarcode?.(barcode, [
          "APPROVED",
        ]);
      return {
        ...result,
        reason: "APPROVED_EXISTS",
        existingSuggestions: existingSuggestions || [],
      };
    }
    if (result.skippedRejected > 0)
      return { ...result, reason: "REJECTED_PATTERN", existingSuggestions: [] };
    const existingSuggestions =
      await this.repository.latestSuggestionsForBarcode?.(barcode, [
        "PENDING",
        "APPROVED",
      ]);
    if (existingSuggestions?.length)
      return {
        ...result,
        reason:
          existingSuggestions[0].status === "APPROVED"
            ? "APPROVED_EXISTS"
            : "PENDING_EXISTS",
        existingSuggestions,
      };
    return { ...result, reason: "NO_CANDIDATE", existingSuggestions: [] };
  }

  async markDiagnosticManualCost(barcode, actor, input = {}) {
    const reason = String(
      input.reason || "Teşhis ekranından manuel maliyet kuyruğuna alındı",
    ).trim();
    const row = await this.repository.markManualCostNeeded(
      barcode,
      actor,
      reason,
    );
    if (!row) throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
    return row;
  }

  normalizeManualCostInput(barcode, input = {}) {
    const itemName = String(input.item_name || input.product_name || "").trim();
    const unitCost = Number(input.unit_cost);
    const unitDesi = Number(input.unit_desi);
    const quantity = Number(input.quantity || 1);
    const itemCode = String(
      input.item_code ||
        generatedCostCode({ brand: "", product_name: itemName }),
    )
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_");
    if (!String(barcode || "").trim())
      throw new AppError("Barkod zorunlu", 400, "BARCODE_REQUIRED");
    if (!itemName)
      throw new AppError(
        "Maliyet kalemi adı zorunlu",
        400,
        "ITEM_NAME_REQUIRED",
      );
    if (!Number.isFinite(unitCost) || unitCost <= 0)
      throw new AppError("Birim maliyet pozitif olmalı", 400, "INVALID_COST");
    if (!Number.isFinite(unitDesi) || unitDesi <= 0)
      throw new AppError("Birim desi pozitif olmalı", 400, "INVALID_DESI");
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new AppError("Adet pozitif olmalı", 400, "INVALID_QUANTITY");
    return {
      marketplace: "TRENDYOL",
      barcode: String(barcode).trim(),
      item_code: itemCode,
      item_name: itemName,
      unit_cost: Number(unitCost.toFixed(2)),
      unit_desi: Number(unitDesi.toFixed(4)),
      unit: input.unit || "adet",
      quantity,
      note: input.note || "Manuel maliyet girişi",
    };
  }

  async applyManualCost(barcode, actor, input = {}) {
    const row = this.normalizeManualCostInput(barcode, input);
    const result = await this.costs.withTransaction(async (client) => {
      const product = (
        await client.query(
          "SELECT barcode FROM products WHERE marketplace='TRENDYOL' AND barcode=$1 FOR UPDATE",
          [row.barcode],
        )
      ).rows[0];
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const costItem = (
        await client.query(
          `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,unit,note)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(item_code)DO UPDATE SET
             item_name=EXCLUDED.item_name,
             unit_cost=EXCLUDED.unit_cost,
             unit_desi=EXCLUDED.unit_desi,
             unit=EXCLUDED.unit,
             note=EXCLUDED.note,
             updated_at=NOW()
           RETURNING *`,
          [
            row.item_code,
            row.item_name,
            row.unit_cost,
            row.unit_desi,
            row.unit,
            row.note,
          ],
        )
      ).rows[0];
      const mapping = (
        await client.query(
          `INSERT INTO product_cost_mappings(marketplace,barcode,cost_item_code,quantity,updated_at)
           VALUES('TRENDYOL',$1,$2,$3,NOW())
           ON CONFLICT(marketplace,barcode,cost_item_code)
           DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=NOW()
           RETURNING *`,
          [row.barcode, row.item_code, row.quantity],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO audit_logs(actor,action,entity_type,entity_id,after_data)
         VALUES($1,'MANUAL_COST_APPLIED','product',$2,$3::jsonb)`,
        [
          actor || "system",
          row.barcode,
          JSON.stringify({
            costItem: row.item_code,
            unitCost: row.unit_cost,
            unitDesi: row.unit_desi,
            quantity: row.quantity,
          }),
        ],
      );
      return { costItem, mapping };
    });
    await this.costEngine.recalculate(row.barcode);
    return { barcode: row.barcode, ...result };
  }

  async getSuggestion(id) {
    const suggestion = (await this.repository.getSuggestionsByIds([id]))[0];
    if (!suggestion)
      throw new AppError(
        "Mapping önerisi bulunamadı",
        404,
        "SUGGESTION_NOT_FOUND",
      );
    return suggestion;
  }

  normalizeDecisionItems(suggestion, items) {
    const inputItems = items?.length ? items : suggestion.items;
    const rows = inputItems.map((item, index) => {
      const original = suggestion.items[index] || {};
      const quantity = Number(item.quantity);
      const tierPrice = priceTierForQuantity(
        original.supplier_current_price || original.file_current_price,
        original.supplier_code === "BIZIM_MARKET"
          ? original.supplier_price_tiers || []
          : [],
        quantity,
      );
      const fileProductName =
        item.supplier_product_name ||
        original.supplier_product_name ||
        item.file_product_name ||
        original.file_product_name ||
        original.item_name ||
        item.item_name ||
        "";
      const inferredSize = extractSizes(fileProductName)[0];
      const inferredDesi = inferredSize
        ? estimateUnitDesi({
            size_value: inferredSize.value,
            size_unit: inferredSize.unit,
          })
        : item.file_market_item_id || original.file_market_item_id
          ? estimateUnitDesi({})
          : null;
      return {
        marketplace: "TRENDYOL",
        barcode: suggestion.barcode,
        cost_item_code: String(item.cost_item_code || "").trim(),
        item_name:
          item.item_name || original.item_name || original.file_product_name,
        quantity: Number(item.quantity),
        file_market_item_id:
          item.file_market_item_id || original.file_market_item_id || null,
        supplier_code:
          item.supplier_code ||
          original.supplier_code ||
          suggestion.supplier_code ||
          "FILE_MARKET",
        current_unit_cost:
          Number(item.current_unit_cost || original.current_unit_cost || 0) ||
          null,
        suggested_unit_cost:
          Number(
            (tierPrice.tier ? tierPrice.unitPrice : null) ||
              item.suggested_unit_cost ||
              tierPrice.unitPrice ||
              original.supplier_effective_unit_price ||
              original.suggested_unit_cost ||
              original.supplier_current_price ||
              original.file_current_price ||
              0,
          ) || null,
        selected_price_tier:
          item.selected_price_tier ||
          (tierPrice.tier ? tierPrice.tier : original.selected_price_tier) ||
          null,
        unit_desi:
          Number(item.unit_desi || original.unit_desi || inferredDesi || 0) ||
          null,
      };
    });
    if (
      rows.length < 1 ||
      rows.length > 20 ||
      rows.some(
        (row) =>
          !row.cost_item_code ||
          !Number.isFinite(row.quantity) ||
          row.quantity <= 0,
      )
    )
      throw new AppError(
        "Önerilen mapping satırları geçersiz",
        400,
        "INVALID_SUGGESTION_ITEMS",
      );
    return rows;
  }

  isCreatableCostItem(row) {
    return (
      row.file_market_item_id &&
      Number(row.suggested_unit_cost) > 0 &&
      Number(row.unit_desi) > 0
    );
  }

  async approve(id, actor, input = {}) {
    const suggestion = await this.getSuggestion(id);
    if (suggestion.status !== "PENDING")
      throw new AppError(
        "Yalnızca bekleyen öneri onaylanabilir",
        409,
        "SUGGESTION_NOT_PENDING",
      );
    const items = this.normalizeDecisionItems(suggestion, input.items);
    const validation = await this.costs.validateMappings(items);
    const blockingErrors = validation.valid
      ? []
      : validation.errors.filter(
          (error) =>
            error.code !== "ORPHAN_COST_CODE" ||
            !items.some(
              (item) =>
                item.cost_item_code === error.value &&
                this.isCreatableCostItem(item),
            ),
        );
    if (blockingErrors.length)
      throw new AppError(
        "Öneri mapping doğrulamasından geçmedi",
        422,
        "SUGGESTION_MAPPING_INVALID",
        blockingErrors,
      );
    const result = await this.repository.decide(id, "APPROVED", actor, {
      items,
      learning_key: buildMappingLearningKey({ ...suggestion, items }),
      update_file_price:
        input.update_file_price === undefined
          ? suggestion.update_file_price
          : Boolean(input.update_file_price),
    });
    if (result?.conflict)
      throw new AppError(
        "Öneri başka bir işlemle değişti",
        409,
        "SUGGESTION_CONFLICT",
      );
    return this.getSuggestion(id);
  }

  async reject(id, actor, input = {}) {
    const suggestion = await this.getSuggestion(id);
    const result = await this.repository.decide(id, "REJECTED", actor, {
      ...input,
      learning_key:
        suggestion.learning_key || buildMappingLearningKey(suggestion),
    });
    if (!result)
      throw new AppError(
        "Mapping önerisi bulunamadı",
        404,
        "SUGGESTION_NOT_FOUND",
      );
    if (result.conflict)
      throw new AppError(
        "Yalnızca bekleyen öneri reddedilebilir",
        409,
        "SUGGESTION_NOT_PENDING",
      );
    return result;
  }

  async cancelApproval(id, actor, input = {}) {
    const result = await this.repository.cancelApproval(id, actor, input);
    if (!result)
      throw new AppError(
        "Mapping önerisi bulunamadı",
        404,
        "SUGGESTION_NOT_FOUND",
      );
    if (result.conflict)
      throw new AppError(
        "Yalnızca uygulanmamış onaylı öneri iptal edilebilir",
        409,
        "SUGGESTION_NOT_APPROVED",
      );
    return result;
  }

  normalizeIds(ids) {
    const normalized = [
      ...new Set((ids || []).map((id) => Number(id)).filter(Number.isInteger)),
    ];
    if (!normalized.length || normalized.length > 100)
      throw new AppError(
        "1-100 mapping önerisi seçin",
        400,
        "INVALID_SUGGESTION_IDS",
      );
    return normalized;
  }

  previewToken(suggestions) {
    return hashValue(
      suggestions.map((suggestion) => ({
        id: Number(suggestion.id),
        status: suggestion.status,
        updatedAt: suggestion.updated_at,
        fingerprint: suggestion.fingerprint,
        updateFilePrice: suggestion.update_file_price,
        canonical: canonicalSuggestion(suggestion),
      })),
    );
  }

  async bulkPreview(ids) {
    const normalizedIds = this.normalizeIds(ids);
    const suggestions =
      await this.repository.getSuggestionsByIds(normalizedIds);
    if (
      suggestions.length !== normalizedIds.length ||
      suggestions.some((suggestion) => suggestion.status !== "APPROVED")
    )
      throw new AppError(
        "Toplu uygulama için yalnızca onaylı önerileri seçin",
        409,
        "SUGGESTIONS_NOT_APPROVED",
      );
    const staleFilePrice = suggestions.find(
      (suggestion) =>
        suggestion.update_file_price &&
        suggestion.items.some(
          (item) =>
            item.file_market_item_id &&
            !isSupplierPriceFresh(
              item.supplier_last_seen_at || item.file_last_seen_at,
            ),
        ),
    );
    if (staleFilePrice)
      throw new AppError(
        `${staleFilePrice.barcode} için File fiyatı ${FILE_PRICE_MAX_AGE_DAYS} günden eski; fiyatı yenileyin veya maliyet güncellemesini kapatın`,
        409,
        "FILE_PRICE_STALE",
      );
    return {
      token: this.previewToken(suggestions),
      suggestions,
      productCount: suggestions.length,
      mappingCount: suggestions.reduce(
        (sum, suggestion) => sum + suggestion.items.length,
        0,
      ),
      priceUpdateCount: suggestions.reduce(
        (sum, suggestion) =>
          sum +
          (suggestion.update_file_price
            ? suggestion.items.filter((item) => item.file_market_item_id).length
            : 0),
        0,
      ),
    };
  }

  async bulkApply(ids, token, actor) {
    const normalizedIds = this.normalizeIds(ids);
    if (!token)
      throw new AppError(
        "Güncel toplu uygulama önizlemesi gerekli",
        409,
        "SUGGESTION_PREVIEW_REQUIRED",
      );
    return this.repository.withTransaction(async (client) => {
      const suggestions = await this.repository.getSuggestionsByIds(
        normalizedIds,
        client,
        { lock: true },
      );
      if (
        suggestions.length !== normalizedIds.length ||
        suggestions.some((suggestion) => suggestion.status !== "APPROVED")
      )
        throw new AppError(
          "Onay durumu değişti; yeniden önizleyin",
          409,
          "SUGGESTION_STATE_CHANGED",
        );
      if (this.previewToken(suggestions) !== token)
        throw new AppError(
          "Öneri veya File fiyatı değişti; yeniden önizleyin",
          409,
          "SUGGESTION_PREVIEW_STALE",
        );
      const applied = [];
      for (const suggestion of suggestions) {
        const result = await this.repository.markApplied(
          client,
          suggestion,
          actor,
        );
        if (result.conflict)
          throw new AppError(
            `${suggestion.barcode} artık güvenli uygulama koşullarını sağlamıyor`,
            409,
            result.conflict,
          );
        applied.push(result);
      }
      await this.costEngine.recalculate(undefined, client);
      return { applied: applied.length, items: applied };
    });
  }
}

module.exports = {
  MappingAutomationService,
  ALGORITHM_VERSION,
  FILE_PRICE_MAX_AGE_DAYS,
  parsePrice,
  canonicalSuggestion,
};
