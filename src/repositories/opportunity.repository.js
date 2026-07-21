class OpportunityRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async generationInputs(targetMarketplace) {
    const target = String(targetMarketplace).toUpperCase();
    const [
      physical,
      recipes,
      components,
      listings,
      matches,
      marketRows,
      sales,
    ] = await Promise.all([
      this.db.query(
        `SELECT p.*,ci.unit_cost,ci.unit_desi,ci.source_checked_at,
                  ci.price_source,ci.updated_at cost_updated_at
           FROM pim_physical_products p
           JOIN cost_items ci ON ci.item_code=p.cost_item_code
           WHERE p.status='ACTIVE' AND ci.unit_cost>0 AND ci.unit_desi>0
           ORDER BY p.id`,
      ),
      this.db.query(
        `SELECT * FROM pim_recipes
           WHERE status IN('APPROVED','REVIEW') ORDER BY id`,
      ),
      this.db.query(
        `SELECT c.*,p.product_name,p.brand,p.product_family,p.variant,
                  p.category,p.volume_ml,p.weight_g
           FROM pim_recipe_components c
           JOIN pim_physical_products p ON p.id=c.physical_product_id
           ORDER BY c.recipe_id,c.id`,
      ),
      this.db.query(
        `SELECT * FROM marketplace_listings
           WHERE marketplace=$1 ORDER BY recipe_id,id`,
        [target],
      ),
      this.db.query(
        `SELECT * FROM marketplace_catalog_matches
           WHERE marketplace=$1 AND match_status<>'REJECTED'
           ORDER BY recipe_id,match_confidence DESC`,
        [target],
      ),
      this.db.query(
        `SELECT p.recipe_id,p.barcode,p.buybox_price,p.second_price,p.third_price,
                  p.rank,p.calculated_min_price,p.commission_rate,
                  p.calculated_shipping_cost,p.my_price,p.has_multiple_seller
           FROM products p
           WHERE p.marketplace=$1 AND p.recipe_id IS NOT NULL AND p.is_active=TRUE`,
        [target],
      ),
      this.db.query(
        `SELECT p.recipe_id,COALESCE(SUM(oi.quantity),0)::numeric family_sales
           FROM marketplace_order_items oi
           JOIN marketplace_orders o ON o.id=oi.order_id AND o.marketplace=$1
           JOIN products p ON p.marketplace=o.marketplace AND p.barcode=oi.barcode
           WHERE p.recipe_id IS NOT NULL
             AND o.order_date>=NOW()-INTERVAL '180 days'
             AND COALESCE(o.status,'') NOT ILIKE '%cancel%'
           GROUP BY p.recipe_id`,
        [target],
      ),
    ]);
    return {
      physical: physical.rows,
      recipes: recipes.rows,
      components: components.rows,
      listings: listings.rows,
      matches: matches.rows,
      marketRows: marketRows.rows,
      sales: sales.rows,
    };
  }

  async saveGenerated(items = []) {
    return this.withTransaction(async (client) => {
      const saved = [];
      for (const item of items) {
        const row = (
          await client.query(
            `INSERT INTO product_opportunities(
               opportunity_key,opportunity_type,target_marketplace,source_marketplace,
               recipe_id,proposed_recipe,bundle_fingerprint,workflow_status,score,
               confidence,signal_breakdown,economics_json,catalog_status,
               listing_barcode_required,data_quality,generation_reason
             )VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'GENERATED',$8,$9,$10::jsonb,
                      $11::jsonb,$12,$13,$14::jsonb,$15)
             ON CONFLICT(opportunity_key) DO UPDATE SET
               recipe_id=EXCLUDED.recipe_id,proposed_recipe=EXCLUDED.proposed_recipe,
               bundle_fingerprint=EXCLUDED.bundle_fingerprint,score=EXCLUDED.score,
               confidence=EXCLUDED.confidence,signal_breakdown=EXCLUDED.signal_breakdown,
               economics_json=EXCLUDED.economics_json,catalog_status=EXCLUDED.catalog_status,
               listing_barcode_required=EXCLUDED.listing_barcode_required,
               data_quality=EXCLUDED.data_quality,generation_reason=EXCLUDED.generation_reason,
               updated_at=NOW()
             WHERE product_opportunities.workflow_status NOT IN('REJECTED','PUBLISHED')
             RETURNING *`,
            [
              item.opportunityKey,
              item.opportunityType,
              item.targetMarketplace,
              item.sourceMarketplace || null,
              item.recipeId || null,
              JSON.stringify(item.proposedRecipe || {}),
              item.bundleFingerprint || null,
              item.score,
              item.confidence,
              JSON.stringify(item.signals || []),
              JSON.stringify(item.economics || {}),
              item.catalogStatus,
              item.listingBarcodeRequired === true,
              JSON.stringify(item.dataQuality || {}),
              item.generationReason || null,
            ],
          )
        ).rows[0];
        if (row) saved.push(row);
      }
      return saved;
    });
  }

  async list(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`o.target_marketplace=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`o.workflow_status=$${params.length}`);
    }
    if (filters.type) {
      params.push(String(filters.type).toUpperCase());
      where.push(`o.opportunity_type=$${params.length}`);
    }
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(
        `(r.recipe_name ILIKE $${params.length} OR o.proposed_recipe::text ILIKE $${params.length})`,
      );
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM product_opportunities o
       LEFT JOIN pim_recipes r ON r.id=o.recipe_id ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const rows = await this.db.query(
      `SELECT o.*,r.recipe_code,r.recipe_name,r.recipe_type
       FROM product_opportunities o
       LEFT JOIN pim_recipes r ON r.id=o.recipe_id
       ${clause} ORDER BY o.score DESC,o.updated_at DESC,o.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total: count.rows[0].total, page, limit };
  }

  async get(id, queryable = this.db) {
    const item = (
      await queryable.query(
        `SELECT o.*,r.recipe_code,r.recipe_name,r.recipe_type
         FROM product_opportunities o
         LEFT JOIN pim_recipes r ON r.id=o.recipe_id WHERE o.id=$1`,
        [id],
      )
    ).rows[0];
    if (!item) return null;
    item.events = (
      await queryable.query(
        `SELECT * FROM product_opportunity_events
         WHERE opportunity_id=$1 ORDER BY created_at DESC,id DESC`,
        [id],
      )
    ).rows;
    return item;
  }

  transition(id, input) {
    return this.withTransaction(async (client) => {
      const before = (
        await client.query(
          `SELECT * FROM product_opportunities WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!before) return null;
      const after = (
        await client.query(
          `UPDATE product_opportunities SET workflow_status=$2,recipe_id=COALESCE($3,recipe_id),
             reviewed_by=$4,reviewed_at=NOW(),rejection_reason=$5,updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [
            id,
            input.status,
            input.recipeId || null,
            input.actor || null,
            input.reason || null,
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO product_opportunity_events(
           opportunity_id,event_type,from_status,to_status,actor,reason,snapshot_json
         )VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          id,
          input.eventType,
          before.workflow_status,
          input.status,
          input.actor || null,
          input.reason || null,
          JSON.stringify(input.snapshot || {}),
        ],
      );
      return this.get(id, client);
    });
  }

  recordCatalogSearch(id, input) {
    return this.withTransaction(async (client) => {
      const before = (
        await client.query(
          `SELECT * FROM product_opportunities WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!before) return null;
      const after = (
        await client.query(
          `UPDATE product_opportunities SET catalog_status=$2,
             listing_barcode_required=$3,workflow_status=$4,updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [
            id,
            input.catalogStatus,
            input.listingBarcodeRequired === true,
            input.status,
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO product_opportunity_events(
           opportunity_id,event_type,from_status,to_status,actor,snapshot_json
         )VALUES($1,'CATALOG_SEARCHED',$2,$3,$4,$5::jsonb)`,
        [
          id,
          before.workflow_status,
          after.workflow_status,
          input.actor || null,
          JSON.stringify(input.snapshot || {}),
        ],
      );
      return this.get(id, client);
    });
  }
}

module.exports = { OpportunityRepository };
