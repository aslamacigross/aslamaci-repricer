const { isFilePriceFresh } = require("../domain/file-market");
const {
  buildMappingLearningKey,
  buildMappingRecipeKey,
} = require("../domain/mapping-learning");
const { extractSizes } = require("../domain/product-matching");

function inferredUnitDesi(item) {
  const current = Number(item.unit_desi);
  if (Number.isFinite(current) && current > 0) return current;
  const [size] = extractSizes(item.file_product_name || item.item_name || "");
  if (!size) return 1;
  return Number(Math.max(Number(size.value) / 1000, 0.1).toFixed(3));
}

class MappingAutomationRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async importFileItems(rows) {
    return this.withTransaction(async (client) => {
      let created = 0;
      let changed = 0;
      const items = [];
      for (const row of rows) {
        const previous = (
          await client.query(
            "SELECT * FROM file_market_items WHERE source_key=$1 FOR UPDATE",
            [row.source_key],
          )
        ).rows[0];
        const priceChanged =
          previous &&
          Number(previous.current_price) !== Number(row.current_price);
        const item = (
          await client.query(
            `INSERT INTO file_market_items(
              source_key,product_name,normalized_name,brand,size_value,size_unit,
              current_price,currency,availability,raw_data,first_seen_at,last_seen_at,
              price_changed_at,created_at,updated_at
            )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,NOW(),NOW())
            ON CONFLICT(source_key)DO UPDATE SET
              product_name=EXCLUDED.product_name,
              normalized_name=EXCLUDED.normalized_name,
              brand=EXCLUDED.brand,
              size_value=EXCLUDED.size_value,
              size_unit=EXCLUDED.size_unit,
              previous_price=CASE
                WHEN file_market_items.current_price<>EXCLUDED.current_price
                THEN file_market_items.current_price
                ELSE file_market_items.previous_price END,
              current_price=EXCLUDED.current_price,
              currency=EXCLUDED.currency,
              availability=EXCLUDED.availability,
              raw_data=EXCLUDED.raw_data,
              last_seen_at=EXCLUDED.last_seen_at,
              price_changed_at=CASE
                WHEN file_market_items.current_price<>EXCLUDED.current_price
                THEN EXCLUDED.last_seen_at
                ELSE file_market_items.price_changed_at END,
              updated_at=NOW()
            RETURNING *`,
            [
              row.source_key,
              row.product_name,
              row.normalized_name,
              row.brand,
              row.size_value,
              row.size_unit,
              row.current_price,
              row.currency,
              row.availability,
              row.raw_data,
              row.observed_at,
              previous
                ? priceChanged
                  ? row.observed_at
                  : previous.price_changed_at
                : row.observed_at,
            ],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO file_market_price_history(
            file_market_item_id,price,availability,observed_at
          )VALUES($1,$2,$3,$4)`,
          [item.id, row.current_price, row.availability, row.observed_at],
        );
        if (!previous) created++;
        if (priceChanged) changed++;
        items.push(item);
      }
      return { processed: rows.length, created, changed, items };
    });
  }

  async listFileItems({ search, availability, page = 1, limit = 50 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(f.product_name ILIKE $${params.length} OR f.brand ILIKE $${params.length})`,
      );
    }
    if (availability) {
      params.push(availability);
      where.push(`f.availability=$${params.length}`);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const count = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM file_market_items f WHERE ${where.join(" AND ")}`,
      params,
    );
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const items = await this.db.query(
      `SELECT f.*,l.cost_item_code,l.confidence AS link_confidence,
              ci.item_name AS linked_cost_item_name,ci.unit_cost AS linked_unit_cost,
              ci.unit_desi AS linked_unit_desi,
              CASE WHEN f.last_seen_at<NOW()-INTERVAL '30 days' THEN TRUE ELSE FALSE END AS stale
       FROM file_market_items f
       LEFT JOIN cost_item_file_links l ON l.file_market_item_id=f.id AND l.status='APPROVED'
       LEFT JOIN cost_items ci ON ci.item_code=l.cost_item_code
       WHERE ${where.join(" AND ")}
       ORDER BY f.last_seen_at DESC,f.product_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: items.rows,
      total: count.rows[0].total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async trainingRows() {
    return (
      await this.db.query(
        `SELECT p.barcode,p.product_name,p.brand,p.category_id,p.category_name,
                pcm.cost_item_code,pcm.quantity,ci.item_name,ci.unit_cost,ci.unit_desi
         FROM products p
         JOIN product_cost_mappings pcm
           ON pcm.marketplace=p.marketplace AND pcm.barcode=p.barcode
         JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
         WHERE p.marketplace='TRENDYOL'
           AND p.product_name IS NOT NULL
           AND ci.unit_cost>0 AND COALESCE(ci.unit_desi,0)>0
         ORDER BY p.barcode,pcm.id`,
      )
    ).rows;
  }

  async targetProducts(options = 500) {
    const normalized =
      typeof options === "object" && options !== null
        ? options
        : { limit: options };
    const params = [];
    const where = [
      "p.marketplace='TRENDYOL'",
      "p.is_active=TRUE",
      "p.product_name IS NOT NULL",
      `(p.data_status='MAPPING_MISSING' OR COALESCE(mt.mapping_count,0)=0)`,
    ];
    if (normalized.barcode) {
      params.push(String(normalized.barcode).trim());
      where.push(`p.barcode=$${params.length}`);
    }
    params.push(Math.min(Math.max(Number(normalized.limit) || 500, 1), 1000));
    return (
      await this.db.query(
        `SELECT p.barcode,p.product_name,p.brand,p.category_id,p.category_name,
                p.product_image_url,p.data_status,p.is_active,p.stock_quantity,
                p.needs_cost_mapping,p.calculated_product_cost,p.desi
         FROM products p
         LEFT JOIN (
           SELECT marketplace,barcode,COUNT(*)::int AS mapping_count
           FROM product_cost_mappings
           GROUP BY marketplace,barcode
         ) mt ON mt.marketplace=p.marketplace AND mt.barcode=p.barcode
         WHERE ${where.join(" AND ")}
         ORDER BY p.product_name
         LIMIT $${params.length}`,
        params,
      )
    ).rows;
  }

  async fileItemsForMatching() {
    return (
      await this.db.query(
        `SELECT * FROM file_market_items
         WHERE availability='AVAILABLE' AND current_price>0
         ORDER BY last_seen_at DESC LIMIT 5000`,
      )
    ).rows;
  }

  async costItemsForMatching() {
    return (
      await this.db.query(
        `SELECT item_code,item_name,unit_cost,unit_desi,unit
         FROM cost_items WHERE unit_cost>0 AND COALESCE(unit_desi,0)>0
         ORDER BY item_name`,
      )
    ).rows;
  }

  async learningProfiles(keys) {
    const unique = [...new Set((keys || []).filter(Boolean))];
    if (!unique.length) return [];
    const placeholders = unique.map((_, index) => `$${index + 1}`).join(",");
    return (
      await this.db.query(
        `SELECT * FROM mapping_learning_profiles
         WHERE learning_key IN (${placeholders})`,
        unique,
      )
    ).rows;
  }

  async rejectedFingerprints(barcodes = []) {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,fingerprint FROM mapping_suggestions
         WHERE marketplace='TRENDYOL'
           AND status='REJECTED'
           AND barcode=ANY($1::text[])`,
        [unique],
      )
    ).rows.map((row) => `${row.barcode}:${row.fingerprint}`);
  }

  async rejectedRecipeKeys(barcodes = []) {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,items FROM mapping_feedback_events
         WHERE marketplace='TRENDYOL'
           AND decision='REJECTED'
           AND barcode=ANY($1::text[])`,
        [unique],
      )
    ).rows.map((row) => `${row.barcode}:${buildMappingRecipeKey(row.items)}`);
  }

  async rejectedFeedbackHints(barcodes = []) {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,reason,created_at FROM mapping_feedback_events
         WHERE marketplace='TRENDYOL'
           AND decision='REJECTED'
           AND reason IS NOT NULL
           AND reason<>''
           AND barcode=ANY($1::text[])
         ORDER BY barcode,created_at DESC`,
        [unique],
      )
    ).rows;
  }

  async manualCostQueue({ search, page = 1, limit = 50 } = {}) {
    const params = [];
    const where = [
      "mfe.decision='REJECTED'",
      "mfe.reason IS NOT NULL",
      "(LOWER(mfe.reason) LIKE '%manuel%' OR LOWER(mfe.reason) LIKE '%uygulamada bulunmuyor%' OR LOWER(mfe.reason) LIKE '%uygulamada yok%')",
      "p.marketplace='TRENDYOL'",
      "(p.data_status='MAPPING_MISSING' OR p.needs_cost_mapping=TRUE)",
    ];
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(mfe.barcode ILIKE $${params.length} OR p.product_name ILIKE $${params.length} OR mfe.reason ILIKE $${params.length})`,
      );
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const base = `FROM (
        SELECT DISTINCT ON(barcode) *
        FROM mapping_feedback_events
        WHERE marketplace='TRENDYOL'
        ORDER BY barcode,created_at DESC
      ) mfe
      JOIN products p ON p.marketplace=mfe.marketplace AND p.barcode=mfe.barcode
      LEFT JOIN (
        SELECT marketplace,barcode,COUNT(*)::int AS mapping_count
        FROM product_cost_mappings GROUP BY marketplace,barcode
      ) mt ON mt.marketplace=p.marketplace AND mt.barcode=p.barcode
      WHERE ${where.join(" AND ")}`;
    const count = await this.db.query(`SELECT COUNT(*)::int AS total ${base}`, [
      ...params,
    ]);
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const items = await this.db.query(
      `SELECT mfe.id AS feedback_id,mfe.barcode,mfe.reason,mfe.created_at,
              p.product_name,p.product_image_url,p.brand,p.category_name,p.data_status,
              p.needs_cost_mapping,p.calculated_product_cost,p.desi,
              COALESCE(mt.mapping_count,0)::int AS mapping_count
       ${base}
       ORDER BY mfe.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: items.rows,
      total: count.rows[0].total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async markManualCostNeeded(barcode, actor, reason) {
    const normalizedBarcode = String(barcode || "").trim();
    const product = (
      await this.db.query(
        `SELECT barcode,product_name,brand,category_id,category_name
         FROM products
         WHERE marketplace='TRENDYOL' AND barcode=$1`,
        [normalizedBarcode],
      )
    ).rows[0];
    if (!product) return null;
    const learningKey = buildMappingLearningKey({
      barcode: normalizedBarcode,
      source_type: "DIAGNOSTIC_MANUAL_COST",
      product_snapshot: product,
      items: [],
    });
    return (
      await this.db.query(
        `INSERT INTO mapping_feedback_events(
          marketplace,barcode,learning_key,decision,actor,
          base_confidence,confidence,confidence_band,learning_adjustment,
          source_type,items,evidence,reason
        )VALUES('TRENDYOL',$1,$2,'REJECTED',$3,0,0,'LOW',0,
          'DIAGNOSTIC_MANUAL_COST','[]'::jsonb,$4::jsonb,$5)
        RETURNING *`,
        [
          normalizedBarcode,
          learningKey,
          actor,
          JSON.stringify({ source: "mapping_diagnostics", product }),
          reason || "Manuel maliyet girişi gerekli",
        ],
      )
    ).rows[0];
  }

  async saveSuggestions(suggestions, evaluatedBarcodes = []) {
    const evaluated = [
      ...new Set([
        ...evaluatedBarcodes,
        ...suggestions.map((suggestion) => suggestion.barcode),
      ]),
    ];
    if (!evaluated.length)
      return { created: 0, skippedApproved: 0, skippedRejected: 0, items: [] };
    return this.withTransaction(async (client) => {
      const barcodes = suggestions.map((suggestion) => suggestion.barcode);
      const approved = new Set(
        barcodes.length
          ? (
              await client.query(
                `SELECT barcode FROM mapping_suggestions
             WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])
               AND status='APPROVED'`,
                [barcodes],
              )
            ).rows.map((row) => row.barcode)
          : [],
      );
      const rejectedFingerprints = new Set(
        suggestions.length
          ? (
              await client.query(
                `SELECT barcode,fingerprint FROM mapping_suggestions
                 WHERE marketplace='TRENDYOL'
                   AND status='REJECTED'
                   AND barcode=ANY($1::text[])
                   AND fingerprint=ANY($2::text[])`,
                [
                  barcodes,
                  suggestions.map((suggestion) => suggestion.fingerprint),
                ],
              )
            ).rows.map((row) => `${row.barcode}:${row.fingerprint}`)
          : [],
      );
      await client.query(
        `UPDATE mapping_suggestions SET status='STALE',updated_at=NOW()
         WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])
           AND status='PENDING'`,
        [evaluated],
      );
      const saved = [];
      for (const suggestion of suggestions) {
        if (approved.has(suggestion.barcode)) continue;
        if (
          rejectedFingerprints.has(
            `${suggestion.barcode}:${suggestion.fingerprint}`,
          )
        )
          continue;
        const parent = (
          await client.query(
            `INSERT INTO mapping_suggestions(
              marketplace,barcode,status,confidence,base_confidence,
              learning_adjustment,confidence_band,learning_key,
              algorithm_version,source_type,source_barcode,file_market_item_id,
              update_file_price,evidence,product_snapshot,fingerprint
            )VALUES('TRENDYOL',$1,'PENDING',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING *`,
            [
              suggestion.barcode,
              suggestion.confidence,
              suggestion.base_confidence,
              suggestion.learning_adjustment,
              suggestion.confidence_band,
              suggestion.learning_key,
              suggestion.algorithm_version,
              suggestion.source_type,
              suggestion.source_barcode,
              suggestion.file_market_item_id,
              suggestion.update_file_price,
              suggestion.evidence,
              suggestion.product_snapshot,
              suggestion.fingerprint,
            ],
          )
        ).rows[0];
        for (const item of suggestion.items) {
          await client.query(
            `INSERT INTO mapping_suggestion_items(
              suggestion_id,cost_item_code,file_market_item_id,quantity,
              current_unit_cost,suggested_unit_cost,unit_desi
            )VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              parent.id,
              item.cost_item_code,
              item.file_market_item_id,
              item.quantity,
              item.current_unit_cost,
              item.suggested_unit_cost,
              item.unit_desi,
            ],
          );
        }
        saved.push(parent);
      }
      return {
        created: saved.length,
        skippedApproved: approved.size,
        skippedRejected: rejectedFingerprints.size,
        items: saved,
      };
    });
  }

  async attachItems(suggestions, queryable = this.db) {
    if (!suggestions.length) return suggestions;
    const ids = suggestions.map((item) => item.id);
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
    const rows = (
      await queryable.query(
        `SELECT msi.*,ci.item_name,ci.unit_cost,ci.unit_desi,
                f.product_name AS file_product_name,f.current_price AS file_current_price,
                f.last_seen_at AS file_last_seen_at
         FROM mapping_suggestion_items msi
         LEFT JOIN cost_items ci ON ci.item_code=msi.cost_item_code
         LEFT JOIN file_market_items f ON f.id=msi.file_market_item_id
         WHERE msi.suggestion_id IN (${placeholders})
         ORDER BY msi.suggestion_id,msi.id`,
        ids,
      )
    ).rows;
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(String(row.suggestion_id)))
        grouped.set(String(row.suggestion_id), []);
      grouped.get(String(row.suggestion_id)).push(row);
    }
    return suggestions.map((suggestion) => ({
      ...suggestion,
      items: grouped.get(String(suggestion.id)) || [],
    }));
  }

  async listSuggestions({
    search,
    status,
    confidenceBand,
    page = 1,
    limit = 50,
  } = {}) {
    const params = [];
    const where = ["1=1"];
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(ms.barcode ILIKE $${params.length} OR p.product_name ILIKE $${params.length})`,
      );
    }
    if (status) {
      params.push(status);
      where.push(`ms.status=$${params.length}`);
    }
    if (confidenceBand) {
      params.push(confidenceBand);
      where.push(`ms.confidence_band=$${params.length}`);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const count = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM mapping_suggestions ms
       LEFT JOIN products p ON p.marketplace=ms.marketplace AND p.barcode=ms.barcode
       WHERE ${where.join(" AND ")}`,
      params,
    );
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const result = await this.db.query(
      `SELECT ms.*,p.product_name,p.product_image_url,p.brand,p.category_name,
              p.data_status,p.is_active,
              source.product_name AS source_product_name,
              f.product_name AS file_product_name,f.current_price AS file_current_price,
              f.last_seen_at AS file_last_seen_at
       FROM mapping_suggestions ms
       LEFT JOIN products p ON p.marketplace=ms.marketplace AND p.barcode=ms.barcode
       LEFT JOIN products source ON source.marketplace=ms.marketplace
         AND source.barcode=ms.source_barcode
       LEFT JOIN file_market_items f ON f.id=ms.file_market_item_id
       WHERE ${where.join(" AND ")}
       ORDER BY CASE ms.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
                ms.confidence DESC,ms.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: await this.attachItems(result.rows),
      total: count.rows[0].total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async listLearningFeedback({ search, decision, page = 1, limit = 50 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(mfe.barcode ILIKE $${params.length} OR p.product_name ILIKE $${params.length})`,
      );
    }
    if (decision) {
      params.push(decision);
      where.push(`mfe.decision=$${params.length}`);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const count = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM mapping_feedback_events mfe
       LEFT JOIN products p ON p.marketplace=mfe.marketplace AND p.barcode=mfe.barcode
       WHERE ${where.join(" AND ")}`,
      params,
    );
    params.push(safeLimit, (safePage - 1) * safeLimit);
    const result = await this.db.query(
      `SELECT mfe.*,p.product_name,p.product_image_url,
              mlp.accepted_count,mlp.rejected_count
       FROM mapping_feedback_events mfe
       LEFT JOIN products p ON p.marketplace=mfe.marketplace AND p.barcode=mfe.barcode
       LEFT JOIN mapping_learning_profiles mlp ON mlp.learning_key=mfe.learning_key
       WHERE ${where.join(" AND ")}
       ORDER BY mfe.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: result.rows,
      total: count.rows[0].total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async getSuggestionsByIds(ids, queryable = this.db, { lock = false } = {}) {
    if (!ids.length) return [];
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
    if (lock)
      await queryable.query(
        `SELECT id FROM mapping_suggestions
         WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
        ids,
      );
    const result = await queryable.query(
      `SELECT ms.*,p.product_name,p.product_image_url,p.data_status,p.is_active,
              f.product_name AS file_product_name,f.current_price AS file_current_price,
              f.last_seen_at AS file_last_seen_at
       FROM mapping_suggestions ms
       LEFT JOIN products p ON p.marketplace=ms.marketplace AND p.barcode=ms.barcode
       LEFT JOIN file_market_items f ON f.id=ms.file_market_item_id
       WHERE ms.id IN (${placeholders})
       ORDER BY ms.id`,
      ids,
    );
    return this.attachItems(result.rows, queryable);
  }

  async recordFeedback(client, suggestion, decision, actor, input = {}) {
    const learningKey = input.learning_key || suggestion.learning_key;
    if (!learningKey) return;
    const items = input.items?.length ? input.items : suggestion.items;
    const inserted = await client.query(
      `INSERT INTO mapping_feedback_events(
        suggestion_id,marketplace,barcode,learning_key,decision,actor,
        base_confidence,confidence,confidence_band,learning_adjustment,
        source_type,items,evidence,reason
      )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(suggestion_id)DO NOTHING RETURNING id`,
      [
        suggestion.id,
        suggestion.marketplace,
        suggestion.barcode,
        learningKey,
        decision,
        actor,
        suggestion.base_confidence || suggestion.confidence,
        suggestion.confidence,
        suggestion.confidence_band,
        suggestion.learning_adjustment || 0,
        suggestion.source_type,
        JSON.stringify(items),
        JSON.stringify(suggestion.evidence || {}),
        input.reason || null,
      ],
    );
    if (!inserted.rowCount) return;
    await client.query(
      `INSERT INTO mapping_learning_profiles(
        learning_key,accepted_count,rejected_count,sample_context,
        last_decision,last_decision_at
      )VALUES($1,$2,$3,$4,$5,NOW())
      ON CONFLICT(learning_key)DO UPDATE SET
        accepted_count=mapping_learning_profiles.accepted_count+EXCLUDED.accepted_count,
        rejected_count=mapping_learning_profiles.rejected_count+EXCLUDED.rejected_count,
        sample_context=EXCLUDED.sample_context,
        last_decision=EXCLUDED.last_decision,
        last_decision_at=NOW(),updated_at=NOW()`,
      [
        learningKey,
        decision === "APPROVED" ? 1 : 0,
        decision === "REJECTED" ? 1 : 0,
        JSON.stringify({
          barcode: suggestion.barcode,
          brand: suggestion.product_snapshot?.brand || null,
          categoryId: suggestion.product_snapshot?.category_id || null,
          sourceType: suggestion.source_type,
          costItemCodes: items.map((item) => item.cost_item_code),
        }),
        decision,
      ],
    );
  }

  async decide(id, decision, actor, input = {}) {
    return this.withTransaction(async (client) => {
      const suggestions = await this.getSuggestionsByIds([id], client, {
        lock: true,
      });
      const suggestion = suggestions[0];
      if (!suggestion) return null;
      if (suggestion.status !== "PENDING")
        return { conflict: true, suggestion };
      if (decision === "REJECTED") {
        const rejected = (
          await client.query(
            `UPDATE mapping_suggestions SET status='REJECTED',rejection_reason=$1,
             learning_key=COALESCE(learning_key,$2),reviewed_by=$3,
             reviewed_at=NOW(),updated_at=NOW()
             WHERE id=$4 RETURNING *`,
            [input.reason || null, input.learning_key || null, actor, id],
          )
        ).rows[0];
        await this.recordFeedback(client, suggestion, decision, actor, input);
        return rejected;
      }
      if (Array.isArray(input.items) && input.items.length) {
        await client.query(
          "DELETE FROM mapping_suggestion_items WHERE suggestion_id=$1",
          [id],
        );
        for (const item of input.items) {
          await client.query(
            `INSERT INTO mapping_suggestion_items(
              suggestion_id,cost_item_code,file_market_item_id,quantity,
              current_unit_cost,suggested_unit_cost,unit_desi
            )VALUES($1::bigint,$2,$3::bigint,$4::numeric,$5::numeric,$6::numeric,$7::numeric)`,
            [
              id,
              item.cost_item_code,
              item.file_market_item_id || null,
              item.quantity,
              item.current_unit_cost || null,
              item.suggested_unit_cost || null,
              item.unit_desi || null,
            ],
          );
        }
      }
      const approved = (
        await client.query(
          `UPDATE mapping_suggestions SET status='APPROVED',update_file_price=$1,
           learning_key=$2,reviewed_by=$3,
           reviewed_at=NOW(),updated_at=NOW()
           WHERE id=$4 RETURNING *`,
          [
            Boolean(input.update_file_price),
            input.learning_key || null,
            actor,
            id,
          ],
        )
      ).rows[0];
      await this.recordFeedback(client, suggestion, decision, actor, input);
      return approved;
    });
  }

  async markApplied(client, suggestion, actor) {
    const product = (
      await client.query(
        `SELECT barcode,data_status,is_active FROM products
         WHERE marketplace='TRENDYOL' AND barcode=$1 FOR UPDATE`,
        [suggestion.barcode],
      )
    ).rows[0];
    if (!product || !product.is_active)
      return { conflict: "TARGET_NO_LONGER_ACTIVE" };
    const existing = await client.query(
      `SELECT id FROM product_cost_mappings
       WHERE marketplace='TRENDYOL' AND barcode=$1 LIMIT 1`,
      [suggestion.barcode],
    );
    if (existing.rowCount) return { conflict: "TARGET_MAPPING_ALREADY_EXISTS" };
    if (
      suggestion.update_file_price &&
      suggestion.items.some(
        (item) =>
          item.file_market_item_id && !isFilePriceFresh(item.file_last_seen_at),
      )
    )
      return { conflict: "FILE_PRICE_STALE" };
    const codes = suggestion.items.map((item) => item.cost_item_code);
    const codePlaceholders = codes.map((_, index) => `$${index + 1}`).join(",");
    const existingBeforeCreate = (
      await client.query(
        `SELECT item_code FROM cost_items
         WHERE item_code IN (${codePlaceholders}) FOR UPDATE`,
        codes,
      )
    ).rows;
    const existingCodes = new Set(
      existingBeforeCreate.map((item) => item.item_code),
    );
    for (const item of suggestion.items) {
      if (existingCodes.has(item.cost_item_code)) continue;
      const unitDesi = inferredUnitDesi(item);
      if (
        !item.file_market_item_id ||
        Number(item.suggested_unit_cost) <= 0 ||
        unitDesi <= 0
      )
        continue;
      await client.query(
        `INSERT INTO cost_items(
          item_code,item_name,unit_cost,unit_desi,unit,note,
          price_source,source_checked_at,updated_at
        )VALUES($1,$2,$3,$4,'adet',$5,'FILE_MARKET',NOW(),NOW())
        ON CONFLICT(item_code)DO NOTHING`,
        [
          item.cost_item_code,
          item.file_product_name || item.item_name || item.cost_item_code,
          Number(item.suggested_unit_cost),
          unitDesi,
          "Akıllı mapping File direkt eşleşmesiyle oluşturuldu",
        ],
      );
    }
    const costItems = (
      await client.query(
        `SELECT item_code,unit_cost,unit_desi FROM cost_items
         WHERE item_code IN (${codePlaceholders}) FOR UPDATE`,
        codes,
      )
    ).rows;
    if (
      costItems.length !== codes.length ||
      costItems.some(
        (item) => Number(item.unit_cost) <= 0 || Number(item.unit_desi) <= 0,
      )
    )
      return { conflict: "COST_ITEM_INCOMPLETE" };

    for (const item of suggestion.items) {
      if (
        suggestion.update_file_price &&
        item.file_market_item_id &&
        Number(item.file_current_price || item.suggested_unit_cost) > 0
      ) {
        const filePrice = Number(
          item.file_current_price || item.suggested_unit_cost,
        );
        await client.query(
          `UPDATE cost_items SET previous_unit_cost=unit_cost,unit_cost=$1,
           price_source='FILE_MARKET',source_checked_at=NOW(),updated_at=NOW()
           WHERE item_code=$2`,
          [filePrice, item.cost_item_code],
        );
        await client.query(
          `INSERT INTO cost_item_file_links(
            cost_item_code,file_market_item_id,confidence,status,approved_by,approved_at
          )VALUES($1,$2,$3,'APPROVED',$4,NOW())
          ON CONFLICT(cost_item_code)DO UPDATE SET
            file_market_item_id=EXCLUDED.file_market_item_id,
            confidence=EXCLUDED.confidence,status='APPROVED',
            approved_by=EXCLUDED.approved_by,approved_at=NOW(),updated_at=NOW()`,
          [
            item.cost_item_code,
            item.file_market_item_id,
            suggestion.confidence,
            actor,
          ],
        );
      }
      await client.query(
        `INSERT INTO product_cost_mappings(
          marketplace,barcode,cost_item_code,quantity,updated_at
        )VALUES('TRENDYOL',$1,$2,$3,NOW())`,
        [suggestion.barcode, item.cost_item_code, item.quantity],
      );
    }
    await client.query(
      `UPDATE mapping_suggestions SET status='APPLIED',applied_at=NOW(),
       updated_at=NOW() WHERE id=$1`,
      [suggestion.id],
    );
    return { applied: true, barcode: suggestion.barcode };
  }
}

module.exports = { MappingAutomationRepository };
