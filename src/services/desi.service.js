const { estimatePackageDesi } = require("../domain/supplier-products");

class DesiService {
  constructor({ db, costEngine }) {
    this.db = db;
    this.costEngine = costEngine;
  }

  async estimateSupplierCosts() {
    const candidates = (
      await this.db.query(
        `SELECT ci.item_code,ci.item_name,ci.unit_desi,ci.desi_source,
                f.product_name supplier_product_name,
                f.estimated_unit_desi,f.desi_confidence supplier_confidence,
                p.product_name,p.product_image_url
         FROM cost_items ci
         JOIN cost_item_file_links l
           ON l.cost_item_code=ci.item_code AND l.status='APPROVED'
         JOIN file_market_items f ON f.id=l.file_market_item_id
         LEFT JOIN LATERAL(
           SELECT p.product_name,p.product_image_url
           FROM product_cost_mappings pcm
           JOIN products p
             ON p.marketplace=pcm.marketplace AND p.barcode=pcm.barcode
           WHERE pcm.cost_item_code=ci.item_code AND p.is_active=TRUE
           ORDER BY p.stock_quantity DESC,p.updated_at DESC LIMIT 1
         ) p ON TRUE
         ORDER BY ci.item_code`,
      )
    ).rows;
    const affectedBarcodes = new Set();
    let updated = 0;
    let queued = 0;
    for (const row of candidates) {
      const estimate = estimatePackageDesi(
        row.supplier_product_name || row.item_name || row.product_name,
        row.estimated_unit_desi,
      );
      const confidence =
        row.supplier_confidence === "HIGH"
          ? "HIGH"
          : estimate.confidence || "LOW";
      if (confidence === "HIGH" && Number(estimate.value) > 0) {
        const changed =
          Math.abs(Number(row.unit_desi || 0) - Number(estimate.value)) >
          0.0001;
        await this.db.query(
          `UPDATE cost_items SET unit_desi=$2,desi_source=$3,
             desi_confidence=$4,desi_checked_at=NOW(),
             updated_at=CASE WHEN unit_desi IS DISTINCT FROM $2
               THEN NOW() ELSE updated_at END
           WHERE item_code=$1`,
          [
            row.item_code,
            estimate.value,
            `SUPPLIER_${estimate.basis}`,
            confidence,
          ],
        );
        await this.db.query(
          `UPDATE desi_review_queue SET status='RESOLVED',updated_at=NOW()
           WHERE cost_item_code=$1`,
          [row.item_code],
        );
        if (changed) {
          updated++;
          const mappings = (
            await this.db.query(
              `SELECT DISTINCT barcode FROM product_cost_mappings
               WHERE cost_item_code=$1`,
              [row.item_code],
            )
          ).rows;
          for (const mapping of mappings) affectedBarcodes.add(mapping.barcode);
        }
        continue;
      }
      await this.db.query(
        `INSERT INTO desi_review_queue(
           cost_item_code,product_name,product_image_url,proposed_desi,
           confidence,basis,status,updated_at
         )VALUES($1,$2,$3,$4,$5,$6,'PENDING',NOW())
         ON CONFLICT(cost_item_code)DO UPDATE SET
           product_name=EXCLUDED.product_name,
           product_image_url=EXCLUDED.product_image_url,
           proposed_desi=EXCLUDED.proposed_desi,
           confidence=EXCLUDED.confidence,basis=EXCLUDED.basis,
           status=CASE WHEN desi_review_queue.status='RESOLVED'
             THEN desi_review_queue.status ELSE 'PENDING' END,
           updated_at=NOW()`,
        [
          row.item_code,
          row.supplier_product_name || row.product_name || row.item_name,
          row.product_image_url || null,
          estimate.value,
          confidence,
          estimate.basis,
        ],
      );
      queued++;
    }
    for (const barcode of affectedBarcodes)
      await this.costEngine.recalculate(barcode);
    return {
      processed: candidates.length,
      successful: updated,
      failed: 0,
      metadata: {
        updated,
        queued,
        recalculated: affectedBarcodes.size,
      },
    };
  }

  async listReviewQueue({ status = "PENDING", limit = 200 } = {}) {
    return (
      await this.db.query(
        `SELECT * FROM desi_review_queue
         WHERE ($1='' OR status=$1)
         ORDER BY updated_at DESC LIMIT $2`,
        [
          String(status || "").toUpperCase(),
          Math.min(Number(limit) || 200, 500),
        ],
      )
    ).rows;
  }

  async resolve(costItemCode, unitDesi, actor) {
    const desi = Number(unitDesi);
    if (!Number.isFinite(desi) || desi <= 0)
      throw new Error("Desi pozitif bir sayı olmalı");
    const item = (
      await this.db.query(
        `UPDATE cost_items SET unit_desi=$2,desi_source='MANUAL_REVIEW',
           desi_confidence='HIGH',desi_checked_at=NOW(),updated_at=NOW()
         WHERE item_code=$1 RETURNING *`,
        [costItemCode, desi],
      )
    ).rows[0];
    if (!item) return null;
    await this.db.query(
      `UPDATE desi_review_queue SET proposed_desi=$2,status='RESOLVED',
         updated_at=NOW() WHERE cost_item_code=$1`,
      [costItemCode, desi],
    );
    await this.db.query(
      `INSERT INTO audit_logs(actor,action,entity_type,entity_id,after_data)
       VALUES($1,'DESI_REVIEW_RESOLVED','cost_item',$2,$3::jsonb)`,
      [actor || "system", costItemCode, JSON.stringify({ unit_desi: desi })],
    );
    const mappings = (
      await this.db.query(
        "SELECT DISTINCT barcode FROM product_cost_mappings WHERE cost_item_code=$1",
        [costItemCode],
      )
    ).rows;
    for (const mapping of mappings)
      await this.costEngine.recalculate(mapping.barcode);
    return item;
  }
}

module.exports = { DesiService };
