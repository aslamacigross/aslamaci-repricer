class PublicationRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async listCategories(marketplace) {
    return (
      await this.db.query(
        `SELECT * FROM marketplace_categories
         WHERE marketplace=$1 ORDER BY path,category_name LIMIT 5000`,
        [String(marketplace).toUpperCase()],
      )
    ).rows;
  }

  async listBrands(marketplace, search = "") {
    return (
      await this.db.query(
        `SELECT * FROM marketplace_brands
         WHERE marketplace=$1 AND ($2='' OR brand_name ILIKE '%'||$2||'%')
         ORDER BY brand_name LIMIT 500`,
        [String(marketplace).toUpperCase(), String(search || "")],
      )
    ).rows;
  }

  async targetContext({
    recipeId,
    sourceMarketplace,
    targetMarketplace,
    categoryId,
  }) {
    const source = sourceMarketplace
      ? String(sourceMarketplace).toUpperCase()
      : null;
    const target = String(targetMarketplace).toUpperCase();
    const [
      registry,
      sourceListing,
      targetListing,
      catalogMatch,
      barcode,
      categoryMapping,
    ] = await Promise.all([
      this.db.query(`SELECT * FROM marketplace_registry WHERE code=$1`, [
        target,
      ]),
      source
        ? this.db.query(
            `SELECT * FROM marketplace_listings
               WHERE marketplace=$1 AND recipe_id=$2 ORDER BY updated_at DESC LIMIT 1`,
            [source, recipeId],
          )
        : Promise.resolve({ rows: [] }),
      this.db.query(
        `SELECT * FROM marketplace_listings
           WHERE marketplace=$1 AND recipe_id=$2 ORDER BY updated_at DESC LIMIT 1`,
        [target, recipeId],
      ),
      this.db.query(
        `SELECT * FROM marketplace_catalog_matches
           WHERE marketplace=$1 AND recipe_id=$2
           ORDER BY CASE match_status WHEN 'CONFIRMED' THEN 0 WHEN 'REVIEW_REQUIRED' THEN 1 ELSE 2 END,
                    match_confidence DESC,updated_at DESC LIMIT 1`,
        [target, recipeId],
      ),
      this.db.query(
        `SELECT * FROM listing_barcode_pools
           WHERE marketplace=$1 AND assigned_recipe_id=$2
           ORDER BY created_at DESC LIMIT 1`,
        [target, recipeId],
      ),
      categoryId
        ? Promise.resolve({ rows: [] })
        : this.db.query(
            `SELECT m.* FROM internal_category_mappings m
               JOIN marketplace_listings l
                 ON l.marketplace=$1 AND l.recipe_id=$2
                AND l.marketplace_category_id=m.internal_category
               WHERE m.marketplace=$3 AND m.status='CONFIRMED'
               LIMIT 1`,
            [source, recipeId, target],
          ),
    ]);
    const resolvedCategory =
      categoryId ||
      catalogMatch.rows[0]?.marketplace_category_id ||
      categoryMapping.rows[0]?.marketplace_category_id ||
      null;
    const [commission, rates, barems, packaging, attributes] =
      await Promise.all([
        resolvedCategory
          ? this.db.query(
              `SELECT * FROM commission_rules
             WHERE marketplace=$1 AND category_id=$2 LIMIT 1`,
              [target, resolvedCategory],
            )
          : Promise.resolve({ rows: [] }),
        this.db.query(
          `SELECT * FROM shipping_costs WHERE marketplace=$1 ORDER BY carrier,desi_kg`,
          [target],
        ),
        this.db.query(
          `SELECT * FROM shipping_barems WHERE marketplace=$1 ORDER BY carrier,min_basket`,
          [target],
        ),
        this.db.query(
          `SELECT * FROM packaging_rules WHERE marketplace=$1 ORDER BY min_desi`,
          [target],
        ),
        resolvedCategory
          ? this.db.query(
              `SELECT * FROM marketplace_category_attributes
             WHERE marketplace=$1 AND category_id=$2 ORDER BY required DESC,attribute_name`,
              [target, resolvedCategory],
            )
          : Promise.resolve({ rows: [] }),
      ]);
    return {
      registry: registry.rows[0] || null,
      sourceListing: sourceListing.rows[0] || null,
      targetListing: targetListing.rows[0] || null,
      catalogMatch: catalogMatch.rows[0] || null,
      barcode: barcode.rows[0] || null,
      categoryMapping: categoryMapping.rows[0] || null,
      categoryId: resolvedCategory,
      commission: commission.rows[0] || null,
      rates: rates.rows,
      barems: barems.rows,
      packaging: packaging.rows,
      attributes: attributes.rows,
    };
  }

  async saveDraft(input, queryable = this.db) {
    return (
      await queryable.query(
        `INSERT INTO product_publication_drafts(
           recipe_id,source_marketplace,source_listing_id,target_marketplace,
           catalog_match_id,listing_barcode_pool_id,workflow_status,publication_mode,
           target_category_id,target_brand_id,title,description,attributes,images,
           stock,requested_price_minor,pricing_preview,validation_errors,payload_json,
           dry_run,created_by
         )VALUES(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,
           $15,$16,$17::jsonb,$18::jsonb,$19::jsonb,TRUE,$20
         )
         ON CONFLICT(recipe_id,target_marketplace) DO UPDATE SET
           source_marketplace=EXCLUDED.source_marketplace,
           source_listing_id=EXCLUDED.source_listing_id,
           catalog_match_id=EXCLUDED.catalog_match_id,
           listing_barcode_pool_id=EXCLUDED.listing_barcode_pool_id,
           workflow_status=EXCLUDED.workflow_status,
           publication_mode=EXCLUDED.publication_mode,
           target_category_id=EXCLUDED.target_category_id,
           target_brand_id=EXCLUDED.target_brand_id,title=EXCLUDED.title,
           description=EXCLUDED.description,attributes=EXCLUDED.attributes,
           images=EXCLUDED.images,stock=EXCLUDED.stock,
           requested_price_minor=EXCLUDED.requested_price_minor,
           pricing_preview=EXCLUDED.pricing_preview,
           validation_errors=EXCLUDED.validation_errors,
           payload_json=EXCLUDED.payload_json,dry_run=TRUE,updated_at=NOW()
         RETURNING *`,
        [
          input.recipeId,
          input.sourceMarketplace || null,
          input.sourceListingId || null,
          input.targetMarketplace,
          input.catalogMatchId || null,
          input.listingBarcodePoolId || null,
          input.workflowStatus,
          input.publicationMode,
          input.targetCategoryId || null,
          input.targetBrandId || null,
          input.title || null,
          input.description || null,
          JSON.stringify(input.attributes || {}),
          JSON.stringify(input.images || []),
          Number(input.stock || 0),
          input.requestedPriceMinor ?? null,
          JSON.stringify(input.pricingPreview || {}),
          JSON.stringify(input.validationErrors || []),
          JSON.stringify(input.payload || {}),
          input.actor || null,
        ],
      )
    ).rows[0];
  }

  async listDrafts(filters = {}) {
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`d.target_marketplace=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`d.workflow_status=$${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
      await this.db.query(
        `SELECT d.*,r.recipe_code,r.recipe_name,r.recipe_type,
                b.barcode seller_listing_barcode,
                m.marketplace_product_id,m.marketplace_catalog_barcode,m.match_confidence
         FROM product_publication_drafts d
         JOIN pim_recipes r ON r.id=d.recipe_id
         LEFT JOIN listing_barcode_pools b ON b.id=d.listing_barcode_pool_id
         LEFT JOIN marketplace_catalog_matches m ON m.id=d.catalog_match_id
         ${clause} ORDER BY d.updated_at DESC LIMIT 1000`,
        params,
      )
    ).rows;
  }

  async getDraft(id) {
    return (
      await this.db.query(
        `SELECT d.*,r.recipe_code,r.recipe_name,r.recipe_type,r.status recipe_status,
                b.barcode seller_listing_barcode,
                m.marketplace_product_id,m.marketplace_catalog_barcode,m.match_confidence,m.match_status
         FROM product_publication_drafts d
         JOIN pim_recipes r ON r.id=d.recipe_id
         LEFT JOIN listing_barcode_pools b ON b.id=d.listing_barcode_pool_id
         LEFT JOIN marketplace_catalog_matches m ON m.id=d.catalog_match_id
         WHERE d.id=$1`,
        [id],
      )
    ).rows[0];
  }

  async markDryRun(id, actor, preview) {
    return (
      await this.db.query(
        `UPDATE product_publication_drafts SET
           workflow_status='DRY_RUN_COMPLETE',approved_by=$2,approved_at=NOW(),
           pricing_preview=$3::jsonb,dry_run=TRUE,updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, actor, JSON.stringify(preview || {})],
      )
    ).rows[0];
  }

  async createTransferBatch(input, items) {
    return this.withTransaction(async (client) => {
      const existing = await this.findTransferBatchByIdempotencyKey(
        input.idempotencyKey,
        client,
      );
      if (existing) return existing;
      const readyCount = items.filter(
        (item) => item.itemStatus === "READY_TO_LIST",
      ).length;
      const blockedCount = items.length - readyCount;
      const batch = (
        await client.query(
          `INSERT INTO channel_transfer_batches(
             source_marketplace,target_marketplace,status,idempotency_key,
             total_count,ready_count,blocked_count,requested_by,completed_at
           )VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`,
          [
            input.sourceMarketplace,
            input.targetMarketplace,
            blockedCount ? "PARTIAL" : "PREVIEW_READY",
            input.idempotencyKey,
            items.length,
            readyCount,
            blockedCount,
            input.actor || null,
          ],
        )
      ).rows[0];
      if (!batch) {
        const existing = await this.findTransferBatchByIdempotencyKey(
          input.idempotencyKey,
          client,
        );
        return existing;
      }
      for (const item of items) {
        const draft = item.draftInput
          ? await this.saveDraft(item.draftInput, client)
          : null;
        await client.query(
          `INSERT INTO channel_transfer_items(
             batch_id,recipe_id,source_listing_id,publication_draft_id,item_status,
             catalog_match_status,blocker_codes,preview_json
           )VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
          [
            batch.id,
            item.recipeId,
            item.sourceListingId || null,
            draft?.id || item.publicationDraftId || null,
            item.itemStatus,
            item.catalogMatchStatus || null,
            JSON.stringify(item.blockerCodes || []),
            JSON.stringify(item.preview || {}),
          ],
        );
      }
      return this.getTransferBatch(batch.id, client);
    });
  }

  async findTransferBatchByIdempotencyKey(idempotencyKey, queryable = this.db) {
    const batch = (
      await queryable.query(
        `SELECT id FROM channel_transfer_batches WHERE idempotency_key=$1`,
        [idempotencyKey],
      )
    ).rows[0];
    return batch ? this.getTransferBatch(batch.id, queryable) : null;
  }

  async getTransferBatch(id, queryable = this.db) {
    const batch = (
      await queryable.query(
        `SELECT * FROM channel_transfer_batches WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!batch) return null;
    batch.items = (
      await queryable.query(
        `SELECT i.*,r.recipe_code,r.recipe_name
         FROM channel_transfer_items i JOIN pim_recipes r ON r.id=i.recipe_id
         WHERE i.batch_id=$1 ORDER BY i.id`,
        [id],
      )
    ).rows;
    return batch;
  }

  async listTransferBatches() {
    return (
      await this.db.query(
        `SELECT * FROM channel_transfer_batches ORDER BY created_at DESC LIMIT 200`,
      )
    ).rows;
  }

  async approveRecipe(id, actor) {
    return (
      await this.db.query(
        `UPDATE pim_recipes SET status='APPROVED',approved_by=$2,
           approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, actor],
      )
    ).rows[0];
  }
}

module.exports = { PublicationRepository };
