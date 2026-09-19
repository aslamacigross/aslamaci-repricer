const crypto = require("node:crypto");
const { AppError } = require("../utils/errors");
const { priceTierForQuantity } = require("../domain/supplier-products");

const OPERATION_TYPES = new Set([
  "CHANGE_SELECTED_OFFER",
  "REASSIGN_PRODUCT_COST",
  "ASSIGN_PRODUCT_COST",
  "REPLACE_COST_ITEM",
  "SPLIT_COST_MAPPINGS",
  "MANUAL_TO_LIVE",
  "REPLACE_SUPPLIER_OFFER",
  "ARCHIVE_COST_ITEM",
  "HARD_DELETE_COST_ITEM",
  "REPAIR_ORPHAN",
  "QUARANTINE_ORPHAN",
  "CREATE_MANUAL_COST",
  "EDIT_MANUAL_COST",
]);
const MARKETPLACES = new Set(["TRENDYOL", "HEPSIBURADA"]);
const PHYSICAL_SUPPLIERS = new Set([
  "FILE_MARKET",
  "BIZIM_MARKET",
  "BIM",
  "ROSSMANN",
  "OTHER",
]);
const ORPHAN_TABLES = new Set([
  "PRODUCT_COST_MAPPINGS",
  "COST_ITEM_FILE_LINKS",
]);

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized)
    throw new AppError(`${field} zorunludur`, 400, "VALIDATION_ERROR");
  return normalized;
}

function positiveId(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new AppError(`${field} geçersizdir`, 400, "VALIDATION_ERROR");
  return number;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function normalizedType(value) {
  const type = required(value, "operationType").toUpperCase();
  if (!OPERATION_TYPES.has(type))
    throw new AppError(
      "Maliyet operasyonu desteklenmiyor",
      400,
      "UNSUPPORTED_COST_OPERATION",
    );
  return type;
}

function normalizedMarketplace(value) {
  const marketplace = required(value, "marketplace").toUpperCase();
  if (!MARKETPLACES.has(marketplace))
    throw new AppError("Marketplace geçersizdir", 400, "VALIDATION_ERROR");
  return marketplace;
}

function normalizedPhysicalSupplier(value) {
  const supplier = required(value, "physicalSupplierCode").toUpperCase();
  if (!PHYSICAL_SUPPLIERS.has(supplier))
    throw new AppError("Fiziki tedarikçi geçersizdir", 400, "VALIDATION_ERROR");
  return supplier;
}

function positiveNumber(value, field, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0))
    throw new AppError(`${field} geçersizdir`, 400, "VALIDATION_ERROR");
  return number;
}

function positiveInteger(value, field) {
  const normalized = required(value, field);
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new AppError(
      `${field} pozitif tam sayı olmalıdır`,
      400,
      "VALIDATION_ERROR",
    );
  return number;
}

class CostIntegrityService {
  constructor({ db, withTransaction, costEngine }) {
    this.db = db;
    this.withTransaction = withTransaction;
    this.costEngine = costEngine;
  }

  async legacyBackfillPreview(queryable = this.db) {
    const rows = (
      await queryable.query(
        `SELECT l.id AS legacy_link_id,l.cost_item_code,l.file_market_item_id,
                ci.id AS cost_item_id,ci.item_name,ci.unit_cost,
                f.supplier_code,f.product_name AS supplier_product_name,
                f.current_price,f.availability,
                canonical.id AS canonical_relation_id,
                canonical.cost_item_id AS canonical_cost_item_id,
                canonical.status AS canonical_status,
                canonical.is_selected,
                (SELECT COUNT(*)::int FROM cost_item_supplier_offers existing
                 WHERE existing.cost_item_id=ci.id
                   AND existing.status='APPROVED') AS canonical_item_relation_count,
                COUNT(*) OVER(PARTITION BY l.file_market_item_id)::int AS parallel_count
         FROM cost_item_file_links l
         LEFT JOIN cost_items ci ON ci.item_code=l.cost_item_code
         LEFT JOIN file_market_items f ON f.id=l.file_market_item_id
         LEFT JOIN cost_item_supplier_offers canonical
           ON canonical.supplier_offer_id=l.file_market_item_id
          AND canonical.status='APPROVED'
         WHERE l.status='APPROVED'
         ORDER BY l.id`,
      )
    ).rows;
    const classified = rows.map((row) => {
      let classification = "SAFE";
      if (!row.cost_item_id || !row.file_market_item_id || !row.supplier_code)
        classification = "ORPHAN";
      else if (
        row.canonical_relation_id &&
        Number(row.canonical_cost_item_id) !== Number(row.cost_item_id)
      )
        classification = "CONFLICT";
      else if (
        Number(row.canonical_item_relation_count) > 0 &&
        !row.canonical_relation_id
      )
        classification = "CONFLICT";
      else if (Number(row.parallel_count) > 1) classification = "PARALLEL";
      else if (row.canonical_relation_id) classification = "EXISTING";
      return {
        ...row,
        cost_item_id: row.cost_item_id ? Number(row.cost_item_id) : null,
        file_market_item_id: row.file_market_item_id
          ? Number(row.file_market_item_id)
          : null,
        classification,
      };
    });
    const counts = classified.reduce(
      (result, row) => {
        result.total++;
        result[row.classification.toLowerCase()]++;
        return result;
      },
      { total: 0, safe: 0, conflict: 0, orphan: 0, parallel: 0, existing: 0 },
    );
    const preview = { counts, rows: classified };
    return { ...preview, previewFingerprint: fingerprint(preview) };
  }

  async applyLegacyBackfill(input) {
    const actor = required(input.actor, "actor");
    const reason = required(input.reason, "reason");
    const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    const expectedFingerprint = required(
      input.previewFingerprint,
      "previewFingerprint",
    );
    return this.withTransaction(async (client) => {
      await this._lockIdempotency(client, idempotencyKey);
      const previous = await this._idempotentResult(client, idempotencyKey);
      if (previous) return previous;
      const preview = await this.legacyBackfillPreview(client);
      this._assertFresh(preview.previewFingerprint, expectedFingerprint);
      const safeRows = preview.rows.filter(
        (row) => row.classification === "SAFE",
      );
      if (
        input.confirmedSafeCount !== undefined &&
        Number(input.confirmedSafeCount) !== safeRows.length
      )
        throw new AppError(
          "Onaylanan backfill sayısı güncel preview ile eşleşmiyor",
          409,
          "STALE_PREVIEW",
        );
      const operation = await this._startOperation(client, {
        operationType: "LEGACY_CANONICAL_BACKFILL",
        actor,
        reason,
        idempotencyKey,
        previewFingerprint: expectedFingerprint,
        payload: { confirmedSafeCount: safeRows.length },
        targetType: "legacy_supplier_links",
      });
      for (const row of safeRows)
        await client.query(
          `INSERT INTO cost_item_supplier_offers(
             cost_item_id,supplier_offer_id,status,is_selected,approved_by,
             approved_at,selected_by,selected_at,selection_reason
           )VALUES($1,$2,'APPROVED',TRUE,$3,NOW(),$3,NOW(),$4)
           ON CONFLICT(cost_item_id,supplier_offer_id) DO NOTHING`,
          [row.cost_item_id, row.file_market_item_id, actor, reason],
        );
      return this._finishOperation(client, operation.id, {
        before: { legacyLinks: preview.counts.total },
        after: {
          inserted: safeRows.length,
          unitCostChanged: false,
          skipped: preview.counts.total - safeRows.length,
        },
      });
    });
  }

  async preview(operationType, payload = {}, queryable = this.db) {
    const type = normalizedType(operationType);
    const state = await this._operationState(queryable, type, payload, false);
    const preview = { operationType: type, ...state };
    return { ...preview, previewFingerprint: fingerprint(preview) };
  }

  async apply(input) {
    const operationType = normalizedType(input.operationType);
    const actor = required(input.actor, "actor");
    const reason = required(input.reason, "reason");
    const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    const expectedFingerprint = required(
      input.previewFingerprint,
      "previewFingerprint",
    );
    return this.withTransaction(async (client) => {
      await this._lockIdempotency(client, idempotencyKey);
      const previous = await this._idempotentResult(client, idempotencyKey);
      if (previous) return previous;
      const state = await this._operationState(
        client,
        operationType,
        input.payload || {},
        true,
      );
      const current = { operationType, ...state };
      this._assertFresh(fingerprint(current), expectedFingerprint);
      if (
        input.confirmedMappingCount !== undefined &&
        Number(input.confirmedMappingCount) !==
          Number(state.impact.mappingCount)
      )
        throw new AppError(
          "Onaylanan mapping sayısı güncel etkiyle eşleşmiyor",
          409,
          "STALE_PREVIEW",
        );
      const operation = await this._startOperation(client, {
        operationType,
        actor,
        reason,
        idempotencyKey,
        previewFingerprint: expectedFingerprint,
        payload: input.payload || {},
        targetType: state.target.type,
        targetId: state.target.id,
      });
      const result = await this._execute(client, operationType, state, {
        actor,
        reason,
        operationId: operation.id,
      });
      await this._recalculate(client, result.affectedMappings || []);
      return this._finishOperation(client, operation.id, {
        before: state.before,
        after: result.after,
      });
    });
  }

  async reverse(operationId, input) {
    const actor = required(input.actor, "actor");
    const reason = required(input.reason, "reason");
    const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    return this.withTransaction(async (client) => {
      await this._lockIdempotency(client, idempotencyKey);
      const previous = await this._idempotentResult(client, idempotencyKey);
      if (previous) return previous;
      const original = (
        await client.query(
          `SELECT * FROM cost_integrity_operations
           WHERE id=$1 AND status='APPLIED' FOR UPDATE`,
          [positiveId(operationId, "operationId")],
        )
      ).rows[0];
      if (!original)
        throw new AppError(
          "Geri alınabilir operasyon bulunamadı",
          404,
          "COST_OPERATION_NOT_REVERSIBLE",
        );
      if (original.operation_type === "HARD_DELETE_COST_ITEM")
        throw new AppError(
          "Kalıcı silme geri alınamaz",
          409,
          "COST_OPERATION_NOT_REVERSIBLE",
        );
      const reversal = await this._startOperation(client, {
        operationType: `REVERSE_${original.operation_type}`,
        actor,
        reason,
        idempotencyKey,
        payload: { operationId: Number(original.id) },
        targetType: original.target_type,
        targetId: original.target_id,
        reversesOperationId: original.id,
      });
      let affectedMappings;
      if (original.operation_type === "CREATE_MANUAL_COST")
        affectedMappings = await this._reverseManualCreate(client, original);
      else if (original.operation_type === "ASSIGN_PRODUCT_COST")
        affectedMappings = await this._reverseAssignedMapping(client, original);
      else
        affectedMappings = await this._restoreSnapshot(
          client,
          original.before_snapshot,
          actor,
          reason,
          original,
        );
      await this._recalculate(client, affectedMappings);
      await client.query(
        `UPDATE cost_integrity_operations
         SET status='REVERSED',reversed_at=NOW(),reversed_by=$2,
             reversal_reason=$3 WHERE id=$1`,
        [original.id, actor, reason],
      );
      return this._finishOperation(client, reversal.id, {
        before: original.after_snapshot,
        after: original.before_snapshot,
      });
    });
  }

  async hardDeleteEligibility(costItemId, queryable = this.db) {
    const id = positiveId(costItemId, "costItemId");
    const item = await this._costItem(queryable, id);
    const counts = (
      await queryable.query(
        `SELECT
          (SELECT COUNT(*)::int FROM product_cost_mappings WHERE cost_item_code=$1) mappings,
          (SELECT COUNT(*)::int FROM cost_item_file_links WHERE cost_item_code=$1) legacy_links,
          (SELECT COUNT(*)::int FROM cost_item_supplier_offers WHERE cost_item_id=$2) supplier_relations,
          (SELECT COUNT(*)::int FROM cost_item_aliases WHERE canonical_cost_item_id=$2) aliases,
          (SELECT COUNT(*)::int FROM supplier_cost_sync_events WHERE cost_item_code=$1) history,
          (SELECT COUNT(*)::int FROM cost_integrity_operations
            WHERE target_type='cost_item' AND target_id=$2::text) operations`,
        [item.item_code, id],
      )
    ).rows[0];
    const normalized = Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [key, Number(value)]),
    );
    const eligible = Object.values(normalized).every((value) => value === 0);
    return {
      costItem: item,
      dependencies: normalized,
      eligible,
      reason: eligible ? null : "COST_ITEM_HAS_DEPENDENCIES",
    };
  }

  async searchCostItems({ search = "", page = 1, limit = 25 } = {}) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const normalizedSearch = String(search).trim();
    const params = [];
    const where = ["ci.lifecycle_status='ACTIVE'"];
    if (normalizedSearch) {
      params.push(`%${normalizedSearch}%`);
      where.push("(ci.item_name ILIKE $1 OR ci.item_code ILIKE $1)");
    }
    const total = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM cost_items ci WHERE ${where.join(" AND ")}`,
      params,
    );
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const rows = await this.db.query(
      `SELECT ci.*,
              selected.supplier_offer_id,
              offer.product_name AS supplier_product_name,
              offer.supplier_code,offer.offer_type,offer.availability,
              offer.checked_at,offer.last_seen_at,
              (SELECT COUNT(*)::int FROM product_cost_mappings pcm
               WHERE pcm.cost_item_code=ci.item_code) AS mapping_count
       FROM cost_items ci
       LEFT JOIN cost_item_supplier_offers selected
         ON selected.cost_item_id=ci.id AND selected.status='APPROVED'
        AND selected.is_selected=TRUE
       LEFT JOIN file_market_items offer ON offer.id=selected.supplier_offer_id
       WHERE ${where.join(" AND ")}
       ORDER BY ci.item_name,ci.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows,
      total: Number(total.rows[0].total),
      page: safePage,
      limit: safeLimit,
    };
  }

  async costItemContext(costItemId) {
    const item = await this._costItem(this.db, positiveId(costItemId, "costItemId"));
    const [mappings, relations, eligibility, operations] = await Promise.all([
      this._mappings(this.db, item.item_code),
      this.db.query(
        `SELECT relation.*,offer.product_name,offer.current_price,
                offer.supplier_code,offer.offer_type,offer.physical_supplier_code,
                offer.availability,offer.checked_at,offer.last_seen_at,offer.source_url
         FROM cost_item_supplier_offers relation
         JOIN file_market_items offer ON offer.id=relation.supplier_offer_id
         WHERE relation.cost_item_id=$1 ORDER BY relation.is_selected DESC,relation.id`,
        [item.id],
      ),
      this.hardDeleteEligibility(item.id),
      this.db.query(
        `SELECT id,operation_type,status,actor,reason,created_at,reversed_at
         FROM cost_integrity_operations
         WHERE target_type='cost_item' AND target_id=$1
         ORDER BY created_at DESC LIMIT 20`,
        [String(item.id)],
      ),
    ]);
    return {
      costItem: item,
      mappings,
      supplierOffers: relations.rows,
      hardDeleteEligibility: eligibility,
      recentOperations: operations.rows,
    };
  }

  async operation(operationId) {
    const row = (
      await this.db.query(
        `SELECT id,batch_id,operation_type,actor,reason,target_type,target_id,
                status,created_at,reversed_at,reversal_reason
         FROM cost_integrity_operations WHERE id=$1`,
        [positiveId(operationId, "operationId")],
      )
    ).rows[0];
    if (!row)
      throw new AppError("Maliyet operasyonu bulunamadı", 404, "COST_OPERATION_NOT_FOUND");
    return row;
  }

  async _operationState(queryable, type, payload, lock) {
    const suffix = lock ? " FOR UPDATE" : "";
    if (type === "CREATE_MANUAL_COST") {
      const marketplace = normalizedMarketplace(payload.marketplace);
      const barcode = required(payload.barcode, "barcode");
      const itemName = required(payload.itemName, "itemName");
      const itemCode = required(payload.itemCode, "itemCode")
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_");
      const unitCost = positiveNumber(payload.unitCost, "unitCost");
      const unitDesi = positiveNumber(payload.unitDesi ?? 0, "unitDesi", {
        allowZero: true,
      });
      const quantity = positiveInteger(payload.quantity, "quantity");
      const physicalSupplierCode = normalizedPhysicalSupplier(
        payload.physicalSupplierCode,
      );
      const checkedAt = new Date(required(payload.checkedAt, "checkedAt"));
      if (Number.isNaN(checkedAt.getTime()))
        throw new AppError("checkedAt geçersizdir", 400, "VALIDATION_ERROR");
      const product = (
        await queryable.query(
          `SELECT * FROM products WHERE marketplace=$1 AND barcode=$2${suffix}`,
          [marketplace, barcode],
        )
      ).rows[0];
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const existingCode = await queryable.query(
        `SELECT id FROM cost_items WHERE item_code=$1${suffix}`,
        [itemCode],
      );
      if (existingCode.rowCount)
        throw new AppError(
          "Bu maliyet kodu zaten kullanılıyor",
          409,
          "COST_ITEM_CODE_EXISTS",
        );
      const productMappings = (
        await queryable.query(
          `SELECT pcm.*,ci.id AS cost_item_id,p.product_name,p.is_active,p.archived
           FROM product_cost_mappings pcm
           LEFT JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
           JOIN products p ON p.marketplace=pcm.marketplace AND p.barcode=pcm.barcode
           WHERE pcm.marketplace=$1 AND pcm.barcode=$2
           ORDER BY pcm.id${lock ? " FOR UPDATE OF pcm" : ""}`,
          [marketplace, barcode],
        )
      ).rows;
      let source = null;
      let sourceMapping = null;
      if (payload.sourceCostItemId) {
        source = await this._costItem(
          queryable,
          positiveId(payload.sourceCostItemId, "sourceCostItemId"),
          suffix,
        );
        sourceMapping = productMappings.find(
          (row) => Number(row.cost_item_id) === Number(source.id),
        );
        if (!sourceMapping)
          throw new AppError(
            "Kaynak mapping bulunamadı",
            404,
            "COST_MAPPING_NOT_FOUND",
          );
      } else if (productMappings.length) {
        throw new AppError(
          "Üründe mevcut mapping var; değiştirilecek mapping seçilmelidir",
          409,
          "SOURCE_MAPPING_REQUIRED",
        );
      }
      const normalizedPayload = {
        marketplace,
        barcode,
        sourceCostItemId: source?.id || null,
        itemCode,
        itemName,
        unitCost,
        unitDesi,
        quantity,
        physicalSupplierCode,
        checkedAt: checkedAt.toISOString(),
      };
      const before = this._snapshot({
        costItems: source ? [source] : [],
        mappings: sourceMapping ? [sourceMapping] : [],
      });
      return {
        payload: normalizedPayload,
        target: { type: "product", id: `${marketplace}:${barcode}` },
        before,
        impact: {
          ...this._assignmentImpact(
            sourceMapping || {
              marketplace,
              barcode,
              product_name: product.product_name,
              is_active: product.is_active,
              archived: product.archived,
            },
            {
              currentUnitCost: source?.unit_cost ?? null,
              targetUnitCost: unitCost,
              currentQuantity: sourceMapping?.quantity ?? null,
              targetQuantity: quantity,
              currentUnitDesi: source?.unit_desi ?? null,
              targetUnitDesi: unitDesi,
              product,
            },
          ),
          createsCanonicalCostItem: true,
        },
        warnings: unitDesi > 0 ? [] : ["TARGET_DESI_MISSING"],
      };
    }
    if (type === "EDIT_MANUAL_COST") {
      const costItemId = positiveId(payload.costItemId, "costItemId");
      const supplierOfferId = positiveId(
        payload.supplierOfferId,
        "supplierOfferId",
      );
      const item = await this._costItem(queryable, costItemId, suffix);
      const offer = await this._supplierOffer(queryable, supplierOfferId, suffix);
      if (offer.offer_type !== "MANUAL")
        throw new AppError(
          "Yalnız manuel maliyet kaynağı düzenlenebilir",
          409,
          "MANUAL_OFFER_REQUIRED",
        );
      const relations = await this._supplierRelations(
        queryable,
        costItemId,
        suffix,
      );
      if (
        !relations.some(
          (row) => Number(row.supplier_offer_id) === supplierOfferId,
        )
      )
        throw new AppError(
          "Manuel offer bu maliyet kalemine bağlı değildir",
          409,
          "SUPPLIER_OFFER_NOT_LINKED",
        );
      const itemName = required(payload.itemName, "itemName");
      const unitCost = positiveNumber(payload.unitCost, "unitCost");
      const physicalSupplierCode = normalizedPhysicalSupplier(
        payload.physicalSupplierCode,
      );
      const checkedAt = new Date(required(payload.checkedAt, "checkedAt"));
      if (Number.isNaN(checkedAt.getTime()))
        throw new AppError("checkedAt geçersizdir", 400, "VALIDATION_ERROR");
      const mappings = await this._mappings(queryable, item.item_code, suffix);
      const legacyLinks = await this._legacyLinks(
        queryable,
        item.item_code,
        lock,
      );
      return {
        payload: {
          costItemId,
          supplierOfferId,
          itemName,
          unitCost,
          physicalSupplierCode,
          checkedAt: checkedAt.toISOString(),
        },
        target: { type: "cost_item", id: costItemId },
        before: this._snapshot({
          costItems: [item],
          relations,
          mappings,
          offers: [offer],
          legacyLinks,
        }),
        impact: this._impact(mappings, item.unit_cost, unitCost),
        warnings: [],
      };
    }
    if (type === "ASSIGN_PRODUCT_COST") {
      const marketplace = normalizedMarketplace(payload.marketplace);
      const barcode = required(payload.barcode, "barcode");
      const targetCostItemId = positiveId(
        payload.targetCostItemId,
        "targetCostItemId",
      );
      const quantity = positiveInteger(payload.quantity, "quantity");
      const product = (
        await queryable.query(
          `SELECT * FROM products WHERE marketplace=$1 AND barcode=$2${suffix}`,
          [marketplace, barcode],
        )
      ).rows[0];
      if (!product)
        throw new AppError("Ürün bulunamadı", 404, "PRODUCT_NOT_FOUND");
      const existing = await queryable.query(
        `SELECT id FROM product_cost_mappings
         WHERE marketplace=$1 AND barcode=$2${lock ? " FOR UPDATE" : ""}`,
        [marketplace, barcode],
      );
      if (existing.rowCount)
        throw new AppError(
          "Üründe mevcut mapping var; yeniden atama kullanılmalıdır",
          409,
          "SOURCE_MAPPING_REQUIRED",
        );
      const targetItem = await this._costItem(
        queryable,
        targetCostItemId,
        suffix,
      );
      const previewMapping = {
        marketplace,
        barcode,
        quantity,
        product_name: product.product_name,
        is_active: product.is_active,
        archived: product.archived,
      };
      return {
        payload: { marketplace, barcode, targetCostItemId, quantity },
        target: { type: "product_mapping", id: `${marketplace}:${barcode}` },
        before: this._snapshot({ costItems: [targetItem] }),
        impact: this._assignmentImpact(previewMapping, {
          currentUnitCost: null,
          targetUnitCost: targetItem.unit_cost,
          currentQuantity: null,
          targetQuantity: quantity,
          currentUnitDesi: null,
          targetUnitDesi: targetItem.unit_desi,
          product,
        }),
        warnings:
          Number(targetItem.unit_desi) > 0 ? [] : ["TARGET_DESI_MISSING"],
      };
    }
    if (["CHANGE_SELECTED_OFFER", "MANUAL_TO_LIVE"].includes(type)) {
      const costItemId = positiveId(payload.costItemId, "costItemId");
      const targetSupplierOfferId = positiveId(
        payload.targetSupplierOfferId,
        "targetSupplierOfferId",
      );
      const item = await this._costItem(queryable, costItemId, suffix);
      const targetOffer = await this._supplierOffer(
        queryable,
        targetSupplierOfferId,
        suffix,
      );
      const relations = await this._supplierRelations(
        queryable,
        costItemId,
        suffix,
      );
      const mappings = await this._mappings(queryable, item.item_code, suffix);
      const legacyLinks = await this._legacyLinks(
        queryable,
        item.item_code,
        lock,
      );
      const targetRelation = relations.find(
        (row) => Number(row.supplier_offer_id) === targetSupplierOfferId,
      );
      if (
        type === "CHANGE_SELECTED_OFFER" &&
        targetRelation?.status !== "APPROVED"
      )
        throw new AppError(
          "Hedef supplier offer onaylı değildir",
          409,
          "SUPPLIER_OFFER_NOT_APPROVED",
        );
      if (!(Number(targetOffer.current_price) > 0))
        throw new AppError(
          "Hedef supplier offer fiyatı geçersizdir",
          409,
          "SUPPLIER_OFFER_PRICE_INVALID",
        );
      const before = this._snapshot({
        costItems: [item],
        relations,
        mappings,
        legacyLinks,
      });
      return {
        payload: { costItemId, targetSupplierOfferId },
        target: { type: "cost_item", id: costItemId },
        before,
        impact: this._impact(
          mappings,
          item.unit_cost,
          targetOffer.current_price,
        ),
        targetOffer,
        warnings:
          targetOffer.availability === "AVAILABLE"
            ? []
            : ["TARGET_OFFER_NOT_AVAILABLE"],
      };
    }
    if (type === "REASSIGN_PRODUCT_COST") {
      const marketplace = normalizedMarketplace(payload.marketplace);
      const barcode = required(payload.barcode, "barcode");
      const sourceCostItemId = positiveId(
        payload.sourceCostItemId,
        "sourceCostItemId",
      );
      const targetCostItemId = positiveId(
        payload.targetCostItemId,
        "targetCostItemId",
      );
      const quantity = positiveInteger(payload.quantity, "quantity");
      const source = await this._costItem(queryable, sourceCostItemId, suffix);
      const targetItem = await this._costItem(
        queryable,
        targetCostItemId,
        suffix,
      );
      const mapping = (
        await queryable.query(
          `SELECT pcm.*,p.product_name,p.is_active,p.archived,p.desi,
                  p.manual_desi_override,p.packaging_profile_name,
                  p.packaging_rule_source,p.packaging_cost
           FROM product_cost_mappings pcm
           LEFT JOIN products p ON p.marketplace=pcm.marketplace AND p.barcode=pcm.barcode
           WHERE pcm.marketplace=$1 AND pcm.barcode=$2 AND pcm.cost_item_code=$3${lock ? " FOR UPDATE OF pcm" : ""}`,
          [marketplace, barcode, source.item_code],
        )
      ).rows[0];
      if (!mapping)
        throw new AppError(
          "Kaynak mapping bulunamadı",
          404,
          "COST_MAPPING_NOT_FOUND",
        );
      const before = this._snapshot({
        costItems: [source, targetItem],
        mappings: [mapping],
      });
      return {
        payload: {
          marketplace,
          barcode,
          sourceCostItemId,
          targetCostItemId,
          quantity,
        },
        target: { type: "product_mapping", id: mapping.id },
        before,
        impact: this._assignmentImpact(mapping, {
          currentUnitCost: mapping.effective_unit_cost ?? source.unit_cost,
          targetUnitCost: targetItem.unit_cost,
          currentQuantity: mapping.quantity,
          targetQuantity: quantity,
          currentUnitDesi: source.unit_desi,
          targetUnitDesi: targetItem.unit_desi,
          product: mapping,
        }),
        warnings:
          Number(targetItem.unit_desi) > 0 ? [] : ["TARGET_DESI_MISSING"],
      };
    }
    if (["REPLACE_COST_ITEM", "SPLIT_COST_MAPPINGS"].includes(type)) {
      const sourceCostItemId = positiveId(
        payload.sourceCostItemId,
        "sourceCostItemId",
      );
      const source = await this._costItem(queryable, sourceCostItemId, suffix);
      const mappings = await this._mappings(
        queryable,
        source.item_code,
        suffix,
      );
      let assignments;
      let targetCostItemId = null;
      if (type === "REPLACE_COST_ITEM") {
        targetCostItemId = positiveId(
          payload.targetCostItemId,
          "targetCostItemId",
        );
        assignments = mappings.map((row) => ({
          mappingId: Number(row.id),
          targetCostItemId,
        }));
      } else {
        if (!Array.isArray(payload.assignments) || !payload.assignments.length)
          throw new AppError(
            "Split assignments zorunludur",
            400,
            "VALIDATION_ERROR",
          );
        assignments = payload.assignments.map((row) => ({
          mappingId: positiveId(row.mappingId, "mappingId"),
          targetCostItemId: positiveId(
            row.targetCostItemId,
            "targetCostItemId",
          ),
        }));
        const expected = mappings
          .map((row) => Number(row.id))
          .sort((a, b) => a - b);
        const actual = assignments
          .map((row) => row.mappingId)
          .sort((a, b) => a - b);
        if (JSON.stringify(expected) !== JSON.stringify(actual))
          throw new AppError(
            "Split bütün mevcut mappingleri tam bir kez kapsamalıdır",
            409,
            "INCOMPLETE_SPLIT",
          );
      }
      const targetIds = [
        ...new Set(assignments.map((row) => row.targetCostItemId)),
      ];
      const targets = [];
      for (const id of targetIds)
        targets.push(await this._costItem(queryable, id, suffix));
      const aliases = await this._aliases(
        queryable,
        [source.item_code],
        [sourceCostItemId, ...targetIds],
        lock,
      );
      if (
        type === "REPLACE_COST_ITEM" &&
        aliases.some(
          (row) =>
            row.alias_code === source.item_code &&
            Number(row.canonical_cost_item_id) !== Number(targetCostItemId) &&
            row.status === "ACTIVE",
        )
      )
        throw new AppError(
          "Kaynak item_code başka canonical item için alias olarak kullanılıyor",
          409,
          "COST_ITEM_ALIAS_CONFLICT",
        );
      const assignmentDetails = assignments.map((assignment) => {
        const mapping = mappings.find(
          (row) => Number(row.id) === assignment.mappingId,
        );
        const targetItem = targets.find(
          (row) => Number(row.id) === assignment.targetCostItemId,
        );
        return {
          mappingId: assignment.mappingId,
          targetCostItemId: assignment.targetCostItemId,
          marketplace: mapping.marketplace,
          barcode: mapping.barcode,
          quantity: Number(mapping.quantity),
          currentCostItemCode: mapping.cost_item_code,
          targetCostItemCode: targetItem.item_code,
          currentLineCost: Number(mapping.quantity) * Number(source.unit_cost),
          targetLineCost:
            Number(mapping.quantity) * Number(targetItem.unit_cost),
        };
      });
      const before = this._snapshot({
        costItems: [source, ...targets],
        mappings,
        aliases,
      });
      return {
        payload: { sourceCostItemId, targetCostItemId, assignments },
        target: { type: "cost_item", id: sourceCostItemId },
        before,
        impact: {
          ...this._impact(mappings, source.unit_cost, null),
          assignments: assignmentDetails,
        },
        warnings: mappings.length ? [] : ["SOURCE_HAS_NO_MAPPINGS"],
      };
    }
    if (type === "REPLACE_SUPPLIER_OFFER") {
      const costItemId = positiveId(payload.costItemId, "costItemId");
      const oldSupplierOfferId = positiveId(
        payload.oldSupplierOfferId,
        "oldSupplierOfferId",
      );
      const newSupplierOfferId = positiveId(
        payload.newSupplierOfferId,
        "newSupplierOfferId",
      );
      const item = await this._costItem(queryable, costItemId, suffix);
      const oldOffer = await this._supplierOffer(
        queryable,
        oldSupplierOfferId,
        suffix,
      );
      const newOffer = await this._supplierOffer(
        queryable,
        newSupplierOfferId,
        suffix,
      );
      const relations = await this._supplierRelations(
        queryable,
        costItemId,
        suffix,
      );
      const mappings = await this._mappings(queryable, item.item_code, suffix);
      const legacyLinks = await this._legacyLinks(
        queryable,
        item.item_code,
        lock,
      );
      const selectedOld = relations.some(
        (row) =>
          Number(row.supplier_offer_id) === oldSupplierOfferId &&
          row.is_selected,
      );
      return {
        payload: { costItemId, oldSupplierOfferId, newSupplierOfferId },
        target: { type: "supplier_offer", id: oldSupplierOfferId },
        before: this._snapshot({
          costItems: [item],
          relations,
          mappings,
          offers: [oldOffer, newOffer],
          legacyLinks,
        }),
        impact: this._impact(
          mappings,
          item.unit_cost,
          selectedOld ? newOffer.current_price : item.unit_cost,
        ),
        selectedOld,
        warnings:
          newOffer.availability === "AVAILABLE"
            ? []
            : ["TARGET_OFFER_NOT_AVAILABLE"],
      };
    }
    if (["ARCHIVE_COST_ITEM", "HARD_DELETE_COST_ITEM"].includes(type)) {
      const costItemId = positiveId(payload.costItemId, "costItemId");
      const item = await this._costItem(queryable, costItemId, suffix);
      const mappings = await this._mappings(queryable, item.item_code, suffix);
      const eligibility = await this.hardDeleteEligibility(
        costItemId,
        queryable,
      );
      return {
        payload: { costItemId },
        target: { type: "cost_item", id: costItemId },
        before: this._snapshot({ costItems: [item], mappings }),
        impact: this._impact(mappings, item.unit_cost, item.unit_cost),
        eligibility,
        warnings: mappings.length ? ["COST_ITEM_HAS_MAPPINGS"] : [],
      };
    }
    if (["REPAIR_ORPHAN", "QUARANTINE_ORPHAN"].includes(type)) {
      const sourceTable = required(
        payload.sourceTable,
        "sourceTable",
      ).toUpperCase();
      if (!ORPHAN_TABLES.has(sourceTable))
        throw new AppError(
          "Orphan tablo türü geçersiz",
          400,
          "VALIDATION_ERROR",
        );
      const sourceRowId = positiveId(payload.sourceRowId, "sourceRowId");
      const table =
        sourceTable === "PRODUCT_COST_MAPPINGS"
          ? "product_cost_mappings"
          : "cost_item_file_links";
      const row = (
        await queryable.query(`SELECT * FROM ${table} WHERE id=$1${suffix}`, [
          sourceRowId,
        ])
      ).rows[0];
      if (!row)
        throw new AppError("Orphan kayıt bulunamadı", 404, "ORPHAN_NOT_FOUND");
      const exists = (
        await queryable.query("SELECT 1 FROM cost_items WHERE item_code=$1", [
          row.cost_item_code,
        ])
      ).rowCount;
      if (exists)
        throw new AppError("Kayıt orphan değildir", 409, "ROW_IS_NOT_ORPHAN");
      let targetItem = null;
      if (type === "REPAIR_ORPHAN")
        targetItem = await this._costItem(
          queryable,
          positiveId(payload.targetCostItemId, "targetCostItemId"),
          suffix,
        );
      const mappings = sourceTable === "PRODUCT_COST_MAPPINGS" ? [row] : [];
      return {
        payload: {
          sourceTable,
          sourceRowId,
          targetCostItemId: targetItem?.id || null,
        },
        target: { type: sourceTable.toLowerCase(), id: sourceRowId },
        before: this._snapshot({ mappings, orphan: { sourceTable, row } }),
        impact: this._impact(mappings, 0, targetItem?.unit_cost || 0),
        warnings: ["ORPHAN_RECORD"],
      };
    }
    throw new AppError(
      "Operasyon preview'u bulunamadı",
      400,
      "UNSUPPORTED_COST_OPERATION",
    );
  }

  async _execute(client, type, state, context) {
    if (type === "CREATE_MANUAL_COST")
      return this._createManualCost(client, state, context);
    if (type === "EDIT_MANUAL_COST")
      return this._editManualCost(client, state);
    if (["CHANGE_SELECTED_OFFER", "MANUAL_TO_LIVE"].includes(type))
      return this._changeSelected(
        client,
        state,
        context,
        type === "MANUAL_TO_LIVE",
      );
    if (type === "REASSIGN_PRODUCT_COST")
      return this._reassign(client, state, context);
    if (type === "ASSIGN_PRODUCT_COST")
      return this._assign(client, state);
    if (["REPLACE_COST_ITEM", "SPLIT_COST_MAPPINGS"].includes(type))
      return this._moveMappings(client, state, {
        ...context,
        operationType: type,
      });
    if (type === "REPLACE_SUPPLIER_OFFER")
      return this._replaceSupplierOffer(client, state, context);
    if (type === "ARCHIVE_COST_ITEM")
      return this._archive(client, state, context);
    if (type === "HARD_DELETE_COST_ITEM")
      return this._hardDelete(client, state);
    if (type === "REPAIR_ORPHAN") return this._repairOrphan(client, state);
    if (type === "QUARANTINE_ORPHAN")
      return this._quarantineOrphan(client, state, context);
    throw new AppError(
      "Operasyon uygulanamıyor",
      400,
      "UNSUPPORTED_COST_OPERATION",
    );
  }

  async _createManualCost(client, state, context) {
    const payload = state.payload;
    const item = (
      await client.query(
        `INSERT INTO cost_items(
           item_code,item_name,unit_cost,unit_desi,unit,price_source,
           source_checked_at,manual_review_last_confirmed_at,
           manual_review_next_due_at,manual_review_status,note
         )VALUES($1,$2,$3,$4,'adet','OTHER',$5,$5,$5::timestamptz + INTERVAL '30 days','OK',$6)
         RETURNING *`,
        [
          payload.itemCode,
          payload.itemName,
          payload.unitCost,
          payload.unitDesi,
          payload.checkedAt,
          context.reason,
        ],
      )
    ).rows[0];
    const offer = (
      await client.query(
        `INSERT INTO file_market_items(
           source_key,product_name,normalized_name,current_price,supplier_code,
           availability,offer_type,physical_supplier_code,checked_at,raw_data
         )VALUES($1,$2,LOWER($2),$3,'OTHER','AVAILABLE','MANUAL',$4,$5,$6::jsonb)
         RETURNING *`,
        [
          `MANUAL:${payload.itemCode}`,
          payload.itemName,
          payload.unitCost,
          payload.physicalSupplierCode,
          payload.checkedAt,
          JSON.stringify({ actor: context.actor, reason: context.reason }),
        ],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO cost_item_supplier_offers(
         cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at,
         selected_by,selected_at,selection_reason
       )VALUES($1,$2,'APPROVED',TRUE,$3,NOW(),$3,NOW(),$4)`,
      [item.id, offer.id, context.actor, context.reason],
    );
    await this._syncLegacyLink(client, item.id, offer.id, context.actor);
    let mapping;
    if (payload.sourceCostItemId) {
      const source = await this._costItem(client, payload.sourceCostItemId);
      mapping = (
        await client.query(
          `UPDATE product_cost_mappings
           SET cost_item_code=$4,quantity=$5,updated_at=NOW()
           WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3
           RETURNING *`,
          [
            payload.marketplace,
            payload.barcode,
            source.item_code,
            item.item_code,
            payload.quantity,
          ],
        )
      ).rows[0];
    } else {
      mapping = (
        await client.query(
          `INSERT INTO product_cost_mappings(
             marketplace,barcode,cost_item_code,quantity,updated_at
           )VALUES($1,$2,$3,$4,NOW()) RETURNING *`,
          [payload.marketplace, payload.barcode, item.item_code, payload.quantity],
        )
      ).rows[0];
    }
    const relations = await this._supplierRelations(client, item.id);
    return {
      after: this._snapshot({
        costItems: [item],
        relations,
        mappings: [mapping],
        offers: [offer],
        legacyLinks: await this._legacyLinks(client, item.item_code),
      }),
      affectedMappings: [mapping],
    };
  }

  async _editManualCost(client, state) {
    const payload = state.payload;
    await client.query(
      `UPDATE file_market_items
       SET product_name=$2,normalized_name=LOWER($2),previous_price=current_price,
           current_price=$3,physical_supplier_code=$4,checked_at=$5,
           last_seen_at=$5,price_changed_at=CASE WHEN current_price<>$3 THEN NOW() ELSE price_changed_at END,
           updated_at=NOW() WHERE id=$1`,
      [
        payload.supplierOfferId,
        payload.itemName,
        payload.unitCost,
        payload.physicalSupplierCode,
        payload.checkedAt,
      ],
    );
    await client.query(
      `UPDATE cost_items
       SET item_name=$2,previous_unit_cost=unit_cost,unit_cost=$3,price_source='OTHER',
           source_checked_at=$4,manual_review_last_confirmed_at=$4,
           manual_review_next_due_at=$4::timestamptz + INTERVAL '30 days',
           manual_review_status='OK',updated_at=NOW() WHERE id=$1`,
      [payload.costItemId, payload.itemName, payload.unitCost, payload.checkedAt],
    );
    return {
      after: await this._currentSnapshot(client, state.before),
      affectedMappings: state.before.mappings,
    };
  }

  async _changeSelected(client, state, context, allowCreate) {
    const { costItemId, targetSupplierOfferId } = state.payload;
    let relation = (
      await client.query(
        `SELECT * FROM cost_item_supplier_offers
         WHERE cost_item_id=$1 AND supplier_offer_id=$2 FOR UPDATE`,
        [costItemId, targetSupplierOfferId],
      )
    ).rows[0];
    if (!relation && allowCreate)
      relation = (
        await client.query(
          `INSERT INTO cost_item_supplier_offers(
             cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at
           )VALUES($1,$2,'APPROVED',FALSE,$3,NOW()) RETURNING *`,
          [costItemId, targetSupplierOfferId, context.actor],
        )
      ).rows[0];
    if (!relation || relation.status !== "APPROVED")
      throw new AppError(
        "Onaylı hedef offer ilişkisi yok",
        409,
        "SUPPLIER_OFFER_NOT_APPROVED",
      );
    if (allowCreate)
      await client.query(
        `UPDATE cost_item_supplier_offers relation
         SET status='ARCHIVED',is_selected=FALSE,updated_at=NOW()
         WHERE relation.cost_item_id=$1 AND relation.is_selected=TRUE
           AND EXISTS(
             SELECT 1 FROM file_market_items offer
             WHERE offer.id=relation.supplier_offer_id
               AND offer.offer_type='MANUAL'
           )`,
        [costItemId],
      );
    await client.query(
      `UPDATE cost_item_supplier_offers SET is_selected=FALSE,updated_at=NOW()
       WHERE cost_item_id=$1 AND is_selected=TRUE`,
      [costItemId],
    );
    await client.query(
      `UPDATE cost_item_supplier_offers
       SET is_selected=TRUE,selected_by=$3,selected_at=NOW(),
           selection_reason=$4,updated_at=NOW()
       WHERE cost_item_id=$1 AND supplier_offer_id=$2`,
      [costItemId, targetSupplierOfferId, context.actor, context.reason],
    );
    const offer = await this._supplierOffer(client, targetSupplierOfferId);
    await client.query(
      `UPDATE cost_items SET previous_unit_cost=unit_cost,unit_cost=$2,
         price_source=COALESCE($3,price_source),source_checked_at=COALESCE($4,NOW()),
         updated_at=NOW() WHERE id=$1`,
      [
        costItemId,
        offer.current_price,
        offer.supplier_code,
        offer.checked_at || offer.last_seen_at,
      ],
    );
    await this._applyOfferPricing(client, costItemId, offer);
    await this._syncLegacyLink(client, costItemId, offer.id, context.actor);
    return {
      after: await this._currentSnapshot(client, state.before),
      affectedMappings: state.before.mappings,
    };
  }

  async _reassign(client, state) {
    const {
      marketplace,
      barcode,
      sourceCostItemId,
      targetCostItemId,
      quantity,
    } = state.payload;
    const source = await this._costItem(client, sourceCostItemId);
    const target = await this._costItem(client, targetCostItemId);
    if (Number(source.id) !== Number(target.id)) {
      const conflict = await client.query(
        `SELECT id FROM product_cost_mappings
         WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3`,
        [marketplace, barcode, target.item_code],
      );
      if (conflict.rowCount)
        throw new AppError(
          "Hedef mapping zaten mevcut",
          409,
          "TARGET_MAPPING_EXISTS",
        );
    }
    await client.query(
      `UPDATE product_cost_mappings SET cost_item_code=$4,quantity=$5,updated_at=NOW()
       WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3`,
      [marketplace, barcode, source.item_code, target.item_code, quantity],
    );
    return {
      after: await this._currentSnapshot(client, state.before),
      affectedMappings: [{ marketplace, barcode }],
    };
  }

  async _assign(client, state) {
    const { marketplace, barcode, targetCostItemId, quantity } = state.payload;
    const target = await this._costItem(client, targetCostItemId);
    const mapping = (
      await client.query(
        `INSERT INTO product_cost_mappings(
           marketplace,barcode,cost_item_code,quantity,updated_at
         )VALUES($1,$2,$3,$4,NOW()) RETURNING *`,
        [marketplace, barcode, target.item_code, quantity],
      )
    ).rows[0];
    return {
      after: this._snapshot({ costItems: [target], mappings: [mapping] }),
      affectedMappings: [mapping],
    };
  }

  async _moveMappings(client, state, context) {
    const source = await this._costItem(client, state.payload.sourceCostItemId);
    const affected = [];
    for (const assignment of state.payload.assignments) {
      const mapping = state.before.mappings.find(
        (row) => Number(row.id) === assignment.mappingId,
      );
      const target = await this._costItem(client, assignment.targetCostItemId);
      const conflict = await client.query(
        `SELECT id FROM product_cost_mappings
         WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3 AND id<>$4`,
        [mapping.marketplace, mapping.barcode, target.item_code, mapping.id],
      );
      if (conflict.rowCount)
        throw new AppError(
          "Hedef mapping zaten mevcut",
          409,
          "TARGET_MAPPING_EXISTS",
        );
      await client.query(
        `UPDATE product_cost_mappings SET cost_item_code=$2,updated_at=NOW()
         WHERE id=$1 AND cost_item_code=$3`,
        [mapping.id, target.item_code, source.item_code],
      );
      affected.push({
        marketplace: mapping.marketplace,
        barcode: mapping.barcode,
      });
    }
    const remaining = await client.query(
      "SELECT 1 FROM product_cost_mappings WHERE cost_item_code=$1 LIMIT 1",
      [source.item_code],
    );
    if (!remaining.rowCount)
      await client.query(
        `UPDATE cost_items SET lifecycle_status='ARCHIVED',archived_at=NOW(),
           archived_by=$2,archive_reason=$3,updated_at=NOW() WHERE id=$1`,
        [source.id, context.actor, context.reason],
      );
    if (!remaining.rowCount && context.operationType === "REPLACE_COST_ITEM") {
      const targetCostItemId = state.payload.targetCostItemId;
      await client.query(
        `INSERT INTO cost_item_aliases(
           alias_code,canonical_cost_item_id,status,actor,reason
         )VALUES($1,$2,'ACTIVE',$3,$4)
         ON CONFLICT(alias_code) DO UPDATE SET
           canonical_cost_item_id=$2,status='ACTIVE',actor=$3,reason=$4,
           updated_at=NOW()`,
        [source.item_code, targetCostItemId, context.actor, context.reason],
      );
    }
    return {
      after: await this._currentSnapshot(client, state.before),
      affectedMappings: affected,
    };
  }

  async _replaceSupplierOffer(client, state, context) {
    const { costItemId, oldSupplierOfferId, newSupplierOfferId } =
      state.payload;
    await client.query(
      `INSERT INTO supplier_offer_relations(
         from_supplier_offer_id,to_supplier_offer_id,relation_type,status,
         approved_at,approved_by,reason
       )VALUES($1,$2,'REPLACED_BY','APPROVED',NOW(),$3,$4)
       ON CONFLICT(from_supplier_offer_id,to_supplier_offer_id,relation_type)
       DO UPDATE SET status='APPROVED',approved_at=NOW(),approved_by=$3,
         reason=$4,reversed_at=NULL,reversed_by=NULL,reversal_reason=NULL,updated_at=NOW()`,
      [oldSupplierOfferId, newSupplierOfferId, context.actor, context.reason],
    );
    await client.query(
      `UPDATE cost_item_supplier_offers SET status='REPLACED',is_selected=FALSE,
         updated_at=NOW() WHERE cost_item_id=$1 AND supplier_offer_id=$2`,
      [costItemId, oldSupplierOfferId],
    );
    if (state.selectedOld) {
      await client.query(
        `INSERT INTO cost_item_supplier_offers(
           cost_item_id,supplier_offer_id,status,is_selected,approved_by,approved_at,
           selected_by,selected_at,selection_reason
         )VALUES($1,$2,'APPROVED',TRUE,$3,NOW(),$3,NOW(),$4)
         ON CONFLICT(cost_item_id,supplier_offer_id) DO UPDATE SET
           status='APPROVED',is_selected=TRUE,approved_by=$3,approved_at=NOW(),
           selected_by=$3,selected_at=NOW(),selection_reason=$4,updated_at=NOW()`,
        [costItemId, newSupplierOfferId, context.actor, context.reason],
      );
      const offer = await this._supplierOffer(client, newSupplierOfferId);
      await client.query(
        `UPDATE cost_items SET previous_unit_cost=unit_cost,unit_cost=$2,
           price_source=$3,source_checked_at=COALESCE($4,NOW()),updated_at=NOW()
         WHERE id=$1`,
        [
          costItemId,
          offer.current_price,
          offer.supplier_code,
          offer.checked_at || offer.last_seen_at,
        ],
      );
      await this._applyOfferPricing(client, costItemId, offer);
      await this._syncLegacyLink(
        client,
        costItemId,
        newSupplierOfferId,
        context.actor,
      );
    }
    return {
      after: await this._currentSnapshot(client, state.before),
      affectedMappings: state.selectedOld ? state.before.mappings : [],
    };
  }

  async _archive(client, state, context) {
    if (state.before.mappings.length)
      throw new AppError(
        "Mapping bulunan cost item archive edilemez",
        409,
        "COST_ITEM_IN_USE",
      );
    await client.query(
      `UPDATE cost_items SET lifecycle_status='ARCHIVED',archived_at=NOW(),
         archived_by=$2,archive_reason=$3,updated_at=NOW() WHERE id=$1`,
      [state.payload.costItemId, context.actor, context.reason],
    );
    return {
      after: await this._currentSnapshot(client, state.before),
      affectedMappings: [],
    };
  }

  async _hardDelete(client, state) {
    if (!state.eligibility.eligible)
      throw new AppError(
        "Cost item kalıcı silmeye uygun değil",
        409,
        "COST_ITEM_IN_USE",
        state.eligibility,
      );
    await client.query("DELETE FROM cost_items WHERE id=$1", [
      state.payload.costItemId,
    ]);
    return { after: { costItems: [], mappings: [] }, affectedMappings: [] };
  }

  async _repairOrphan(client, state) {
    const table =
      state.payload.sourceTable === "PRODUCT_COST_MAPPINGS"
        ? "product_cost_mappings"
        : "cost_item_file_links";
    const target = await this._costItem(client, state.payload.targetCostItemId);
    await client.query(
      `UPDATE ${table} SET cost_item_code=$2,updated_at=NOW() WHERE id=$1`,
      [state.payload.sourceRowId, target.item_code],
    );
    const affected =
      state.payload.sourceTable === "PRODUCT_COST_MAPPINGS"
        ? [
            {
              marketplace: state.before.orphan.row.marketplace,
              barcode: state.before.orphan.row.barcode,
            },
          ]
        : [];
    return {
      after: { repairedTo: target, orphan: state.before.orphan },
      affectedMappings: affected,
    };
  }

  async _quarantineOrphan(client, state, context) {
    await client.query(
      `INSERT INTO cost_integrity_quarantine(
         operation_id,source_table,source_row_id,row_snapshot
       )VALUES($1,$2,$3,$4::jsonb)`,
      [
        context.operationId,
        state.payload.sourceTable,
        state.payload.sourceRowId,
        JSON.stringify(state.before.orphan.row),
      ],
    );
    return {
      after: {
        quarantined: state.before.orphan,
        sourceRowPreserved: true,
      },
      affectedMappings: [],
    };
  }

  async _restoreSnapshot(client, snapshot, actor, reason, original) {
    const affected = [];
    const costItemIds = (snapshot?.costItems || []).map((item) =>
      Number(item.id),
    );
    if (costItemIds.length) {
      await client.query(
        `UPDATE cost_item_supplier_offers SET is_selected=FALSE,updated_at=NOW()
         WHERE cost_item_id=ANY($1::bigint[])`,
        [costItemIds],
      );
      const priorRelationIds = (snapshot?.relations || []).map((row) =>
        Number(row.id),
      );
      await client.query(
        `UPDATE cost_item_supplier_offers SET status='ARCHIVED',is_selected=FALSE,
           updated_at=NOW()
         WHERE cost_item_id=ANY($1::bigint[])
           AND NOT(id=ANY($2::bigint[]))`,
        [costItemIds, priorRelationIds.length ? priorRelationIds : [0]],
      );
    }
    for (const item of snapshot?.costItems || [])
      await client.query(
        `UPDATE cost_items SET item_name=$2,unit_cost=$3,previous_unit_cost=$4,
           unit_desi=$5,unit=$6,note=$7,price_source=$8,source_checked_at=$9,
           manual_review_last_confirmed_at=$10,manual_review_next_due_at=$11,
           manual_review_status=$12,manual_review_note=$13,lifecycle_status=$14,
           archived_at=$15,archived_by=$16,archive_reason=$17,updated_at=NOW()
         WHERE id=$1`,
        [
          item.id,
          item.item_name,
          item.unit_cost,
          item.previous_unit_cost,
          item.unit_desi,
          item.unit,
          item.note,
          item.price_source,
          item.source_checked_at,
          item.manual_review_last_confirmed_at,
          item.manual_review_next_due_at,
          item.manual_review_status,
          item.manual_review_note,
          item.lifecycle_status || "ACTIVE",
          item.archived_at,
          item.archived_by,
          item.archive_reason,
        ],
      );
    for (const offer of snapshot?.offers || [])
      await client.query(
        `UPDATE file_market_items
         SET product_name=$2,normalized_name=$3,current_price=$4,previous_price=$5,
             availability=$6,offer_type=$7,physical_supplier_code=$8,checked_at=$9,
             last_seen_at=$10,price_changed_at=$11,updated_at=NOW()
         WHERE id=$1`,
        [
          offer.id,
          offer.product_name,
          offer.normalized_name,
          offer.current_price,
          offer.previous_price,
          offer.availability,
          offer.offer_type,
          offer.physical_supplier_code,
          offer.checked_at,
          offer.last_seen_at,
          offer.price_changed_at,
        ],
      );
    for (const relation of snapshot?.relations || [])
      await client.query(
        `UPDATE cost_item_supplier_offers SET status=$2,is_selected=$3,
           approved_by=$4,approved_at=$5,selected_by=$6,selected_at=$7,
           selection_reason=$8,updated_at=NOW() WHERE id=$1`,
        [
          relation.id,
          relation.status,
          relation.is_selected,
          relation.approved_by,
          relation.approved_at,
          relation.selected_by,
          relation.selected_at,
          relation.selection_reason,
        ],
      );
    const itemCodes = (snapshot?.costItems || []).map((item) => item.item_code);
    if (itemCodes.length) {
      const priorLegacyIds = (snapshot?.legacyLinks || []).map((row) =>
        Number(row.id),
      );
      await client.query(
        `DELETE FROM cost_item_file_links
         WHERE cost_item_code=ANY($1::text[])
           AND NOT(id=ANY($2::bigint[]))`,
        [itemCodes, priorLegacyIds.length ? priorLegacyIds : [0]],
      );
    }
    for (const link of snapshot?.legacyLinks || [])
      await client.query(
        `INSERT INTO cost_item_file_links(
           id,cost_item_code,file_market_item_id,confidence,status,approved_by,
           approved_at,created_at,updated_at
         )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(cost_item_code) DO UPDATE SET
           file_market_item_id=$3,confidence=$4,status=$5,approved_by=$6,
           approved_at=$7,updated_at=NOW()`,
        [
          link.id,
          link.cost_item_code,
          link.file_market_item_id,
          link.confidence,
          link.status,
          link.approved_by,
          link.approved_at,
          link.created_at,
          link.updated_at,
        ],
      );
    if (original?.operation_type === "REPLACE_COST_ITEM") {
      const source = snapshot?.costItems?.find(
        (item) =>
          Number(item.id) ===
          Number(original.operation_payload?.sourceCostItemId),
      );
      if (source)
        await client.query(
          `UPDATE cost_item_aliases SET status='RETIRED',updated_at=NOW()
           WHERE alias_code=$1 AND status='ACTIVE'`,
          [source.item_code],
        );
    }
    for (const alias of snapshot?.aliases || [])
      await client.query(
        `UPDATE cost_item_aliases SET canonical_cost_item_id=$2,status=$3,
           actor=$4,reason=$5,updated_at=NOW() WHERE id=$1`,
        [
          alias.id,
          alias.canonical_cost_item_id,
          alias.status,
          alias.actor,
          alias.reason,
        ],
      );
    for (const mapping of snapshot?.mappings || []) {
      await client.query(
        `UPDATE product_cost_mappings SET cost_item_code=$2,quantity=$3,
           effective_unit_cost=$4,supplier_price_tier=$5,updated_at=NOW() WHERE id=$1`,
        [
          mapping.id,
          mapping.cost_item_code,
          mapping.quantity,
          mapping.effective_unit_cost,
          mapping.supplier_price_tier,
        ],
      );
      affected.push({
        marketplace: mapping.marketplace,
        barcode: mapping.barcode,
      });
    }
    if (snapshot?.orphan?.row) {
      const quarantine = (
        await client.query(
          `SELECT * FROM cost_integrity_quarantine
           WHERE source_table=$1 AND source_row_id=$2 AND status='QUARANTINED'
           FOR UPDATE`,
          [snapshot.orphan.sourceTable, snapshot.orphan.row.id],
        )
      ).rows[0];
      if (quarantine) {
        const row = snapshot.orphan.row;
        const table =
          snapshot.orphan.sourceTable === "PRODUCT_COST_MAPPINGS"
            ? "product_cost_mappings"
            : "cost_item_file_links";
        const sourceExists = await client.query(
          `SELECT 1 FROM ${table} WHERE id=$1`,
          [row.id],
        );
        if (
          !sourceExists.rowCount &&
          snapshot.orphan.sourceTable === "PRODUCT_COST_MAPPINGS"
        )
          await client.query(
            `INSERT INTO product_cost_mappings(
               id,marketplace,barcode,cost_item_code,quantity,effective_unit_cost,
               supplier_price_tier,updated_at
             )VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              row.id,
              row.marketplace,
              row.barcode,
              row.cost_item_code,
              row.quantity,
              row.effective_unit_cost,
              row.supplier_price_tier,
              row.updated_at,
            ],
          );
        else if (!sourceExists.rowCount)
          await client.query(
            `INSERT INTO cost_item_file_links(
               id,cost_item_code,file_market_item_id,confidence,status,approved_by,
               approved_at,created_at,updated_at
             )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              row.id,
              row.cost_item_code,
              row.file_market_item_id,
              row.confidence,
              row.status,
              row.approved_by,
              row.approved_at,
              row.created_at,
              row.updated_at,
            ],
          );
        await client.query(
          `UPDATE cost_integrity_quarantine SET status='RESTORED',restored_at=NOW(),
             restored_by=$2,restore_reason=$3 WHERE id=$1`,
          [quarantine.id, actor, reason],
        );
      } else {
        const table =
          snapshot.orphan.sourceTable === "PRODUCT_COST_MAPPINGS"
            ? "product_cost_mappings"
            : "cost_item_file_links";
        await client.query(
          `UPDATE ${table} SET cost_item_code=$2,updated_at=NOW() WHERE id=$1`,
          [snapshot.orphan.row.id, snapshot.orphan.row.cost_item_code],
        );
      }
    }
    if (original?.operation_type === "REPLACE_SUPPLIER_OFFER") {
      const payload = original.operation_payload || {};
      await client.query(
        `UPDATE supplier_offer_relations
         SET status='REVERSED',reversed_at=NOW(),reversed_by=$3,
             reversal_reason=$4,updated_at=NOW()
         WHERE from_supplier_offer_id=$1 AND to_supplier_offer_id=$2
           AND relation_type='REPLACED_BY' AND status='APPROVED'`,
        [payload.oldSupplierOfferId, payload.newSupplierOfferId, actor, reason],
      );
    }
    return affected;
  }

  async _reverseManualCreate(client, original) {
    const before = original.before_snapshot || {};
    const after = original.after_snapshot || {};
    const createdItem = after.costItems?.[0];
    const createdOffer = after.offers?.[0];
    const affected = [];
    if (!createdItem || !createdOffer)
      throw new AppError(
        "Manuel maliyet oluşturma kaydı geri alınamıyor",
        409,
        "COST_OPERATION_NOT_REVERSIBLE",
      );
    for (const mapping of after.mappings || []) {
      const originalMapping = (before.mappings || []).find(
        (row) => Number(row.id) === Number(mapping.id),
      );
      if (originalMapping) {
        await client.query(
          `UPDATE product_cost_mappings SET cost_item_code=$2,quantity=$3,
             effective_unit_cost=$4,supplier_price_tier=$5,updated_at=NOW()
           WHERE id=$1`,
          [
            originalMapping.id,
            originalMapping.cost_item_code,
            originalMapping.quantity,
            originalMapping.effective_unit_cost,
            originalMapping.supplier_price_tier,
          ],
        );
        affected.push({
          marketplace: originalMapping.marketplace,
          barcode: originalMapping.barcode,
        });
      } else {
        await client.query(
          "DELETE FROM product_cost_mappings WHERE id=$1 AND cost_item_code=$2",
          [mapping.id, createdItem.item_code],
        );
        affected.push({ marketplace: mapping.marketplace, barcode: mapping.barcode });
      }
    }
    await client.query("DELETE FROM cost_item_file_links WHERE cost_item_code=$1", [
      createdItem.item_code,
    ]);
    await client.query("DELETE FROM cost_item_supplier_offers WHERE cost_item_id=$1", [
      createdItem.id,
    ]);
    await client.query("DELETE FROM file_market_items WHERE id=$1", [createdOffer.id]);
    await client.query("DELETE FROM cost_items WHERE id=$1", [createdItem.id]);
    return affected;
  }

  async _reverseAssignedMapping(client, original) {
    const payload = original.operation_payload || {};
    const target = original.after_snapshot?.costItems?.[0];
    if (!target)
      throw new AppError(
        "Mapping oluşturma işlemi geri alınamıyor",
        409,
        "COST_OPERATION_NOT_REVERSIBLE",
      );
    await client.query(
      `DELETE FROM product_cost_mappings
       WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3`,
      [payload.marketplace, payload.barcode, target.item_code],
    );
    return [{ marketplace: payload.marketplace, barcode: payload.barcode }];
  }

  async _applyOfferPricing(client, costItemId, offer) {
    const item = await this._costItem(client, costItemId);
    const mappings = await client.query(
      `SELECT id,quantity FROM product_cost_mappings
       WHERE cost_item_code=$1 FOR UPDATE`,
      [item.item_code],
    );
    for (const mapping of mappings.rows) {
      const selected =
        offer.supplier_code === "BIZIM_MARKET"
          ? priceTierForQuantity(
              offer.current_price,
              offer.price_tiers || [],
              mapping.quantity,
            )
          : { tier: null, unitPrice: Number(offer.current_price) };
      await client.query(
        `UPDATE product_cost_mappings
         SET effective_unit_cost=$2,supplier_price_tier=$3::jsonb,updated_at=NOW()
         WHERE id=$1`,
        [
          mapping.id,
          selected.tier ? selected.unitPrice : null,
          selected.tier ? JSON.stringify(selected.tier) : null,
        ],
      );
    }
  }

  async _syncLegacyLink(client, costItemId, supplierOfferId, actor) {
    const item = await this._costItem(client, costItemId);
    await client.query(
      `INSERT INTO cost_item_file_links(
         cost_item_code,file_market_item_id,confidence,status,approved_by,approved_at
       )VALUES($1,$2,1,'APPROVED',$3,NOW())
       ON CONFLICT(cost_item_code) DO UPDATE SET
         file_market_item_id=$2,confidence=1,status='APPROVED',approved_by=$3,
         approved_at=NOW(),updated_at=NOW()`,
      [item.item_code, supplierOfferId, actor],
    );
  }

  async _costItem(queryable, id, suffix = "") {
    const row = (
      await queryable.query(`SELECT * FROM cost_items WHERE id=$1${suffix}`, [
        id,
      ])
    ).rows[0];
    if (!row)
      throw new AppError("Cost item bulunamadı", 404, "COST_ITEM_NOT_FOUND");
    return row;
  }

  async _supplierOffer(queryable, id, suffix = "") {
    const row = (
      await queryable.query(
        `SELECT * FROM file_market_items WHERE id=$1${suffix}`,
        [id],
      )
    ).rows[0];
    if (!row)
      throw new AppError(
        "Supplier offer bulunamadı",
        404,
        "SUPPLIER_OFFER_NOT_FOUND",
      );
    return row;
  }

  async _supplierRelations(queryable, costItemId, suffix = "") {
    return (
      await queryable.query(
        `SELECT * FROM cost_item_supplier_offers
         WHERE cost_item_id=$1 ORDER BY id${suffix}`,
        [costItemId],
      )
    ).rows;
  }

  async _mappings(queryable, itemCode, suffix = "") {
    const lockClause = suffix ? " FOR UPDATE OF pcm" : "";
    return (
      await queryable.query(
        `SELECT pcm.*,p.product_name,p.is_active,p.archived
         FROM product_cost_mappings pcm
         LEFT JOIN products p ON p.marketplace=pcm.marketplace AND p.barcode=pcm.barcode
         WHERE pcm.cost_item_code=$1 ORDER BY pcm.marketplace,pcm.barcode,pcm.id${lockClause}`,
        [itemCode],
      )
    ).rows;
  }

  async _aliases(queryable, aliasCodes, canonicalIds, lock = false) {
    return (
      await queryable.query(
        `SELECT * FROM cost_item_aliases
         WHERE alias_code=ANY($1::text[])
            OR canonical_cost_item_id=ANY($2::bigint[])
         ORDER BY id${lock ? " FOR UPDATE" : ""}`,
        [
          aliasCodes.length ? aliasCodes : [""],
          canonicalIds.length ? canonicalIds : [0],
        ],
      )
    ).rows;
  }

  async _legacyLinks(queryable, itemCode, lock = false) {
    return (
      await queryable.query(
        `SELECT * FROM cost_item_file_links
         WHERE cost_item_code=$1 ORDER BY id${lock ? " FOR UPDATE" : ""}`,
        [itemCode],
      )
    ).rows;
  }

  _snapshot({
    costItems = [],
    relations = [],
    mappings = [],
    offers = [],
    aliases = [],
    legacyLinks = [],
    orphan = null,
  }) {
    return {
      costItems,
      relations,
      mappings,
      offers,
      aliases,
      legacyLinks,
      orphan,
    };
  }

  _impact(mappings, oldUnitCost, newUnitCost) {
    const byMarketplace = { TRENDYOL: 0, HEPSIBURADA: 0 };
    for (const mapping of mappings)
      byMarketplace[mapping.marketplace] =
        (byMarketplace[mapping.marketplace] || 0) + 1;
    return {
      mappingCount: mappings.length,
      byMarketplace,
      activeProductCount: mappings.filter(
        (row) => row.is_active && !row.archived,
      ).length,
      currentUnitCost: oldUnitCost === null ? null : Number(oldUnitCost),
      targetUnitCost: newUnitCost === null ? null : Number(newUnitCost),
      unitCostDelta:
        newUnitCost === null || oldUnitCost === null
          ? null
          : Number(newUnitCost) - Number(oldUnitCost),
      mappings: mappings.map((row) => ({
        id: Number(row.id),
        marketplace: row.marketplace,
        barcode: row.barcode,
        productName: row.product_name || null,
        quantity: Number(row.quantity),
        active: Boolean(row.is_active && !row.archived),
      })),
    };
  }

  _assignmentImpact(
    mapping,
    {
      currentUnitCost,
      targetUnitCost,
      currentQuantity,
      targetQuantity,
      currentUnitDesi,
      targetUnitDesi,
      product,
    },
  ) {
    const normalizedCurrentQuantity =
      currentQuantity == null ? null : Number(currentQuantity);
    const normalizedTargetQuantity = Number(targetQuantity);
    const normalizedCurrentUnitCost =
      currentUnitCost == null ? null : Number(currentUnitCost);
    const normalizedTargetUnitCost = Number(targetUnitCost);
    const normalizedCurrentUnitDesi =
      currentUnitDesi == null ? null : Number(currentUnitDesi);
    const normalizedTargetUnitDesi = Number(targetUnitDesi || 0);
    return {
      ...this._impact(
        [{ ...mapping, quantity: normalizedTargetQuantity }],
        normalizedCurrentUnitCost,
        normalizedTargetUnitCost,
      ),
      currentQuantity: normalizedCurrentQuantity,
      targetQuantity: normalizedTargetQuantity,
      currentLineCost:
        normalizedCurrentQuantity == null || normalizedCurrentUnitCost == null
          ? null
          : normalizedCurrentQuantity * normalizedCurrentUnitCost,
      targetLineCost: normalizedTargetQuantity * normalizedTargetUnitCost,
      currentUnitDesi: normalizedCurrentUnitDesi,
      targetUnitDesi: normalizedTargetUnitDesi,
      currentTotalDesi:
        normalizedCurrentQuantity == null || normalizedCurrentUnitDesi == null
          ? null
          : normalizedCurrentQuantity * normalizedCurrentUnitDesi,
      targetTotalDesi: normalizedTargetQuantity * normalizedTargetUnitDesi,
      effectiveProductDesi:
        product?.manual_desi_override == null
          ? Number(product?.desi || 0)
          : Number(product.manual_desi_override),
      manualDesiOverride:
        product?.manual_desi_override == null
          ? null
          : Number(product.manual_desi_override),
      targetEffectiveProductDesi:
        product?.manual_desi_override == null
          ? Math.ceil(normalizedTargetQuantity * normalizedTargetUnitDesi)
          : Number(product.manual_desi_override),
      packagingProfileName: product?.packaging_profile_name || null,
      packagingRuleSource: product?.packaging_rule_source || null,
      packagingCost: Number(product?.packaging_cost || 0),
    };
  }

  async _currentSnapshot(client, before) {
    const costItems = [];
    for (const item of before.costItems || []) {
      const current = await client.query(
        "SELECT * FROM cost_items WHERE id=$1",
        [item.id],
      );
      if (current.rowCount) costItems.push(current.rows[0]);
    }
    const itemIds = costItems.map((item) => Number(item.id));
    const relations = itemIds.length
      ? (
          await client.query(
            `SELECT * FROM cost_item_supplier_offers
             WHERE cost_item_id=ANY($1::bigint[]) ORDER BY id`,
            [itemIds],
          )
        ).rows
      : [];
    const itemCodes = costItems.map((item) => item.item_code);
    const mappings = itemCodes.length
      ? (
          await client.query(
            `SELECT * FROM product_cost_mappings
             WHERE cost_item_code=ANY($1::text[]) ORDER BY id`,
            [itemCodes],
          )
        ).rows
      : [];
    const aliases =
      itemCodes.length || itemIds.length
        ? await this._aliases(client, itemCodes, itemIds)
        : [];
    const legacyLinks = itemCodes.length
      ? (
          await client.query(
            `SELECT * FROM cost_item_file_links
             WHERE cost_item_code=ANY($1::text[]) ORDER BY id`,
            [itemCodes],
          )
        ).rows
      : [];
    const offerIds = [
      ...new Set(
        [
          ...(before.offers || []).map((offer) => Number(offer.id)),
          ...relations.map((relation) => Number(relation.supplier_offer_id)),
        ].filter(Boolean),
      ),
    ];
    const offers = offerIds.length
      ? (
          await client.query(
            "SELECT * FROM file_market_items WHERE id=ANY($1::bigint[]) ORDER BY id",
            [offerIds],
          )
        ).rows
      : [];
    return { costItems, relations, mappings, offers, aliases, legacyLinks };
  }

  async _startOperation(client, input) {
    return (
      await client.query(
        `INSERT INTO cost_integrity_operations(
           batch_id,operation_type,actor,reason,target_type,target_id,status,
           idempotency_key,preview_fingerprint,operation_payload,reverses_operation_id
         )VALUES($1,$2,$3,$4,$5,$6,'PLANNED',$7,$8,$9::jsonb,$10)
         RETURNING *`,
        [
          crypto.randomUUID(),
          input.operationType,
          input.actor,
          input.reason,
          input.targetType,
          input.targetId === undefined ? null : String(input.targetId),
          input.idempotencyKey,
          input.previewFingerprint || null,
          JSON.stringify(input.payload || {}),
          input.reversesOperationId || null,
        ],
      )
    ).rows[0];
  }

  async _finishOperation(client, operationId, { before, after }) {
    return (
      await client.query(
        `UPDATE cost_integrity_operations
         SET before_snapshot=$2::jsonb,after_snapshot=$3::jsonb,status='APPLIED'
         WHERE id=$1 RETURNING *`,
        [
          operationId,
          JSON.stringify(before || null),
          JSON.stringify(after || null),
        ],
      )
    ).rows[0];
  }

  async _idempotentResult(client, key) {
    return (
      await client.query(
        `SELECT * FROM cost_integrity_operations
         WHERE idempotency_key=$1 AND status IN('PLANNED','APPLIED','REVERSED')
         LIMIT 1 FOR UPDATE`,
        [key],
      )
    ).rows[0];
  }

  async _lockIdempotency(client, key) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  }

  _assertFresh(actual, expected) {
    if (actual !== expected)
      throw new AppError(
        "Preview alındıktan sonra maliyet verisi değişti",
        409,
        "STALE_PREVIEW",
      );
  }

  async _recalculate(client, mappings) {
    if (!this.costEngine?.recalculate) return;
    const unique = new Map();
    for (const mapping of mappings || [])
      if (mapping?.marketplace && mapping?.barcode)
        unique.set(`${mapping.marketplace}:${mapping.barcode}`, mapping);
    for (const mapping of unique.values())
      await this.costEngine.recalculate(
        mapping.barcode,
        client,
        mapping.marketplace,
      );
  }
}

module.exports = { CostIntegrityService, fingerprint };
