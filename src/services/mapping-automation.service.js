const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const {
  normalizeText,
  tokens,
  extractPackCount,
  extractSizes,
  compareProducts,
  scaleRecipe,
  confidenceBand,
} = require("../domain/product-matching");
const {
  FILE_PRICE_MAX_AGE_DAYS,
  isFilePriceFresh,
} = require("../domain/file-market");
const {
  buildMappingLearningKey,
  buildMappingRecipeKey,
  mappingLearningAdjustment,
} = require("../domain/mapping-learning");

const ALGORITHM_VERSION = "manual-history-file-v4";

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
  "kokulu",
  "kokusu",
  "makinesi",
  "meyve",
  "oda",
  "parfum",
  "sabun",
  "sivi",
  "suyu",
  "temizleyici",
  "yumusatici",
  "yuzey",
]);

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

function canonicalSuggestion(suggestion) {
  return {
    barcode: suggestion.barcode,
    sourceType: suggestion.source_type,
    sourceBarcode: suggestion.source_barcode || null,
    algorithmVersion: suggestion.algorithm_version,
    items: suggestion.items.map((item) => ({
      code: item.cost_item_code,
      quantity: Number(item.quantity),
      fileItemId: item.file_market_item_id || null,
      filePrice: Number(
        item.file_current_price || item.suggested_unit_cost || 0,
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
  return `${raw || "FILE_URUN"}${size}`.replace(/[^A-Z0-9_]/g, "_");
}

function estimateUnitDesi(fileItem) {
  const value = Number(fileItem.size_value || 0);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Number(Math.max(value / 1000, 0.1).toFixed(3));
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
  const targetInternal = extractInternalPackCount(target.product_name);
  const fileInternal = extractInternalPackCount(fileItem.product_name);
  if (explicit && fileInternal && explicit === fileInternal) return 1;
  if (explicit) return explicit;
  if (targetInternal && fileInternal && targetInternal === fileInternal) return 1;
  return extractPackCount(target.product_name);
}

class MappingAutomationService {
  constructor({ repository, costs, costEngine }) {
    this.repository = repository;
    this.costs = costs;
    this.costEngine = costEngine;
  }

  normalizeFileRows(rows) {
    if (!Array.isArray(rows) || !rows.length)
      throw new AppError("File ürün listesi boş", 400, "EMPTY_FILE_ITEMS");
    if (rows.length > 1000)
      throw new AppError(
        "Tek işlemde en fazla 1000 File ürünü yüklenebilir",
        400,
        "TOO_MANY_FILE_ITEMS",
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
          `${index + 1}. File ürün satırı geçersiz`,
          400,
          "INVALID_FILE_ITEM",
        );
      const sourceKey = String(
        row.source_key ||
          crypto.createHash("sha1").update(normalizedName).digest("hex"),
      ).trim();
      if (seen.has(sourceKey))
        throw new AppError(
          `${index + 1}. File ürünü aynı yüklemede tekrarlanmış`,
          400,
          "DUPLICATE_FILE_ITEM",
        );
      seen.add(sourceKey);
      const size = extractSizes(productName)[0];
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
      };
    });
  }

  async importFileItems(rows) {
    return this.repository.importFileItems(this.normalizeFileRows(rows));
  }

  async listFileItems(filters) {
    return this.repository.listFileItems(filters);
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
          ? Number(fileMatch.item.current_price)
          : Number(item.current_unit_cost),
        file_match_score: fileMatch ? Number(fileMatch.score.toFixed(5)) : null,
        file_product_name: fileMatch?.item.product_name || null,
        file_price_mode: fileMatch?.priceMode || null,
      };
    });
  }

  buildTrainingCandidate(target, example, comparison, fileItems) {
    if (comparison.score < 0.42) return null;
    const scaled = scaleRecipe(example, target, example.recipe);
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
    ).map((item) =>
      item.file_market_item_id
        ? {
            ...item,
            quantity: fileBackedQuantity(target, {
              product_name: item.file_product_name || "",
            }),
          }
        : item,
    );
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

  buildFromFileItems(target, fileItems) {
    return fileItems
      .map((fileItem) => ({
        fileItem,
        comparison: compareProducts(target, fileItem),
      }))
      .filter(({ comparison }) => comparison.score >= 0.54)
      .sort((left, right) => right.comparison.score - left.comparison.score)
      .map(({ fileItem, comparison }) => {
        const unitDesi = estimateUnitDesi(fileItem);
        return {
          confidence: Math.min(0.88, comparison.score),
          source_type: "FILE_DIRECT_COST_ITEM",
          source_barcode: null,
          items: [
            {
              cost_item_code: generatedCostCode(fileItem),
              item_name: fileItem.product_name,
              quantity: fileBackedQuantity(target, fileItem),
              current_unit_cost: Number(fileItem.current_price),
              suggested_unit_cost: Number(fileItem.current_price),
              unit_desi: unitDesi,
              file_market_item_id: fileItem.id,
              file_match_score: comparison.score,
              file_product_name: fileItem.product_name,
              file_price_mode: "DIRECT",
              creates_cost_item: true,
            },
          ],
          evidence: {
            reasons: comparison.reasons,
            targetPackCount: comparison.targetPackCount,
            fileMatches: [
              {
                costItemCode: generatedCostCode(fileItem),
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

  buildSuggestion(target, candidate) {
    const baseConfidence = Number(candidate.confidence.toFixed(5));
    const fileIds = [
      ...new Set(
        candidate.items.map((item) => item.file_market_item_id).filter(Boolean),
      ),
    ];
    if (!fileIds.length) return null;
    const suggestion = {
      barcode: target.barcode,
      base_confidence: baseConfidence,
      algorithm_version: ALGORITHM_VERSION,
      source_type: candidate.source_type,
      source_barcode: candidate.source_barcode,
      file_market_item_id: fileIds.length === 1 ? fileIds[0] : null,
      update_file_price: fileIds.length > 0,
      evidence: candidate.evidence,
      product_snapshot: target,
      items: candidate.items,
    };
    suggestion.learning_key = buildMappingLearningKey(suggestion);
    suggestion.recipe_key = buildMappingRecipeKey(suggestion.items);
    suggestion.fingerprint = hashValue(canonicalSuggestion(suggestion));
    return suggestion;
  }

  async generate({ limit = 500 } = {}) {
    const [targets, trainingRows, fileItems, costItems] = await Promise.all([
      this.repository.targetProducts(limit),
      this.repository.trainingRows(),
      this.repository.fileItemsForMatching(),
      this.repository.costItemsForMatching(),
    ]);
    const examples = this.groupTrainingRows(trainingRows);
    const fileBrands = new Set(
      fileItems.map((item) => normalizeText(item.brand)).filter(Boolean),
    );
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
    const drafts = [];
    let scoped = 0;
    let withoutCandidate = 0;
    let withoutFileSupport = 0;
    let rejectedCandidateCount = 0;
    for (const target of targets) {
      const targetBrand = normalizeText(target.brand);
      const targetName = normalizeText(target.product_name);
      const belongsToFileBrand =
        fileBrands.has(targetBrand) ||
        [...fileBrands].some((brand) => targetName.includes(brand));
      if (!belongsToFileBrand) continue;
      scoped++;
      const candidates = [
        ...this.buildTrainingCandidates(target, examples, fileItems),
        this.buildFromCostItems(target, costItems, fileItems),
        ...this.buildFromFileItems(target, fileItems),
      ].filter(
        (candidate) =>
          candidate && candidate.confidence >= 0.3 && candidate.items.length,
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
      trainingProductCount: examples.length,
      ...saved,
    };
  }

  async listSuggestions(filters) {
    return this.repository.listSuggestions(filters);
  }

  async listLearningFeedback(filters) {
    return this.repository.listLearningFeedback(filters);
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
      const fileProductName =
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
        current_unit_cost:
          Number(item.current_unit_cost || original.current_unit_cost || 0) ||
          null,
        suggested_unit_cost:
          Number(
            item.suggested_unit_cost ||
              original.suggested_unit_cost ||
              original.file_current_price ||
              0,
          ) ||
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
            !isFilePriceFresh(item.file_last_seen_at),
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
