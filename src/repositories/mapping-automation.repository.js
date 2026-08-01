const { isSupplierPriceFresh } = require("../domain/file-market");
const {
  estimatePackageDesi,
  priceTierForQuantity,
  supplier,
} = require("../domain/supplier-products");
const {
  buildMappingLearningKey,
  buildMappingRecipeKey,
} = require("../domain/mapping-learning");

function inferredUnitDesi(item) {
  const current = Number(item.unit_desi);
  if (Number.isFinite(current) && current > 0) return current;
  const stored = Number(item.supplier_estimated_unit_desi);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return estimatePackageDesi(
    item.supplier_product_name ||
      item.file_product_name ||
      item.item_name ||
      "",
  ).value;
}

function normalizeMarketplace(value) {
  return String(value || "TRENDYOL")
    .trim()
    .toUpperCase();
}

async function canonicalSupplierItemIds(client, item) {
  const normalizedName = String(item?.normalized_name || "").trim();
  const supplierCode = String(item?.supplier_code || "").trim();
  if (!normalizedName || !supplierCode) return [item.id];
  const rows = (
    await client.query(
      `SELECT id FROM file_market_items
       WHERE supplier_code=$1 AND normalized_name=$2
       ORDER BY last_seen_at DESC NULLS LAST,updated_at DESC NULLS LAST,id DESC`,
      [supplierCode, normalizedName],
    )
  ).rows;
  const ids = rows.map((row) => Number(row.id)).filter(Boolean);
  return ids.length ? ids : [item.id];
}

class MappingAutomationRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async importSupplierItems(
    supplierCode,
    rows,
    { replaceAvailability = false } = {},
  ) {
    return this.withTransaction(async (client) => {
      let created = 0;
      let changed = 0;
      let costCodesUpdated = 0;
      const affectedBarcodes = new Set();
      const items = [];
      for (const row of rows) {
        const previous = (
          await client.query(
            "SELECT * FROM file_market_items WHERE source_key=$1 FOR UPDATE",
            [row.source_key],
          )
        ).rows[0];
        if (previous && previous.supplier_code !== supplierCode) {
          const error = new Error(
            `Tedarikçi kaynak anahtarı çakışıyor: ${row.source_key}`,
          );
          error.code = "SUPPLIER_SOURCE_KEY_CONFLICT";
          throw error;
        }
        const priceChanged =
          previous &&
          Number(previous.current_price) !== Number(row.current_price);
        const item = (
          await client.query(
            `INSERT INTO file_market_items(
              source_key,product_name,normalized_name,brand,size_value,size_unit,
              current_price,currency,availability,raw_data,first_seen_at,last_seen_at,
              price_changed_at,created_at,updated_at,supplier_code,source_url,
              source_category,estimated_unit_desi,desi_confidence,price_tiers
            )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,NOW(),NOW(),
              $13,$14,$15,$16,$17,$18)
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
              source_url=EXCLUDED.source_url,
              source_category=EXCLUDED.source_category,
              estimated_unit_desi=EXCLUDED.estimated_unit_desi,
              desi_confidence=EXCLUDED.desi_confidence,
              price_tiers=CASE
                WHEN EXCLUDED.supplier_code='BIZIM_MARKET'
                  AND JSONB_ARRAY_LENGTH(EXCLUDED.price_tiers)=0
                  AND JSONB_ARRAY_LENGTH(file_market_items.price_tiers)>0
                THEN file_market_items.price_tiers
                ELSE EXCLUDED.price_tiers END,
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
              supplierCode,
              row.source_url || null,
              row.source_category || null,
              row.estimated_unit_desi || null,
              row.desi_confidence || "LOW",
              JSON.stringify(row.price_tiers || []),
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
        const canonicalIds = await canonicalSupplierItemIds(client, item);
        const links = (
          await client.query(
            `SELECT l.cost_item_code,ci.unit_cost,pcm.marketplace,pcm.barcode,
                    pcm.quantity,pcm.effective_unit_cost
             FROM cost_item_file_links l
             JOIN cost_items ci ON ci.item_code=l.cost_item_code
             LEFT JOIN product_cost_mappings pcm
               ON pcm.cost_item_code=l.cost_item_code
             WHERE l.file_market_item_id=ANY($1::bigint[]) AND l.status='APPROVED'
             ORDER BY l.cost_item_code,pcm.marketplace,pcm.barcode`,
            [canonicalIds],
          )
        ).rows;
        for (const costCode of [
          ...new Set(links.map((link) => link.cost_item_code)),
        ]) {
          const linkedRows = links.filter(
            (link) => link.cost_item_code === costCode,
          );
          const oldUnitCost = Number(linkedRows[0]?.unit_cost || 0);
          const baseUnitCost = Number(item.current_price);
          const costChanged =
            Number.isFinite(baseUnitCost) &&
            baseUnitCost > 0 &&
            oldUnitCost !== baseUnitCost;
          if (costChanged) {
            await client.query(
              `UPDATE cost_items SET previous_unit_cost=unit_cost,unit_cost=$2,
                 price_source=$3,source_checked_at=$4,updated_at=NOW()
               WHERE item_code=$1`,
              [costCode, baseUnitCost, supplierCode, row.observed_at],
            );
            costCodesUpdated++;
          } else {
            await client.query(
              `UPDATE cost_items SET price_source=$2,source_checked_at=$3,
                 updated_at=CASE WHEN source_checked_at IS DISTINCT FROM $3
                   THEN NOW() ELSE updated_at END
               WHERE item_code=$1`,
              [costCode, supplierCode, row.observed_at],
            );
          }
          for (const linked of linkedRows) {
            if (!linked.barcode) continue;
            const tier =
              supplierCode === "BIZIM_MARKET"
                ? priceTierForQuantity(
                    baseUnitCost,
                    item.price_tiers || [],
                    linked.quantity,
                  )
                : { unitPrice: baseUnitCost, tier: null };
            await client.query(
              `UPDATE product_cost_mappings SET
                 effective_unit_cost=$4,
                 supplier_price_tier=$5::jsonb,
                 updated_at=NOW()
               WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3`,
              [
                linked.marketplace,
                linked.barcode,
                costCode,
                tier.tier ? tier.unitPrice : null,
                JSON.stringify(tier.tier || null),
              ],
            );
            affectedBarcodes.add(linked.barcode);
          }
          if (costChanged)
            await client.query(
              `INSERT INTO supplier_cost_sync_events(
                 supplier_code,file_market_item_id,cost_item_code,
                 old_unit_cost,new_unit_cost,affected_barcodes,source_observed_at
               )VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
              [
                supplierCode,
                item.id,
                costCode,
                oldUnitCost || null,
                baseUnitCost,
                JSON.stringify(
                  linkedRows.map((link) => link.barcode).filter(Boolean),
                ),
                row.observed_at,
              ],
            );
        }
        items.push(item);
      }
      let unavailable = 0;
      if (replaceAvailability && rows.length) {
        const sourceKeys = rows.map((row) => row.source_key);
        const result = await client.query(
          `UPDATE file_market_items
           SET availability='UNAVAILABLE',updated_at=NOW()
           WHERE supplier_code=$1 AND availability='AVAILABLE'
             AND NOT(source_key=ANY($2::text[]))`,
          [supplierCode, sourceKeys],
        );
        unavailable = result.rowCount;
      }
      return {
        processed: rows.length,
        created,
        changed,
        unavailable,
        costCodesUpdated,
        affectedBarcodes: [...affectedBarcodes],
        items,
      };
    });
  }

  async importFileItems(rows) {
    return this.importSupplierItems("FILE_MARKET", rows);
  }

  async updateSupplierItemPricing(supplierCode, id, input = {}) {
    return this.withTransaction(async (client) => {
      const existing = (
        await client.query(
          `SELECT id,supplier_code FROM file_market_items WHERE id=$1`,
          [Number(id)],
        )
      ).rows[0];
      if (!existing || existing.supplier_code !== supplierCode) return null;
      const item = (
        await client.query(
          `UPDATE file_market_items SET
             previous_price=CASE
               WHEN $2::numeric IS NOT NULL AND current_price<>$2::numeric
               THEN current_price ELSE previous_price END,
             current_price=COALESCE($2::numeric,current_price),
             price_tiers=$3::jsonb,
             price_changed_at=CASE
               WHEN $2::numeric IS NOT NULL AND current_price<>$2::numeric
               THEN NOW() ELSE price_changed_at END,
             updated_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [
            Number(id),
            input.current_price === undefined ? null : input.current_price,
            JSON.stringify(input.price_tiers || []),
          ],
        )
      ).rows[0];
      if (!item) return null;
      const tiers = [...(input.price_tiers || [])]
        .map((tier) => ({
          ...tier,
          min_quantity: Number(tier.min_quantity),
          unit_price: Number(tier.unit_price),
        }))
        .filter((tier) => tier.min_quantity > 1 && tier.unit_price > 0)
        .sort((left, right) => right.min_quantity - left.min_quantity);
      const affected = [];
      const canonicalIds = await canonicalSupplierItemIds(client, item);
      const linkedMappings = (
        await client.query(
          `SELECT pcm.marketplace,pcm.barcode,pcm.cost_item_code,
                  pcm.quantity,pcm.effective_unit_cost,
                  ci.unit_cost AS previous_unit_cost
           FROM cost_item_file_links l
           JOIN product_cost_mappings pcm ON pcm.cost_item_code=l.cost_item_code
           JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
           WHERE l.file_market_item_id=ANY($1::bigint[]) AND l.status='APPROVED'
           ORDER BY pcm.barcode,pcm.cost_item_code`,
          [canonicalIds],
        )
      ).rows;
      for (const costCode of [
        ...new Set(linkedMappings.map((row) => row.cost_item_code)),
      ])
        await client.query(
          `UPDATE cost_items SET
             previous_unit_cost=CASE WHEN unit_cost<>$2 THEN unit_cost
               ELSE previous_unit_cost END,
             unit_cost=$2,price_source=$3,source_checked_at=NOW(),updated_at=NOW()
           WHERE item_code=$1`,
          [costCode, item.current_price, supplierCode],
        );
      for (const mapping of linkedMappings) {
        const selected = priceTierForQuantity(
          item.current_price,
          tiers,
          mapping.quantity,
        );
        const effectiveCost = selected.tier ? selected.unitPrice : null;
        await client.query(
          `UPDATE product_cost_mappings SET
             effective_unit_cost=$4,supplier_price_tier=$5::jsonb,updated_at=NOW()
           WHERE marketplace=$1 AND barcode=$2 AND cost_item_code=$3`,
          [
            mapping.marketplace,
            mapping.barcode,
            mapping.cost_item_code,
            effectiveCost,
            JSON.stringify(selected.tier),
          ],
        );
        affected.push({
          marketplace: mapping.marketplace,
          barcode: mapping.barcode,
          cost_item_code: mapping.cost_item_code,
          quantity: mapping.quantity,
          previous_unit_cost: mapping.effective_unit_cost,
          unit_cost: effectiveCost || Number(item.current_price),
          min_quantity: selected.tier?.min_quantity || null,
          selected_price_tier: selected.tier,
        });
      }
      return { ...item, tier_price_updates: affected };
    });
  }

  async listSupplierItems({
    supplierCode = "FILE_MARKET",
    search,
    availability,
    page = 1,
    limit = 50,
  } = {}) {
    const params = [supplierCode];
    const where = ["1=1"];
    where.push("f.supplier_code=$1");
    if (!availability) where.push("f.availability<>'MERGED'");
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
      items: items.rows.map((item) => ({
        ...item,
        supplier_label:
          supplier(item.supplier_code)?.label || item.supplier_code,
      })),
      total: count.rows[0].total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async listSupplierDuplicateGroups(supplierCode = "FILE_MARKET") {
    return (
      await this.db.query(
        `WITH duplicate_keys AS (
           SELECT supplier_code,normalized_name,COUNT(*)::int AS duplicate_count
           FROM file_market_items
           WHERE supplier_code=$1
             AND normalized_name IS NOT NULL AND normalized_name<>''
             AND availability<>'MERGED'
           GROUP BY supplier_code,normalized_name
           HAVING COUNT(*)>1
         ),
         ranked AS (
           SELECT f.*,
                  ROW_NUMBER() OVER (
                    PARTITION BY f.supplier_code,f.normalized_name
                    ORDER BY f.last_seen_at DESC NULLS LAST,
                             f.updated_at DESC NULLS LAST,
                             f.id DESC
                  ) AS rank
           FROM file_market_items f
           JOIN duplicate_keys d
             ON d.supplier_code=f.supplier_code
            AND d.normalized_name=f.normalized_name
           WHERE f.availability<>'MERGED'
         ),
         link_counts AS (
           SELECT file_market_item_id,COUNT(*)::int AS link_count
           FROM cost_item_file_links
           WHERE status='APPROVED'
           GROUP BY file_market_item_id
         )
         SELECT r.supplier_code,r.normalized_name,
                MAX(r.id) FILTER (WHERE r.rank=1) AS canonical_item_id,
                MAX(r.product_name) FILTER (WHERE r.rank=1) AS canonical_product_name,
                MAX(r.current_price) FILTER (WHERE r.rank=1) AS canonical_price,
                MAX(r.last_seen_at) FILTER (WHERE r.rank=1) AS canonical_last_seen_at,
                COUNT(*)::int AS duplicate_count,
                COALESCE(SUM(l.link_count),0)::int AS total_link_count,
                COALESCE(
                  JSONB_AGG(
                    JSONB_BUILD_OBJECT(
                      'id',r.id,
                      'product_name',r.product_name,
                      'current_price',r.current_price,
                      'last_seen_at',r.last_seen_at,
                      'link_count',COALESCE(l.link_count,0),
                      'canonical',r.rank=1
                    )
                    ORDER BY r.rank,r.last_seen_at DESC NULLS LAST,r.id DESC
                  ),
                  '[]'::jsonb
                ) AS items
         FROM ranked r
         LEFT JOIN link_counts l ON l.file_market_item_id=r.id
         GROUP BY r.supplier_code,r.normalized_name
         ORDER BY total_link_count DESC,duplicate_count DESC,canonical_last_seen_at DESC
         LIMIT 200`,
        [supplierCode],
      )
    ).rows;
  }

  async mergeSupplierDuplicateGroup(supplierCode, normalizedName) {
    return this.withTransaction(async (client) => {
      const rows = (
        await client.query(
          `SELECT id
           FROM file_market_items
           WHERE supplier_code=$1 AND normalized_name=$2
             AND availability<>'MERGED'
           ORDER BY last_seen_at DESC NULLS LAST,updated_at DESC NULLS LAST,id DESC
           FOR UPDATE`,
          [supplierCode, normalizedName],
        )
      ).rows;
      if (rows.length < 2)
        return {
          canonicalItemId: rows[0]?.id || null,
          mergedItemIds: [],
          movedLinks: 0,
        };
      const canonicalItemId = Number(rows[0].id);
      const mergedItemIds = rows.slice(1).map((row) => Number(row.id));
      const moved = await client.query(
        `UPDATE cost_item_file_links
         SET file_market_item_id=$1::bigint,updated_at=NOW()
         WHERE file_market_item_id=ANY($2::bigint[])
           AND status='APPROVED'
           AND NOT EXISTS (
             SELECT 1 FROM cost_item_file_links existing
             WHERE existing.file_market_item_id=$1::bigint
               AND existing.cost_item_code=cost_item_file_links.cost_item_code
               AND existing.status='APPROVED'
           )`,
        [canonicalItemId, mergedItemIds],
      );
      await client.query(
        `UPDATE cost_item_file_links
         SET status='MERGED',updated_at=NOW()
         WHERE file_market_item_id=ANY($2::bigint[])
           AND status='APPROVED'
           AND EXISTS (
             SELECT 1 FROM cost_item_file_links existing
             WHERE existing.file_market_item_id=$1::bigint
               AND existing.cost_item_code=cost_item_file_links.cost_item_code
               AND existing.status='APPROVED'
           )`,
        [canonicalItemId, mergedItemIds],
      );
      await client.query(
        `UPDATE file_market_items
         SET availability='MERGED',
             raw_data=raw_data || JSONB_BUILD_OBJECT(
               'merged_into_id',$1::bigint,
               'merged_at',NOW()
             ),
             updated_at=NOW()
         WHERE id=ANY($2::bigint[])`,
        [canonicalItemId, mergedItemIds],
      );
      return {
        canonicalItemId,
        mergedItemIds,
        movedLinks: moved.rowCount,
      };
    });
  }

  async listFileItems(filters) {
    return this.listSupplierItems({ ...filters, supplierCode: "FILE_MARKET" });
  }

  async trainingRows({ marketplace = "TRENDYOL" } = {}) {
    const selectedMarketplace = normalizeMarketplace(marketplace);
    const marketplaces =
      selectedMarketplace === "TRENDYOL"
        ? ["TRENDYOL"]
        : ["TRENDYOL", selectedMarketplace];
    return (
      await this.db.query(
        `SELECT p.barcode,p.product_name,p.brand,p.category_id,p.category_name,
                pcm.cost_item_code,pcm.quantity,ci.item_name,ci.unit_cost,ci.unit_desi
         FROM products p
         JOIN product_cost_mappings pcm
           ON pcm.marketplace=p.marketplace AND pcm.barcode=p.barcode
         JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
         WHERE p.marketplace=ANY($1::text[])
           AND p.product_name IS NOT NULL
           AND ci.unit_cost>0 AND COALESCE(ci.unit_desi,0)>0
         ORDER BY p.barcode,pcm.id`,
        [marketplaces],
      )
    ).rows;
  }

  async targetProducts(options = 500) {
    const normalized =
      typeof options === "object" && options !== null
        ? options
        : { limit: options };
    const selectedMarketplace = normalizeMarketplace(normalized.marketplace);
    const params = [selectedMarketplace];
    const where = [
      "p.marketplace=$1",
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
        `SELECT p.marketplace,p.barcode,p.product_name,p.brand,p.category_id,p.category_name,
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

  async fileItemsForMatching(supplierCode = null) {
    const params = [];
    const supplierFilter = supplierCode
      ? `AND supplier_code=$${params.push(supplierCode)}`
      : "";
    return (
      await this.db.query(
        `SELECT DISTINCT ON (supplier_code,normalized_name) *
         FROM file_market_items
         WHERE current_price>0
           AND normalized_name IS NOT NULL AND normalized_name<>''
           ${supplierFilter}
         ORDER BY supplier_code,normalized_name,last_seen_at DESC NULLS LAST,updated_at DESC NULLS LAST,id DESC
         LIMIT 5000`,
        params,
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

  async rejectedFingerprints(barcodes = [], marketplace = "TRENDYOL") {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,fingerprint FROM mapping_suggestions
         WHERE marketplace=$2
           AND status='REJECTED'
           AND barcode=ANY($1::text[])`,
        [unique, normalizeMarketplace(marketplace)],
      )
    ).rows.map((row) => `${row.barcode}:${row.fingerprint}`);
  }

  async rejectedRecipeKeys(barcodes = [], marketplace = "TRENDYOL") {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,items FROM mapping_feedback_events
         WHERE marketplace=$2
           AND decision='REJECTED'
           AND barcode=ANY($1::text[])`,
        [unique, normalizeMarketplace(marketplace)],
      )
    ).rows.map((row) => `${row.barcode}:${buildMappingRecipeKey(row.items)}`);
  }

  async rejectedSourceBarcodes(barcodes = [], marketplace = "TRENDYOL") {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,source_barcode FROM mapping_suggestions
         WHERE marketplace=$2
           AND status='REJECTED'
           AND source_barcode IS NOT NULL
           AND source_barcode<>''
           AND barcode=ANY($1::text[])`,
        [unique, normalizeMarketplace(marketplace)],
      )
    ).rows.map((row) => `${row.barcode}:${row.source_barcode}`);
  }

  async rejectedFeedbackHints(barcodes = [], marketplace = "TRENDYOL") {
    const unique = [...new Set((barcodes || []).filter(Boolean))];
    if (!unique.length) return [];
    return (
      await this.db.query(
        `SELECT barcode,reason,created_at FROM mapping_feedback_events
         WHERE marketplace=$2
           AND decision='REJECTED'
           AND reason IS NOT NULL
           AND reason<>''
           AND barcode=ANY($1::text[])
         ORDER BY barcode,created_at DESC`,
        [unique, normalizeMarketplace(marketplace)],
      )
    ).rows;
  }

  async manualCostQueue({
    search,
    page = 1,
    limit = 50,
    marketplace = "TRENDYOL",
  } = {}) {
    const selectedMarketplace = normalizeMarketplace(marketplace);
    const params = [];
    const where = [
      "mfe.decision='REJECTED'",
      "mfe.reason IS NOT NULL",
      "(LOWER(mfe.reason) LIKE '%manuel%' OR LOWER(mfe.reason) LIKE '%uygulamada bulunmuyor%' OR LOWER(mfe.reason) LIKE '%uygulamada yok%')",
      `p.marketplace=$${params.push(selectedMarketplace)}`,
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
        WHERE marketplace=$1
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

  async markManualCostNeeded(barcode, actor, reason, marketplace = "TRENDYOL") {
    const normalizedBarcode = String(barcode || "").trim();
    const selectedMarketplace = normalizeMarketplace(marketplace);
    const product = (
      await this.db.query(
        `SELECT barcode,product_name,brand,category_id,category_name
         FROM products
         WHERE marketplace=$1 AND barcode=$2`,
        [selectedMarketplace, normalizedBarcode],
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
        )VALUES($1,$2,$3,'REJECTED',$4,0,0,'LOW',0,
          'DIAGNOSTIC_MANUAL_COST','[]'::jsonb,$5::jsonb,$6)
        RETURNING *`,
        [
          selectedMarketplace,
          normalizedBarcode,
          learningKey,
          actor,
          JSON.stringify({ source: "mapping_diagnostics", product }),
          reason || "Manuel maliyet girişi gerekli",
        ],
      )
    ).rows[0];
  }

  async saveSuggestions(
    suggestions,
    evaluatedBarcodes = [],
    marketplace = "TRENDYOL",
  ) {
    const selectedMarketplace = normalizeMarketplace(marketplace);
    const uniqueSuggestions = [];
    const seenSuggestions = new Set();
    for (const suggestion of suggestions) {
      const suggestionMarketplace = normalizeMarketplace(
        suggestion.marketplace || selectedMarketplace,
      );
      const key = `${suggestionMarketplace}:${suggestion.barcode}`;
      if (seenSuggestions.has(key)) continue;
      seenSuggestions.add(key);
      uniqueSuggestions.push({
        ...suggestion,
        marketplace: suggestionMarketplace,
      });
    }
    const evaluated = [
      ...new Set([
        ...evaluatedBarcodes,
        ...uniqueSuggestions.map((suggestion) => suggestion.barcode),
      ]),
    ];
    if (!evaluated.length)
      return {
        created: 0,
        skippedApproved: 0,
        skippedRejected: 0,
        skippedDuplicates: 0,
        items: [],
      };
    return this.withTransaction(async (client) => {
      const barcodes = uniqueSuggestions.map(
        (suggestion) => suggestion.barcode,
      );
      const approved = new Set(
        barcodes.length
          ? (
              await client.query(
                `SELECT barcode FROM mapping_suggestions
             WHERE marketplace=$2 AND barcode=ANY($1::text[])
               AND status='APPROVED'`,
                [barcodes, selectedMarketplace],
              )
            ).rows.map((row) => row.barcode)
          : [],
      );
      const rejectedFingerprints = new Set(
        uniqueSuggestions.length
          ? (
              await client.query(
                `SELECT barcode,fingerprint FROM mapping_suggestions
                 WHERE marketplace=$3
                   AND status='REJECTED'
                   AND barcode=ANY($1::text[])
                   AND fingerprint=ANY($2::text[])`,
                [
                  barcodes,
                  uniqueSuggestions.map((suggestion) => suggestion.fingerprint),
                  selectedMarketplace,
                ],
              )
            ).rows.map((row) => `${row.barcode}:${row.fingerprint}`)
          : [],
      );
      await client.query(
        `UPDATE mapping_suggestions SET status='STALE',updated_at=NOW()
         WHERE marketplace=$2 AND barcode=ANY($1::text[])
           AND status='PENDING'`,
        [evaluated, selectedMarketplace],
      );
      const saved = [];
      for (const suggestion of uniqueSuggestions) {
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
              supplier_code,
              update_file_price,evidence,product_snapshot,fingerprint
            )VALUES($1,$2,'PENDING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            RETURNING *`,
            [
              suggestion.marketplace || selectedMarketplace,
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
              suggestion.supplier_code,
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
              suggestion_id,cost_item_code,file_market_item_id,supplier_code,quantity,
              current_unit_cost,suggested_unit_cost,unit_desi,selected_price_tier
            )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              parent.id,
              item.cost_item_code,
              item.file_market_item_id,
              item.supplier_code || suggestion.supplier_code,
              item.quantity,
              item.current_unit_cost,
              item.suggested_unit_cost,
              item.unit_desi,
              JSON.stringify(item.selected_price_tier || null),
            ],
          );
        }
        saved.push(parent);
      }
      return {
        created: saved.length,
        skippedApproved: approved.size,
        skippedRejected: rejectedFingerprints.size,
        skippedDuplicates: suggestions.length - uniqueSuggestions.length,
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
                f.last_seen_at AS file_last_seen_at,
                f.product_name AS supplier_product_name,
                f.current_price AS supplier_current_price,
                f.last_seen_at AS supplier_last_seen_at,
                f.estimated_unit_desi AS supplier_estimated_unit_desi,
                f.price_tiers AS supplier_price_tiers,
                f.desi_confidence,f.source_url,f.source_category,
                COALESCE(msi.supplier_code,f.supplier_code) AS supplier_code
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
    supplierCode,
    marketplace = "TRENDYOL",
    page = 1,
    limit = 50,
  } = {}) {
    const params = [normalizeMarketplace(marketplace)];
    const where = ["ms.marketplace=$1"];
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
    if (supplierCode) {
      params.push(String(supplierCode).toUpperCase());
      where.push(`ms.supplier_code=$${params.length}`);
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
              f.last_seen_at AS file_last_seen_at,
              f.product_name AS supplier_product_name,
              f.current_price AS supplier_current_price,
              f.last_seen_at AS supplier_last_seen_at
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

  async latestSuggestionsForBarcode(
    barcode,
    statuses = ["PENDING", "APPROVED"],
    marketplace = "TRENDYOL",
  ) {
    const normalizedBarcode = String(barcode || "").trim();
    if (!normalizedBarcode) return [];
    const result = await this.db.query(
      `SELECT ms.*,p.product_name,p.product_image_url,p.brand,p.category_name,
              p.data_status,p.is_active,
              source.product_name AS source_product_name,
              f.product_name AS file_product_name,f.current_price AS file_current_price,
              f.last_seen_at AS file_last_seen_at,
              f.product_name AS supplier_product_name,
              f.current_price AS supplier_current_price,
              f.last_seen_at AS supplier_last_seen_at
       FROM mapping_suggestions ms
       LEFT JOIN products p ON p.marketplace=ms.marketplace AND p.barcode=ms.barcode
       LEFT JOIN products source ON source.marketplace=ms.marketplace
         AND source.barcode=ms.source_barcode
       LEFT JOIN file_market_items f ON f.id=ms.file_market_item_id
       WHERE ms.marketplace=$3
         AND ms.barcode=$1
         AND ms.status=ANY($2::text[])
       ORDER BY CASE ms.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
                ms.updated_at DESC,ms.created_at DESC
       LIMIT 10`,
      [normalizedBarcode, statuses, normalizeMarketplace(marketplace)],
    );
    return this.attachItems(result.rows);
  }

  async listLearningFeedback({
    search,
    decision,
    marketplace = "TRENDYOL",
    page = 1,
    limit = 50,
  } = {}) {
    const params = [normalizeMarketplace(marketplace)];
    const where = ["mfe.marketplace=$1"];
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
              f.last_seen_at AS file_last_seen_at,
              f.product_name AS supplier_product_name,
              f.current_price AS supplier_current_price,
              f.last_seen_at AS supplier_last_seen_at
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
              suggestion_id,cost_item_code,file_market_item_id,supplier_code,quantity,
              current_unit_cost,suggested_unit_cost,unit_desi,selected_price_tier
            )VALUES($1::bigint,$2,$3::bigint,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::jsonb)`,
            [
              id,
              item.cost_item_code,
              item.file_market_item_id || null,
              item.supplier_code || suggestion.supplier_code || null,
              item.quantity,
              item.current_unit_cost || null,
              item.suggested_unit_cost || null,
              item.unit_desi || null,
              JSON.stringify(item.selected_price_tier || null),
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

  async cancelApproval(id, actor, input = {}) {
    return this.withTransaction(async (client) => {
      const suggestions = await this.getSuggestionsByIds([id], client, {
        lock: true,
      });
      const suggestion = suggestions[0];
      if (!suggestion) return null;
      if (suggestion.status !== "APPROVED")
        return { conflict: true, suggestion };
      const rejected = (
        await client.query(
          `UPDATE mapping_suggestions SET status='REJECTED',rejection_reason=$1,
           reviewed_by=$2,reviewed_at=NOW(),updated_at=NOW()
           WHERE id=$3 RETURNING *`,
          [input.reason || "Onay iptal edildi", actor, id],
        )
      ).rows[0];
      return rejected;
    });
  }

  async markApplied(client, suggestion, actor) {
    const product = (
      await client.query(
        `SELECT barcode,data_status,is_active FROM products
         WHERE marketplace=$1 AND barcode=$2 FOR UPDATE`,
        [suggestion.marketplace, suggestion.barcode],
      )
    ).rows[0];
    if (!product || !product.is_active)
      return { conflict: "TARGET_NO_LONGER_ACTIVE" };
    const existing = await client.query(
      `SELECT id FROM product_cost_mappings
       WHERE marketplace=$1 AND barcode=$2 LIMIT 1`,
      [suggestion.marketplace, suggestion.barcode],
    );
    if (existing.rowCount) return { conflict: "TARGET_MAPPING_ALREADY_EXISTS" };
    if (
      suggestion.update_file_price &&
      suggestion.items.some(
        (item) =>
          item.file_market_item_id &&
          !isSupplierPriceFresh(
            item.supplier_last_seen_at || item.file_last_seen_at,
          ),
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
        )VALUES($1,$2,$3,$4,'adet',$5,$6,NOW(),NOW())
        ON CONFLICT(item_code)DO NOTHING`,
        [
          item.cost_item_code,
          item.supplier_product_name ||
            item.file_product_name ||
            item.item_name ||
            item.cost_item_code,
          Number(item.suggested_unit_cost),
          unitDesi,
          `Akıllı mapping ${supplier(item.supplier_code || suggestion.supplier_code)?.label || "tedarikçi"} eşleşmesiyle oluşturuldu`,
          item.supplier_code || suggestion.supplier_code || "FILE_MARKET",
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
        Number(
          item.supplier_current_price ||
            item.file_current_price ||
            item.suggested_unit_cost,
        ) > 0
      ) {
        const baseSupplierPrice = Number(
          item.supplier_current_price ||
            item.file_current_price ||
            item.suggested_unit_cost ||
            0,
        );
        await client.query(
          `UPDATE cost_items SET previous_unit_cost=unit_cost,unit_cost=$1,
           price_source=$3,source_checked_at=NOW(),updated_at=NOW()
           WHERE item_code=$2`,
          [
            baseSupplierPrice,
            item.cost_item_code,
            item.supplier_code || suggestion.supplier_code || "FILE_MARKET",
          ],
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
      const selectedTier =
        item.supplier_code === "BIZIM_MARKET" ||
        suggestion.supplier_code === "BIZIM_MARKET"
          ? item.selected_price_tier || null
          : null;
      await client.query(
        `INSERT INTO product_cost_mappings(
          marketplace,barcode,cost_item_code,quantity,effective_unit_cost,
          supplier_price_tier,updated_at
        )VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
        [
          suggestion.marketplace,
          suggestion.barcode,
          item.cost_item_code,
          item.quantity,
          selectedTier ? Number(item.suggested_unit_cost) : null,
          JSON.stringify(selectedTier),
        ],
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
