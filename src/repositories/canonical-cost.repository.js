const { AppError } = require("../utils/errors");
const { normalizeText } = require("../domain/product-matching");

const OFFER_STATUSES = new Set([
  "CANDIDATE",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
  "REPLACED",
]);
const RELATION_TYPES = new Set(["REPLACED_BY", "ALIAS_OF"]);
const RELATION_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized)
    throw new AppError(`${field} zorunludur`, 400, "VALIDATION_ERROR");
  return normalized;
}

function enumValue(value, allowed, field, fallback) {
  const normalized = String(value || fallback || "")
    .trim()
    .toUpperCase();
  if (!allowed.has(normalized))
    throw new AppError(`${field} geçersizdir`, 400, "VALIDATION_ERROR");
  return normalized;
}

class CanonicalCostRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async resolveCostItemIdentity(code) {
    const normalizedCode = required(code, "cost item code");
    const direct = (
      await this.db.query(
        `SELECT ci.*,'ITEM_CODE' AS resolution_source
         FROM cost_items ci WHERE ci.item_code=$1 LIMIT 1`,
        [normalizedCode],
      )
    ).rows[0];
    if (direct && direct.lifecycle_status !== "ARCHIVED") return direct;
    const aliased = (
      await this.db.query(
        `SELECT ci.*,'ALIAS' AS resolution_source,a.alias_code
         FROM cost_item_aliases a
         JOIN cost_items ci ON ci.id=a.canonical_cost_item_id
         WHERE a.alias_code=$1 AND a.status='ACTIVE'
         LIMIT 1`,
        [normalizedCode],
      )
    ).rows[0];
    return aliased || direct;
  }

  async createAlias({ aliasCode, canonicalCostItemId, actor, reason }) {
    const normalizedAlias = required(aliasCode, "aliasCode");
    return this.withTransaction(async (client) => {
      const direct = (
        await client.query(
          "SELECT id,lifecycle_status FROM cost_items WHERE item_code=$1 LIMIT 1",
          [normalizedAlias],
        )
      ).rows[0];
      if (direct && direct.lifecycle_status !== "ARCHIVED")
        throw new AppError(
          "Alias mevcut bir item_code ile çakışıyor",
          409,
          "COST_ITEM_ALIAS_CONFLICT",
        );
      return (
        await client.query(
          `INSERT INTO cost_item_aliases(
             alias_code,canonical_cost_item_id,status,actor,reason
           )VALUES($1,$2,'ACTIVE',$3,$4)
           RETURNING *`,
          [normalizedAlias, canonicalCostItemId, actor || null, reason || null],
        )
      ).rows[0];
    });
  }

  async linkSupplierOffer({
    costItemId,
    supplierOfferId,
    status = "CANDIDATE",
    isSelected = false,
    approvedBy,
    selectionReason,
  }) {
    const normalizedStatus = enumValue(
      status,
      OFFER_STATUSES,
      "status",
      "CANDIDATE",
    );
    if (isSelected && normalizedStatus !== "APPROVED")
      throw new AppError(
        "Yalnız onaylı offer seçilebilir",
        400,
        "SUPPLIER_OFFER_NOT_APPROVED",
      );
    if (normalizedStatus === "APPROVED") required(approvedBy, "approvedBy");
    if (isSelected) {
      required(selectionReason, "selectionReason");
    }
    return (
      await this.db.query(
        `INSERT INTO cost_item_supplier_offers(
           cost_item_id,supplier_offer_id,status,is_selected,approved_by,
           approved_at,selected_by,selected_at,selection_reason
         )VALUES($1,$2,$3,$4,$5,
           CASE WHEN $3='APPROVED' THEN NOW() ELSE NULL END,
           CASE WHEN $4=TRUE THEN $5 ELSE NULL END,
           CASE WHEN $4=TRUE THEN NOW() ELSE NULL END,$6)
         RETURNING *`,
        [
          costItemId,
          supplierOfferId,
          normalizedStatus,
          isSelected === true,
          approvedBy || null,
          isSelected ? selectionReason : null,
        ],
      )
    ).rows[0];
  }

  async selectSupplierOffer({ costItemId, relationId, actor, reason }) {
    required(actor, "actor");
    required(reason, "reason");
    return this.withTransaction(async (client) => {
      const target = (
        await client.query(
          `SELECT * FROM cost_item_supplier_offers
           WHERE id=$1 AND cost_item_id=$2 AND status='APPROVED'
           FOR UPDATE`,
          [relationId, costItemId],
        )
      ).rows[0];
      if (!target)
        throw new AppError(
          "Onaylı supplier offer ilişkisi bulunamadı",
          404,
          "SUPPLIER_OFFER_RELATION_NOT_FOUND",
        );
      await client.query(
        `UPDATE cost_item_supplier_offers
         SET is_selected=FALSE,updated_at=NOW()
         WHERE cost_item_id=$1 AND is_selected=TRUE AND id<>$2`,
        [costItemId, relationId],
      );
      return (
        await client.query(
          `UPDATE cost_item_supplier_offers
           SET is_selected=TRUE,selected_by=$3,selected_at=NOW(),
               selection_reason=$4,updated_at=NOW()
           WHERE id=$1 AND cost_item_id=$2
           RETURNING *`,
          [relationId, costItemId, actor, reason],
        )
      ).rows[0];
    });
  }

  async createManualOffer({
    costItemId,
    sourceKey,
    productName,
    currentPrice,
    physicalSupplierCode,
    checkedAt,
    actor,
    isSelected = false,
    selectionReason,
  }) {
    const normalizedName = required(productName, "productName");
    const normalizedSourceKey = required(sourceKey, "sourceKey");
    const normalizedCheckedAt = required(checkedAt, "checkedAt");
    const supplierCode = required(
      physicalSupplierCode || "OTHER",
      "physicalSupplierCode",
    ).toUpperCase();
    required(actor, "actor");
    if (!Number.isFinite(Number(currentPrice)) || Number(currentPrice) <= 0)
      throw new AppError(
        "currentPrice sıfırdan büyük olmalıdır",
        400,
        "VALIDATION_ERROR",
      );
    if (isSelected) required(selectionReason, "selectionReason");
    return this.withTransaction(async (client) => {
      const offer = (
        await client.query(
          `INSERT INTO file_market_items(
             source_key,product_name,normalized_name,current_price,availability,
             supplier_code,offer_type,physical_supplier_code,checked_at,
             first_seen_at,last_seen_at
           )VALUES($1,$2,$3,$4,'AVAILABLE','OTHER','MANUAL',$5,$6,NOW(),NOW())
           RETURNING *`,
          [
            normalizedSourceKey,
            normalizedName,
            normalizeText(normalizedName),
            Number(currentPrice),
            supplierCode,
            normalizedCheckedAt,
          ],
        )
      ).rows[0];
      const relation = (
        await client.query(
          `INSERT INTO cost_item_supplier_offers(
             cost_item_id,supplier_offer_id,status,is_selected,approved_by,
             approved_at,selected_by,selected_at,selection_reason
           )VALUES($1,$2,'APPROVED',$3,$4,NOW(),
             CASE WHEN $3=TRUE THEN $4 ELSE NULL END,
             CASE WHEN $3=TRUE THEN NOW() ELSE NULL END,$5)
           RETURNING *`,
          [
            costItemId,
            offer.id,
            isSelected === true,
            actor || null,
            isSelected ? selectionReason : null,
          ],
        )
      ).rows[0];
      return { offer, relation };
    });
  }

  async createOfferRelation({
    fromSupplierOfferId,
    toSupplierOfferId,
    relationType = "REPLACED_BY",
    status = "PENDING",
    approvedBy,
    reason,
  }) {
    const normalizedType = enumValue(
      relationType,
      RELATION_TYPES,
      "relationType",
      "REPLACED_BY",
    );
    const normalizedStatus = enumValue(
      status,
      RELATION_STATUSES,
      "status",
      "PENDING",
    );
    if (normalizedStatus === "APPROVED") {
      required(approvedBy, "approvedBy");
      required(reason, "reason");
    }
    return (
      await this.db.query(
        `INSERT INTO supplier_offer_relations(
           from_supplier_offer_id,to_supplier_offer_id,relation_type,status,
           approved_at,approved_by,reason
         )VALUES($1,$2,$3,$4,
           CASE WHEN $4='APPROVED' THEN NOW() ELSE NULL END,$5,$6)
         RETURNING *`,
        [
          fromSupplierOfferId,
          toSupplierOfferId,
          normalizedType,
          normalizedStatus,
          approvedBy || null,
          reason || null,
        ],
      )
    ).rows[0];
  }

  async reverseOfferRelation(id, { actor, reason }) {
    return (
      await this.db.query(
        `UPDATE supplier_offer_relations
         SET status='REVERSED',reversed_at=NOW(),reversed_by=$2,
             reversal_reason=$3,updated_at=NOW()
         WHERE id=$1 AND status='APPROVED'
         RETURNING *`,
        [id, required(actor, "actor"), required(reason, "reason")],
      )
    ).rows[0];
  }

  async recordIntegrityOperation({
    batchId,
    operationType,
    actor,
    reason,
    targetType,
    targetId,
    before,
    after,
    status = "APPLIED",
  }) {
    return (
      await this.db.query(
        `INSERT INTO cost_integrity_operations(
           batch_id,operation_type,actor,reason,target_type,target_id,
           before_snapshot,after_snapshot,status
         )VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
         RETURNING *`,
        [
          required(batchId, "batchId"),
          required(operationType, "operationType"),
          required(actor, "actor"),
          required(reason, "reason"),
          required(targetType, "targetType"),
          targetId === undefined || targetId === null ? null : String(targetId),
          JSON.stringify(before ?? null),
          JSON.stringify(after ?? null),
          String(status || "APPLIED").toUpperCase(),
        ],
      )
    ).rows[0];
  }

  async markIntegrityOperationReversed(id, { actor, reason }) {
    return (
      await this.db.query(
        `UPDATE cost_integrity_operations
         SET status='REVERSED',reversed_at=NOW(),reversed_by=$2,reversal_reason=$3
         WHERE id=$1 AND status='APPLIED'
         RETURNING *`,
        [id, required(actor, "actor"), required(reason, "reason")],
      )
    ).rows[0];
  }
}

module.exports = { CanonicalCostRepository };
