const crypto = require("crypto");
const { AppError } = require("../utils/errors");
const {
  normalizeText,
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

const ALGORITHM_VERSION = "manual-history-file-v2";

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
        best = { item: fileItem, score, itemMatch, targetMatch };
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
      };
    });
  }

  buildFromTraining(target, examples, fileItems) {
    let best = null;
    for (const example of examples) {
      const comparison = compareProducts(target, example);
      if (!best || comparison.score > best.comparison.score)
        best = { example, comparison };
    }
    if (!best || best.comparison.score < 0.42) return null;
    const scaled = scaleRecipe(best.example, target, best.example.recipe);
    const items = this.enrichRecipe(target, scaled, fileItems);
    const supported = items.filter((item) => item.file_market_item_id);
    const fileSupport = supported.length
      ? supported.reduce((sum, item) => sum + item.file_match_score, 0) /
        items.length
      : 0;
    const confidence = Math.min(
      1,
      best.comparison.score * 0.9 + fileSupport * 0.1,
    );
    return {
      confidence,
      source_type: supported.length
        ? "MANUAL_HISTORY_AND_FILE"
        : "MANUAL_HISTORY",
      source_barcode: best.example.barcode,
      items,
      evidence: {
        sourceProductName: best.example.product_name,
        reasons: best.comparison.reasons,
        sourcePackCount: best.comparison.candidatePackCount,
        targetPackCount: best.comparison.targetPackCount,
        fileMatches: items
          .filter((item) => item.file_market_item_id)
          .map((item) => ({
            costItemCode: item.cost_item_code,
            fileProductName: item.file_product_name,
            score: item.file_match_score,
          })),
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
    );
    const fileSupport = items[0].file_match_score || 0;
    return {
      confidence: Math.min(
        1,
        best.comparison.score * 0.85 + fileSupport * 0.15,
      ),
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
              },
            ]
          : [],
      },
    };
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
    const suggestions = [];
    let scoped = 0;
    for (const target of targets) {
      const targetBrand = normalizeText(target.brand);
      const targetName = normalizeText(target.product_name);
      const belongsToFileBrand =
        fileBrands.has(targetBrand) ||
        [...fileBrands].some((brand) => targetName.includes(brand));
      if (!belongsToFileBrand) continue;
      scoped++;
      const fromTraining = this.buildFromTraining(target, examples, fileItems);
      const candidate =
        fromTraining || this.buildFromCostItems(target, costItems, fileItems);
      if (!candidate || candidate.confidence < 0.3 || !candidate.items.length)
        continue;
      const confidence = Number(candidate.confidence.toFixed(5));
      const fileIds = [
        ...new Set(
          candidate.items
            .map((item) => item.file_market_item_id)
            .filter(Boolean),
        ),
      ];
      if (!fileIds.length) continue;
      const suggestion = {
        barcode: target.barcode,
        confidence,
        confidence_band: confidenceBand(confidence),
        algorithm_version: ALGORITHM_VERSION,
        source_type: candidate.source_type,
        source_barcode: candidate.source_barcode,
        file_market_item_id: fileIds.length === 1 ? fileIds[0] : null,
        update_file_price: fileIds.length > 0,
        evidence: candidate.evidence,
        product_snapshot: target,
        items: candidate.items,
      };
      suggestion.fingerprint = hashValue(canonicalSuggestion(suggestion));
      suggestions.push(suggestion);
    }
    const saved = await this.repository.saveSuggestions(
      suggestions,
      targets.map((target) => target.barcode),
    );
    return {
      processed: targets.length,
      scoped,
      eligible: suggestions.length,
      filePoolSize: fileItems.length,
      trainingProductCount: examples.length,
      ...saved,
    };
  }

  async listSuggestions(filters) {
    return this.repository.listSuggestions(filters);
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
    const rows = (items?.length ? items : suggestion.items).map((item) => ({
      marketplace: "TRENDYOL",
      barcode: suggestion.barcode,
      cost_item_code: String(item.cost_item_code || "").trim(),
      quantity: Number(item.quantity),
      file_market_item_id: item.file_market_item_id || null,
      suggested_unit_cost: Number(item.suggested_unit_cost || 0) || null,
    }));
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
    if (!validation.valid)
      throw new AppError(
        "Öneri mapping doğrulamasından geçmedi",
        422,
        "SUGGESTION_MAPPING_INVALID",
        validation.errors,
      );
    const result = await this.repository.decide(id, "APPROVED", actor, {
      items,
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
    const result = await this.repository.decide(id, "REJECTED", actor, input);
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
