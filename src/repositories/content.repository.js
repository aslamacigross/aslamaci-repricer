class ContentRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async getListing({ listingId, recipeId, marketplace }) {
    const params = [];
    let where;
    if (listingId) {
      params.push(Number(listingId));
      where = `l.id=$1`;
    } else {
      params.push(Number(recipeId), String(marketplace).toUpperCase());
      where = `l.recipe_id=$1 AND l.marketplace=$2`;
    }
    return (
      await this.db.query(
        `SELECT * FROM marketplace_listings l WHERE ${where}
         ORDER BY l.updated_at DESC,l.id DESC LIMIT 1`,
        params,
      )
    ).rows[0] || null;
  }

  saveDraft(input) {
    return this.withTransaction(async (client) => {
      const row = (
        await client.query(
          `INSERT INTO ai_content_drafts(
             idempotency_key,marketplace,recipe_id,listing_id,publication_draft_id,
             workflow_status,provider_mode,source_facts,source_provenance,
             current_content,proposed_content,diff_json,safety_errors,
             safety_warnings,created_by
           )VALUES($1,$2,$3,$4,$5,'AI_DRAFT',$6,$7::jsonb,$8::jsonb,$9::jsonb,
                    $10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14)
           ON CONFLICT(idempotency_key) DO UPDATE SET
             listing_id=EXCLUDED.listing_id,
             publication_draft_id=EXCLUDED.publication_draft_id,
             provider_mode=EXCLUDED.provider_mode,source_facts=EXCLUDED.source_facts,
             source_provenance=EXCLUDED.source_provenance,
             current_content=EXCLUDED.current_content,
             proposed_content=EXCLUDED.proposed_content,diff_json=EXCLUDED.diff_json,
             safety_errors=EXCLUDED.safety_errors,
             safety_warnings=EXCLUDED.safety_warnings,updated_at=NOW()
           WHERE ai_content_drafts.workflow_status NOT IN('APPROVED','MARKETPLACE_SUBMITTED','VERIFIED')
           RETURNING *`,
          [
            input.idempotencyKey,
            input.marketplace,
            input.recipeId,
            input.listingId || null,
            input.publicationDraftId || null,
            input.providerMode,
            JSON.stringify(input.sourceFacts || {}),
            JSON.stringify(input.sourceProvenance || []),
            JSON.stringify(input.currentContent || {}),
            JSON.stringify(input.proposedContent || {}),
            JSON.stringify(input.diff || []),
            JSON.stringify(input.safetyErrors || []),
            JSON.stringify(input.safetyWarnings || []),
            input.actor || null,
          ],
        )
      ).rows[0];
      if (!row) {
        return (
          await client.query(`SELECT * FROM ai_content_drafts WHERE idempotency_key=$1`, [input.idempotencyKey])
        ).rows[0];
      }
      await client.query(`DELETE FROM listing_content_snapshots WHERE content_draft_id=$1 AND snapshot_type IN('CURRENT','PROPOSED')`, [row.id]);
      for (const snapshot of [
        { type: "CURRENT", content: input.currentContent, checksum: input.currentChecksum },
        { type: "PROPOSED", content: input.proposedContent, checksum: input.proposedChecksum },
      ])
        await client.query(
          `INSERT INTO listing_content_snapshots(
             content_draft_id,listing_id,snapshot_type,content_json,content_checksum,created_by
           )VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
          [row.id, input.listingId || null, snapshot.type, JSON.stringify(snapshot.content || {}), snapshot.checksum, input.actor || null],
        );
      return this.getDraft(row.id, client);
    });
  }

  async listDrafts(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`d.marketplace=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status).toUpperCase());
      where.push(`d.workflow_status=$${params.length}`);
    }
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(`(r.recipe_name ILIKE $${params.length} OR d.proposed_content::text ILIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM ai_content_drafts d
       JOIN pim_recipes r ON r.id=d.recipe_id ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const rows = await this.db.query(
      `SELECT d.*,r.recipe_code,r.recipe_name,r.recipe_type,
              l.seller_listing_barcode,l.publication_state
       FROM ai_content_drafts d
       JOIN pim_recipes r ON r.id=d.recipe_id
       LEFT JOIN marketplace_listings l ON l.id=d.listing_id
       ${clause} ORDER BY d.updated_at DESC,d.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total: count.rows[0].total, page, limit };
  }

  async getDraft(id, queryable = this.db) {
    const row = (
      await queryable.query(
        `SELECT d.*,r.recipe_code,r.recipe_name,r.recipe_type,
                l.seller_listing_barcode,l.publication_state
         FROM ai_content_drafts d
         JOIN pim_recipes r ON r.id=d.recipe_id
         LEFT JOIN marketplace_listings l ON l.id=d.listing_id
         WHERE d.id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) return null;
    row.snapshots = (
      await queryable.query(
        `SELECT * FROM listing_content_snapshots
         WHERE content_draft_id=$1 ORDER BY created_at DESC,id DESC`,
        [id],
      )
    ).rows;
    return row;
  }

  updateDraft(id, input) {
    return this.withTransaction(async (client) => {
      const before = (
        await client.query(`SELECT * FROM ai_content_drafts WHERE id=$1 FOR UPDATE`, [id])
      ).rows[0];
      if (!before) return null;
      const row = (
        await client.query(
          `UPDATE ai_content_drafts SET workflow_status='HUMAN_REVIEW',
             proposed_content=$2::jsonb,diff_json=$3::jsonb,
             safety_errors=$4::jsonb,safety_warnings=$5::jsonb,updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [id, JSON.stringify(input.proposedContent), JSON.stringify(input.diff), JSON.stringify(input.safetyErrors), JSON.stringify(input.safetyWarnings)],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO listing_content_snapshots(
           content_draft_id,listing_id,snapshot_type,content_json,content_checksum,created_by
         )VALUES($1,$2,'PROPOSED',$3::jsonb,$4,$5)`,
        [id, before.listing_id, JSON.stringify(input.proposedContent), input.checksum, input.actor || null],
      );
      return this.getDraft(row.id, client);
    });
  }

  approveDraft(id, actor, checksum) {
    return this.withTransaction(async (client) => {
      const row = (
        await client.query(
          `UPDATE ai_content_drafts SET workflow_status='APPROVED',
             approved_by=$2,approved_at=NOW(),updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [id, actor],
        )
      ).rows[0];
      if (!row) return null;
      await client.query(
        `INSERT INTO listing_content_snapshots(
           content_draft_id,listing_id,snapshot_type,content_json,content_checksum,created_by
         )VALUES($1,$2,'APPROVED',$3::jsonb,$4,$5)`,
        [id, row.listing_id, JSON.stringify(row.proposed_content), checksum, actor],
      );
      return this.getDraft(id, client);
    });
  }

  async snapshot(id) {
    return (
      await this.db.query(`SELECT * FROM listing_content_snapshots WHERE id=$1`, [id])
    ).rows[0] || null;
  }

  async listingHealthInputs(marketplace) {
    return (
      await this.db.query(
        `SELECT l.*,r.recipe_name,r.recipe_type,r.status recipe_status
         FROM marketplace_listings l
         JOIN pim_recipes r ON r.id=l.recipe_id
         WHERE l.marketplace=$1 ORDER BY l.id`,
        [String(marketplace).toUpperCase()],
      )
    ).rows;
  }

  saveHealth(items = []) {
    return this.withTransaction(async (client) => {
      const saved = [];
      for (const item of items)
        saved.push((await client.query(
          `INSERT INTO listing_health_assessments(
             marketplace,listing_id,recipe_id,quality_score,confidence,
             checks_json,data_quality,summary,assessed_at
           )VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,NOW())
           ON CONFLICT(listing_id) DO UPDATE SET
             marketplace=EXCLUDED.marketplace,recipe_id=EXCLUDED.recipe_id,
             quality_score=EXCLUDED.quality_score,confidence=EXCLUDED.confidence,
             checks_json=EXCLUDED.checks_json,data_quality=EXCLUDED.data_quality,
             summary=EXCLUDED.summary,assessed_at=NOW(),updated_at=NOW()
           RETURNING *`,
          [item.marketplace, item.listingId, item.recipeId, item.score, item.confidence, JSON.stringify(item.checks), JSON.stringify(item.dataQuality), item.summary],
        )).rows[0]);
      return saved;
    });
  }

  async listHealth(filters = {}) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const params = [];
    const where = [];
    if (filters.marketplace) {
      params.push(String(filters.marketplace).toUpperCase());
      where.push(`h.marketplace=$${params.length}`);
    }
    if (filters.search) {
      params.push(`%${String(filters.search).trim()}%`);
      where.push(`(r.recipe_name ILIKE $${params.length} OR l.title ILIKE $${params.length} OR l.seller_listing_barcode ILIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query(
      `SELECT COUNT(*)::int total FROM listing_health_assessments h
       JOIN marketplace_listings l ON l.id=h.listing_id
       JOIN pim_recipes r ON r.id=h.recipe_id ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const rows = await this.db.query(
      `SELECT h.*,l.title,l.seller_listing_barcode,l.publication_state,
              r.recipe_name,r.recipe_type
       FROM listing_health_assessments h
       JOIN marketplace_listings l ON l.id=h.listing_id
       JOIN pim_recipes r ON r.id=h.recipe_id
       ${clause} ORDER BY h.quality_score ASC,h.assessed_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total: count.rows[0].total, page, limit };
  }

  async getHealth(id) {
    return (
      await this.db.query(
        `SELECT h.*,l.title,l.description,l.attributes,l.images,l.video,
                l.stock,l.sale_price_minor,l.minimum_price_minor,l.buybox_price_minor,
                l.seller_listing_barcode,l.publication_state,r.recipe_name,r.recipe_type
         FROM listing_health_assessments h
         JOIN marketplace_listings l ON l.id=h.listing_id
         JOIN pim_recipes r ON r.id=h.recipe_id WHERE h.id=$1`,
        [id],
      )
    ).rows[0] || null;
  }
}

module.exports = { ContentRepository };
