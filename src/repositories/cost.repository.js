const { AppError } = require("../utils/errors");
const {
  decimalToInteger,
  integerToDecimal,
  multiplyDecimals,
} = require("../utils/numbers");
const { roundProductDesi } = require("../domain/supplier-products");
const {
  normalizeText,
  tokens,
  diceCoefficient,
} = require("../domain/product-matching");

function closeNumber(left, right, tolerance) {
  const a = Number(left);
  const b = Number(right);
  return (
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance
  );
}

class CostRepository {
  constructor(db, withTransaction) {
    this.db = db;
    this.withTransaction = withTransaction;
  }

  async listCostItems() {
    return (
      await this.db.query(
        `SELECT ci.*, COUNT(DISTINCT pcm.barcode)::int AS product_count
       FROM cost_items ci LEFT JOIN product_cost_mappings pcm ON pcm.cost_item_code=ci.item_code
       GROUP BY ci.id ORDER BY ci.item_name`,
      )
    ).rows;
  }

  async duplicateCostItemCandidates({ limit = 200 } = {}) {
    const rows = (
      await this.db.query(
        `SELECT ci.*, COUNT(DISTINCT pcm.barcode)::int AS product_count
         FROM cost_items ci
         LEFT JOIN product_cost_mappings pcm ON pcm.cost_item_code=ci.item_code
         GROUP BY ci.id
         ORDER BY ci.item_name`,
      )
    ).rows;
    const prepared = rows.map((item) => ({
      ...item,
      normalized_name: normalizeText(item.item_name),
      token_list: tokens(`${item.item_name} ${item.item_code}`),
    }));
    const pairs = [];
    for (let leftIndex = 0; leftIndex < prepared.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < prepared.length;
        rightIndex++
      ) {
        const left = prepared[leftIndex];
        const right = prepared[rightIndex];
        const nameScore = diceCoefficient(left.token_list, right.token_list);
        const sameNormalizedName =
          left.normalized_name &&
          left.normalized_name === right.normalized_name;
        const sameCost = closeNumber(left.unit_cost, right.unit_cost, 0.01);
        const sameDesi = closeNumber(left.unit_desi, right.unit_desi, 0.001);
        const reasons = [];
        if (sameNormalizedName) reasons.push("SAME_NORMALIZED_NAME");
        if (nameScore >= 0.92) reasons.push("VERY_SIMILAR_NAME");
        else if (nameScore >= 0.86) reasons.push("SIMILAR_NAME");
        if (sameCost) reasons.push("SAME_UNIT_COST");
        if (sameDesi) reasons.push("SAME_UNIT_DESI");
        const suspicious =
          sameNormalizedName ||
          nameScore >= 0.92 ||
          (nameScore >= 0.86 && (sameCost || sameDesi));
        if (!suspicious) continue;
        pairs.push({
          score: Number(
            Math.min(
              1,
              nameScore * 0.78 + (sameCost ? 0.12 : 0) + (sameDesi ? 0.1 : 0),
            ).toFixed(4),
          ),
          reasons,
          left: {
            id: left.id,
            item_code: left.item_code,
            item_name: left.item_name,
            unit_cost: left.unit_cost,
            unit_desi: left.unit_desi,
            product_count: left.product_count,
          },
          right: {
            id: right.id,
            item_code: right.item_code,
            item_name: right.item_name,
            unit_cost: right.unit_cost,
            unit_desi: right.unit_desi,
            product_count: right.product_count,
          },
        });
      }
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    pairs.sort((left, right) => right.score - left.score);
    return { items: pairs.slice(0, safeLimit), total: pairs.length };
  }

  async saveCostItem(input, id) {
    if (id)
      return (
        await this.db.query(
          `UPDATE cost_items
           SET item_code=$1,item_name=$2,unit_cost=$3,unit_desi=$4,unit=$5,note=$6,
               previous_unit_cost=CASE WHEN unit_cost IS DISTINCT FROM $3 THEN unit_cost ELSE previous_unit_cost END,
               source_checked_at=NOW(),
               manual_review_last_confirmed_at=NOW(),
               manual_review_next_due_at=NOW() + (COALESCE(manual_review_interval_days,30) || ' days')::interval,
               manual_review_status='OK',
               updated_at=NOW()
       WHERE id=$7 RETURNING *`,
          [
            input.item_code,
            input.item_name,
            input.unit_cost,
            input.unit_desi,
            input.unit,
            input.note,
            id,
          ],
        )
      ).rows[0];
    return (
      await this.db.query(
        `INSERT INTO cost_items(
           item_code,item_name,unit_cost,unit_desi,unit,note,
           price_source,source_checked_at,manual_review_last_confirmed_at,
           manual_review_next_due_at,manual_review_status
         )
       VALUES($1,$2,$3,$4,$5,$6,'MANUAL',NOW(),NOW(),NOW() + INTERVAL '30 days','OK')
       RETURNING *`,
        [
          input.item_code,
          input.item_name,
          input.unit_cost,
          input.unit_desi,
          input.unit,
          input.note,
        ],
      )
    ).rows[0];
  }

  async saveCostItems(rows) {
    return this.withTransaction(async (client) => {
      const items = [];
      for (const row of rows) {
        const saved = (
          await client.query(
            `INSERT INTO cost_items(
               item_code,item_name,unit_cost,unit_desi,unit,note,
               price_source,source_checked_at,manual_review_last_confirmed_at,
               manual_review_next_due_at,manual_review_status
             )
             VALUES($1,$2,$3,$4,$5,$6,'MANUAL',NOW(),NOW(),NOW() + INTERVAL '30 days','OK')
             ON CONFLICT(item_code)DO UPDATE SET
               item_name=EXCLUDED.item_name,unit_cost=EXCLUDED.unit_cost,
               unit_desi=EXCLUDED.unit_desi,unit=EXCLUDED.unit,note=EXCLUDED.note,
               previous_unit_cost=CASE
                 WHEN cost_items.unit_cost IS DISTINCT FROM EXCLUDED.unit_cost THEN cost_items.unit_cost
                 ELSE cost_items.previous_unit_cost
               END,
               source_checked_at=NOW(),
               manual_review_last_confirmed_at=NOW(),
               manual_review_next_due_at=NOW() + (COALESCE(cost_items.manual_review_interval_days,30) || ' days')::interval,
               manual_review_status='OK',
               updated_at=NOW()
             RETURNING *`,
            [
              row.item_code,
              row.item_name,
              row.unit_cost,
              row.unit_desi,
              row.unit,
              row.note,
            ],
          )
        ).rows[0];
        items.push(saved);
      }
      return { processed: items.length, items };
    });
  }

  async manualCostReviewQueue({
    search,
    page = 1,
    limit = 100,
    days = 30,
    includeOk = false,
  } = {}) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const offset = (safePage - 1) * safeLimit;
    const params = [safeDays];
    const where = [
      "$1::int > 0",
      `NOT EXISTS (
        SELECT 1
        FROM cost_item_file_links link
        JOIN file_market_items supplier_item ON supplier_item.id=link.file_market_item_id
        WHERE link.cost_item_code=ci.item_code
          AND link.status='APPROVED'
          AND supplier_item.supplier_code IN ('FILE_MARKET','BIZIM_MARKET','BIM')
      )`,
    ];
    if (!["true", true, "1", 1].includes(includeOk)) {
      where.push(
        `(ci.manual_review_next_due_at IS NULL
          OR ci.manual_review_next_due_at <= NOW()
          OR ci.source_checked_at IS NULL
          OR ci.source_checked_at <= NOW() - ($1::int || ' days')::interval)`,
      );
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(ci.item_code ILIKE $${params.length} OR ci.item_name ILIKE $${params.length})`,
      );
    }
    const whereSql = where.join(" AND ");
    const total = (
      await this.db.query(
        `SELECT COUNT(*)::int AS count FROM cost_items ci WHERE ${whereSql}`,
        params,
      )
    ).rows[0].count;
    params.push(safeLimit, offset);
    const rows = (
      await this.db.query(
        `SELECT ci.*,
                COUNT(DISTINCT pcm.marketplace || ':' || pcm.barcode)::int AS product_count,
                COALESCE(
                  JSON_AGG(
                    DISTINCT JSONB_BUILD_OBJECT(
                      'marketplace', pcm.marketplace,
                      'barcode', pcm.barcode,
                      'product_name', p.product_name,
                      'quantity', pcm.quantity
                    )
                  ) FILTER (WHERE pcm.barcode IS NOT NULL),
                  '[]'
                ) AS sample_products,
                COALESCE(ci.manual_review_next_due_at, ci.source_checked_at + ($1::int || ' days')::interval) <= NOW()
                  OR ci.source_checked_at IS NULL AS due,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ci.source_checked_at, ci.updated_at, NOW()))) / 86400)::int AS days_since_check,
                MAX(supplier_candidate.candidate::text)::jsonb AS supplier_candidate
         FROM cost_items ci
         LEFT JOIN product_cost_mappings pcm ON pcm.cost_item_code=ci.item_code
         LEFT JOIN products p ON p.marketplace=pcm.marketplace AND p.barcode=pcm.barcode
         LEFT JOIN LATERAL (
           SELECT JSONB_BUILD_OBJECT(
             'id', f.id,
             'supplier_code', f.supplier_code,
             'product_name', f.product_name,
             'current_price', f.current_price,
             'estimated_unit_desi', f.estimated_unit_desi,
             'last_seen_at', f.last_seen_at,
             'availability', f.availability
           ) AS candidate
           FROM file_market_items f
           CROSS JOIN LATERAL (
             SELECT COUNT(*)::int AS count
             FROM REGEXP_SPLIT_TO_TABLE(
               REGEXP_REPLACE(
                 TRANSLATE(
                   LOWER(ci.item_code || ' ' || ci.item_name),
                   'çğıöşüÇĞİÖŞÜ',
                   'cgiosucgiosu'
                 ),
                 '[^a-z0-9]+',
                 ' ',
                 'g'
               ),
               '\\s+'
             ) AS cost_token
             WHERE LENGTH(cost_token)>2
               AND cost_token NOT IN (
                 'adet','birim','file','market','bizim','bim','diger',
                 'urun','paket','set','icin','ile','suyu','sivi'
               )
               AND f.normalized_name ILIKE '%' || cost_token || '%'
           ) token_match
           WHERE f.supplier_code IN ('FILE_MARKET','BIZIM_MARKET','BIM')
             AND f.availability='AVAILABLE'
             AND (
               f.normalized_name ILIKE '%' || REGEXP_REPLACE(LOWER(ci.item_code),'[^a-z0-9]+','%','g') || '%'
               OR REGEXP_REPLACE(LOWER(ci.item_code),'[^a-z0-9]+','%','g') ILIKE '%' || f.normalized_name || '%'
               OR LOWER(f.product_name) ILIKE '%' || LOWER(ci.item_name) || '%'
               OR LOWER(ci.item_name) ILIKE '%' || LOWER(f.product_name) || '%'
               OR token_match.count >= 2
             )
           ORDER BY
             token_match.count DESC,
             CASE
               WHEN f.normalized_name ILIKE '%' || REGEXP_REPLACE(LOWER(ci.item_code),'[^a-z0-9]+','%','g') || '%' THEN 0
               ELSE 1
             END,
             f.last_seen_at DESC
           LIMIT 1
         ) supplier_candidate ON TRUE
         WHERE ${whereSql}
         GROUP BY ci.id
         ORDER BY due DESC, ci.manual_review_next_due_at NULLS FIRST, ci.item_name
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
    return {
      items: rows,
      page: safePage,
      limit: safeLimit,
      total,
      due_count: rows.filter((row) => row.due).length,
    };
  }

  async confirmManualCostReview(id, { note, intervalDays = 30 } = {}) {
    const safeInterval = Math.min(Math.max(Number(intervalDays) || 30, 1), 365);
    return (
      await this.db.query(
        `UPDATE cost_items
         SET source_checked_at=NOW(),
             manual_review_last_confirmed_at=NOW(),
             manual_review_next_due_at=NOW() + ($2::int || ' days')::interval,
             manual_review_interval_days=$2,
             manual_review_status='OK',
             manual_review_note=$3,
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, safeInterval, String(note || "").trim()],
      )
    ).rows[0];
  }

  async updateManualCostReview(
    id,
    { unit_cost, unit_desi, note, intervalDays = 30 } = {},
  ) {
    const safeInterval = Math.min(Math.max(Number(intervalDays) || 30, 1), 365);
    return (
      await this.db.query(
        `UPDATE cost_items
         SET previous_unit_cost=CASE WHEN unit_cost IS DISTINCT FROM $2 THEN unit_cost ELSE previous_unit_cost END,
             unit_cost=$2,
             unit_desi=COALESCE($3, unit_desi),
             source_checked_at=NOW(),
             manual_review_last_confirmed_at=NOW(),
             manual_review_next_due_at=NOW() + ($4::int || ' days')::interval,
             manual_review_interval_days=$4,
             manual_review_status='OK',
             manual_review_note=$5,
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [
          id,
          unit_cost,
          unit_desi === undefined || unit_desi === "" ? null : unit_desi,
          safeInterval,
          String(note || "").trim(),
        ],
      )
    ).rows[0];
  }

  async linkManualCostToSupplierItem(
    id,
    supplierItemId,
    { actor, note, intervalDays = 30 } = {},
  ) {
    const safeInterval = Math.min(Math.max(Number(intervalDays) || 30, 1), 365);
    return this.withTransaction(async (client) => {
      const costItem = (
        await client.query("SELECT * FROM cost_items WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!costItem) return null;
      const supplierItem = (
        await client.query(
          `SELECT * FROM file_market_items
           WHERE id=$1 AND supplier_code IN ('FILE_MARKET','BIZIM_MARKET','BIM')`,
          [supplierItemId],
        )
      ).rows[0];
      if (!supplierItem)
        throw new AppError(
          "Canlı tedarikçi ürünü bulunamadı",
          404,
          "SUPPLIER_ITEM_NOT_FOUND",
        );
      await client.query(
        `INSERT INTO cost_item_file_links(
           cost_item_code,file_market_item_id,confidence,status,approved_by,approved_at
         )VALUES($1,$2,0.90000,'APPROVED',$3,NOW())
         ON CONFLICT(cost_item_code)DO UPDATE SET
           file_market_item_id=EXCLUDED.file_market_item_id,
           confidence=EXCLUDED.confidence,
           status='APPROVED',
           approved_by=EXCLUDED.approved_by,
           approved_at=NOW(),
           updated_at=NOW()`,
        [costItem.item_code, supplierItem.id, actor || null],
      );
      const updated = (
        await client.query(
          `UPDATE cost_items
           SET previous_unit_cost=CASE WHEN unit_cost<>$2 THEN unit_cost ELSE previous_unit_cost END,
               unit_cost=$2,
               unit_desi=CASE
                 WHEN COALESCE(unit_desi,0)<=0 AND $3::numeric IS NOT NULL AND $3::numeric>0
                 THEN $3::numeric
                 ELSE unit_desi
               END,
               price_source=$4,
               source_checked_at=COALESCE($5,NOW()),
               manual_review_last_confirmed_at=NOW(),
               manual_review_next_due_at=NOW() + ($6::int || ' days')::interval,
               manual_review_interval_days=$6,
               manual_review_status='OK',
               manual_review_note=$7,
               updated_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [
            costItem.id,
            supplierItem.current_price,
            supplierItem.estimated_unit_desi,
            supplierItem.supplier_code,
            supplierItem.last_seen_at,
            safeInterval,
            String(note || "").trim(),
          ],
        )
      ).rows[0];
      return { costItem: updated, supplierItem };
    });
  }

  async deleteCostItem(id) {
    const usage = await this.db.query(
      "SELECT COUNT(*)::int AS count FROM product_cost_mappings pcm JOIN cost_items ci ON ci.item_code=pcm.cost_item_code WHERE ci.id=$1",
      [id],
    );
    if (usage.rows[0].count > 0)
      throw new AppError(
        "Kullanılan maliyet kalemi silinemez",
        409,
        "COST_ITEM_IN_USE",
      );
    return (
      await this.db.query("DELETE FROM cost_items WHERE id=$1 RETURNING *", [
        id,
      ])
    ).rows[0];
  }

  async costItemUsage(id) {
    return (
      await this.db.query(
        `SELECT p.barcode,p.product_name,p.brand,p.category_name,
                pcm.quantity,ci.item_code,ci.item_name,
                pcm.quantity*ci.unit_cost AS line_cost,
                pcm.quantity*ci.unit_desi AS line_desi
         FROM cost_items ci
         JOIN product_cost_mappings pcm ON pcm.cost_item_code=ci.item_code
         LEFT JOIN products p ON p.marketplace=pcm.marketplace
           AND p.barcode=pcm.barcode
         WHERE ci.id=$1 ORDER BY p.product_name,pcm.barcode`,
        [id],
      )
    ).rows;
  }

  async listMappings({
    barcode,
    search,
    limit = 10000,
    marketplace = "TRENDYOL",
  }) {
    const params = [String(marketplace || "TRENDYOL").toUpperCase()];
    const where = ["pcm.marketplace=$1"];
    if (barcode) {
      params.push(barcode);
      where.push(`pcm.barcode=$${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(pcm.barcode ILIKE $${params.length} OR ci.item_name ILIKE $${params.length})`,
      );
    }
    params.push(Math.min(Number(limit) || 10000, 10000));
    return (
      await this.db.query(
        `SELECT pcm.*, p.product_name, ci.item_name, ci.unit_cost, ci.unit_desi,
              pcm.quantity*ci.unit_cost AS line_cost,
              (ci.id IS NULL) AS orphan,
              (ci.id IS NOT NULL AND (
                ci.unit_cost<=0 OR COALESCE(ci.unit_desi,0)<=0
              )) AS incomplete
       FROM product_cost_mappings pcm
       LEFT JOIN products p ON p.marketplace=pcm.marketplace AND p.barcode=pcm.barcode
       LEFT JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
       WHERE ${where.join(" AND ")} ORDER BY pcm.barcode, ci.item_name LIMIT $${params.length}`,
        params,
      )
    ).rows;
  }

  async validateMappings(rows, queryable = this.db) {
    if (!Array.isArray(rows) || !rows.length)
      throw new AppError("Mapping listesi boş", 400, "EMPTY_MAPPING");
    const normalized = [];
    const seen = new Set();
    const errors = [];
    for (const [index, row] of rows.entries()) {
      const barcode = String(row.barcode || "").trim();
      const code = String(row.cost_item_code || row.costCode || "").trim();
      const quantity = Number(row.quantity);
      const marketplace = String(row.marketplace || "TRENDYOL").toUpperCase();
      const key = `${marketplace}:${barcode}:${code}`;
      if (!barcode || !code || !Number.isFinite(quantity) || quantity <= 0)
        errors.push({ row: index + 1, code: "INVALID_ROW" });
      else if (seen.has(key))
        errors.push({ row: index + 1, code: "DUPLICATE_MAPPING", key });
      else {
        seen.add(key);
        normalized.push({
          marketplace,
          barcode,
          cost_item_code: code,
          quantity,
        });
      }
    }
    if (errors.length) return { valid: false, errors, rows: normalized };

    const codes = [...new Set(normalized.map((row) => row.cost_item_code))];
    const productKeys = [
      ...new Set(normalized.map((row) => `${row.marketplace}:${row.barcode}`)),
    ];
    const codePlaceholders = codes.map((_, index) => `$${index + 1}`).join(",");
    const [costResult, productResult] = await Promise.all([
      queryable.query(
        `SELECT item_code,unit_cost,unit_desi FROM cost_items
         WHERE item_code IN (${codePlaceholders})`,
        codes,
      ),
      queryable.query(
        `SELECT marketplace,barcode FROM products
         WHERE marketplace || ':' || barcode=ANY($1::text[])`,
        [productKeys],
      ),
    ]);
    const existingCodes = new Set(costResult.rows.map((row) => row.item_code));
    const existingProducts = new Set(
      productResult.rows.map((row) => `${row.marketplace}:${row.barcode}`),
    );
    for (const code of codes)
      if (!existingCodes.has(code))
        errors.push({ code: "ORPHAN_COST_CODE", value: code });
    for (const item of costResult.rows)
      if (Number(item.unit_cost) <= 0 || Number(item.unit_desi) <= 0)
        errors.push({ code: "INCOMPLETE_COST_ITEM", value: item.item_code });
    for (const key of productKeys)
      if (!existingProducts.has(key))
        errors.push({ code: "PRODUCT_NOT_FOUND", value: key });
    return { valid: errors.length === 0, errors, rows: normalized };
  }

  async replaceMappings(rows) {
    const validation = await this.validateMappings(rows);
    if (!validation.valid)
      throw new AppError(
        "Mapping doğrulaması başarısız",
        422,
        "MAPPING_VALIDATION_FAILED",
        validation.errors,
      );
    return this.withTransaction(async (client) => {
      await client.query(
        "CREATE TEMP TABLE mapping_stage (LIKE product_cost_mappings INCLUDING DEFAULTS) ON COMMIT DROP",
      );
      for (const row of validation.rows) {
        await client.query(
          `INSERT INTO mapping_stage(marketplace,barcode,cost_item_code,quantity) VALUES($1,$2,$3,$4)`,
          [row.marketplace, row.barcode, row.cost_item_code, row.quantity],
        );
      }
      const staged = await this.validateMappings(validation.rows, client);
      if (!staged.valid)
        throw new AppError(
          "Geçici mapping doğrulaması başarısız",
          422,
          "STAGED_MAPPING_INVALID",
          staged.errors,
        );
      const marketplaces = [
        ...new Set(validation.rows.map((row) => row.marketplace)),
      ];
      await client.query(
        "DELETE FROM product_cost_mappings WHERE marketplace=ANY($1::text[])",
        [marketplaces],
      );
      const inserted = await client.query(
        `INSERT INTO product_cost_mappings(marketplace,barcode,cost_item_code,quantity,updated_at)
         SELECT marketplace,barcode,cost_item_code,quantity,NOW() FROM mapping_stage RETURNING id`,
      );
      return { replaced: inserted.rowCount };
    });
  }

  async previewMappings(rows) {
    const validation = await this.validateMappings(rows);
    if (!validation.valid) return validation;
    const codes = [
      ...new Set(validation.rows.map((row) => row.cost_item_code)),
    ];
    const costItems = (
      await this.db.query(
        `SELECT item_code,item_name,unit_cost,unit_desi
         FROM cost_items WHERE item_code=ANY($1::text[])`,
        [codes],
      )
    ).rows;
    const byCode = new Map(costItems.map((item) => [item.item_code, item]));
    const totals = new Map();
    const previewRows = validation.rows.map((row) => {
      const item = byCode.get(row.cost_item_code);
      const lineCost = multiplyDecimals(row.quantity, item.unit_cost);
      const lineDesi = multiplyDecimals(row.quantity, item.unit_desi, {
        resultDecimals: 3,
      });
      const total = totals.get(row.barcode) || { cost: 0n, desi: 0n, rows: 0 };
      total.cost += decimalToInteger(lineCost, 2);
      total.desi += decimalToInteger(lineDesi, 3);
      total.rows++;
      totals.set(row.barcode, total);
      return {
        ...row,
        item_name: item.item_name,
        unit_cost: item.unit_cost,
        unit_desi: item.unit_desi,
        line_cost: lineCost,
        line_desi: lineDesi,
      };
    });
    return {
      valid: true,
      errors: [],
      rows: previewRows,
      products: [...totals.entries()].map(([barcode, total]) => ({
        barcode,
        mapping_count: total.rows,
        product_cost: integerToDecimal(total.cost, 2),
        desi: roundProductDesi(integerToDecimal(total.desi, 3)),
      })),
    };
  }

  async replaceMappingsForBarcodes(rows) {
    const validation = await this.validateMappings(rows);
    if (!validation.valid)
      throw new AppError(
        "Mapping doğrulaması başarısız",
        422,
        "MAPPING_VALIDATION_FAILED",
        validation.errors,
      );
    const keys = [
      ...new Set(
        validation.rows.map((row) => `${row.marketplace}:${row.barcode}`),
      ),
    ];
    return this.withTransaction(async (client) => {
      for (const key of keys) {
        const separator = key.indexOf(":");
        await client.query(
          "DELETE FROM product_cost_mappings WHERE marketplace=$1 AND barcode=$2",
          [key.slice(0, separator), key.slice(separator + 1)],
        );
      }
      for (const row of validation.rows)
        await client.query(
          `INSERT INTO product_cost_mappings(
            marketplace,barcode,cost_item_code,quantity,updated_at
          )VALUES($1,$2,$3,$4,NOW())`,
          [row.marketplace, row.barcode, row.cost_item_code, row.quantity],
        );
      return {
        replacedBarcodes: keys.length,
        insertedMappings: validation.rows.length,
        barcodes: [...new Set(validation.rows.map((row) => row.barcode))],
        marketplaces: [
          ...new Set(validation.rows.map((row) => row.marketplace)),
        ],
        targets: keys.map((key) => {
          const separator = key.indexOf(":");
          return {
            marketplace: key.slice(0, separator),
            barcode: key.slice(separator + 1),
          };
        }),
      };
    });
  }

  async cloneMappings(sourceBarcode, targetBarcodes, marketplace = "TRENDYOL") {
    const source = String(sourceBarcode || "").trim();
    const targets = [
      ...new Set(
        (targetBarcodes || [])
          .map((barcode) => String(barcode || "").trim())
          .filter((barcode) => barcode && barcode !== source),
      ),
    ];
    if (!source || !targets.length || targets.length > 100)
      throw new AppError(
        "Kaynak ve 1-100 hedef barkod gerekli",
        400,
        "INVALID_MAPPING_CLONE",
      );
    const sourceRows = (
      await this.db.query(
        `SELECT cost_item_code,quantity FROM product_cost_mappings
         WHERE marketplace=$1 AND barcode=$2 ORDER BY id`,
        [marketplace, source],
      )
    ).rows;
    if (!sourceRows.length)
      throw new AppError(
        "Kaynak barkodda çoğaltılacak mapping yok",
        404,
        "SOURCE_MAPPING_NOT_FOUND",
      );
    return this.replaceMappingsForBarcodes(
      targets.flatMap((barcode) =>
        sourceRows.map((row) => ({ ...row, barcode, marketplace })),
      ),
    );
  }

  async upsertMapping(input) {
    const validation = await this.validateMappings([input]);
    if (!validation.valid)
      throw new AppError(
        "Mapping doğrulaması başarısız",
        422,
        "MAPPING_VALIDATION_FAILED",
        validation.errors,
      );
    const row = validation.rows[0];
    return (
      await this.db.query(
        `INSERT INTO product_cost_mappings(marketplace,barcode,cost_item_code,quantity,updated_at)
       VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(marketplace,barcode,cost_item_code)
       DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=NOW() RETURNING *`,
        [row.marketplace, row.barcode, row.cost_item_code, row.quantity],
      )
    ).rows[0];
  }

  async updateMapping(id, input) {
    const validation = await this.validateMappings([input]);
    if (!validation.valid)
      throw new AppError(
        "Mapping doğrulaması başarısız",
        422,
        "MAPPING_VALIDATION_FAILED",
        validation.errors,
      );
    const row = validation.rows[0];
    return this.withTransaction(async (client) => {
      const previous = (
        await client.query(
          "SELECT barcode FROM product_cost_mappings WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!previous) return null;
      const updated = (
        await client.query(
          `UPDATE product_cost_mappings SET marketplace=$1,barcode=$2,
           cost_item_code=$3,quantity=$4,updated_at=NOW()
           WHERE id=$5 RETURNING *`,
          [row.marketplace, row.barcode, row.cost_item_code, row.quantity, id],
        )
      ).rows[0];
      return { ...updated, old_barcode: previous.barcode };
    });
  }

  async deleteMapping(id) {
    return (
      await this.db.query(
        "DELETE FROM product_cost_mappings WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
  }

  async listCommissions(marketplace = "TRENDYOL") {
    return (
      await this.db.query(
        `SELECT
           p.category_id,
           MAX(p.category_name) AS category_name,
           ROUND(AVG(p.commission_rate)::numeric, 4) AS average_commission_rate,
           MIN(p.commission_rate) AS min_commission_rate,
           MAX(p.commission_rate) AS max_commission_rate,
           COUNT(*)::int AS product_count,
           COUNT(*) FILTER (WHERE p.is_active)::int AS active_product_count,
           COUNT(*) FILTER (WHERE p.commission_rate IS NULL OR p.commission_rate<=0)::int AS missing_commission_count,
           MAX(p.special_commission_checked_at) AS last_api_check_at
         FROM products p
         WHERE p.marketplace=$1 AND p.category_id IS NOT NULL
         GROUP BY p.category_id
         ORDER BY MAX(p.category_name), p.category_id`,
        [String(marketplace || "TRENDYOL").toUpperCase()],
      )
    ).rows;
  }

  async missingCommissionCategories(marketplace = "TRENDYOL") {
    return (
      await this.db.query(
        `SELECT category_id,MAX(category_name) AS category_name,
                COUNT(*)::int AS product_count
         FROM products WHERE marketplace=$1
           AND category_id IS NOT NULL
           AND (commission_rate IS NULL OR commission_rate<=0)
         GROUP BY category_id ORDER BY product_count DESC,category_id`,
        [String(marketplace || "TRENDYOL").toUpperCase()],
      )
    ).rows;
  }

  async saveCommission(input) {
    const row = (
      await this.db.query(
        `INSERT INTO commission_rules(marketplace,category_id,category_name,commission_rate,note,updated_at)
       VALUES('TRENDYOL',$1,$2,$3,$4,NOW()) ON CONFLICT(marketplace,category_id)
       DO UPDATE SET category_name=EXCLUDED.category_name,commission_rate=EXCLUDED.commission_rate,note=EXCLUDED.note,updated_at=NOW()
       RETURNING *`,
        [
          input.category_id,
          input.category_name,
          input.commission_rate,
          input.note,
        ],
      )
    ).rows[0];
    await this.db.query(
      `UPDATE products SET
         commission_rate=$1,
         base_commission_rate=$1,
         special_commission_active=CASE
           WHEN trendyol_commission_rate IS NOT NULL
             AND trendyol_commission_rate > 0
             AND $1::numeric > 0
             AND trendyol_commission_rate < $1::numeric - 0.0001
           THEN TRUE
           ELSE FALSE
         END,
         special_commission_note=CASE
           WHEN trendyol_commission_rate IS NOT NULL
             AND trendyol_commission_rate > 0
             AND $1::numeric > 0
             AND trendyol_commission_rate < $1::numeric - 0.0001
           THEN 'Trendyol API komisyonu manuel komisyondan düşük'
           ELSE NULL
         END,
         updated_at=NOW()
       WHERE marketplace='TRENDYOL' AND category_id=$2`,
      [input.commission_rate, input.category_id],
    );
    return row;
  }

  async saveCommissions(rows) {
    if (!Array.isArray(rows) || !rows.length)
      throw new AppError("Komisyon listesi boş", 400, "EMPTY_COMMISSION_LIST");
    const seen = new Set();
    for (const [index, row] of rows.entries()) {
      const categoryId = String(row.category_id || "").trim();
      const rate = Number(row.commission_rate);
      if (!categoryId || !Number.isFinite(rate) || rate <= 0 || rate >= 100)
        throw new AppError(
          `Geçersiz komisyon satırı: ${index + 1}`,
          422,
          "INVALID_COMMISSION_ROW",
        );
      if (seen.has(categoryId))
        throw new AppError(
          `Tekrarlı kategori: ${categoryId}`,
          422,
          "DUPLICATE_COMMISSION_CATEGORY",
        );
      seen.add(categoryId);
    }
    return this.withTransaction(async (client) => {
      for (const row of rows) {
        const categoryId = String(row.category_id).trim();
        await client.query(
          `INSERT INTO commission_rules(
            marketplace,category_id,category_name,commission_rate,note,updated_at
          )VALUES('TRENDYOL',$1,$2,$3,$4,NOW())
          ON CONFLICT(marketplace,category_id)DO UPDATE SET
            category_name=EXCLUDED.category_name,
            commission_rate=EXCLUDED.commission_rate,
            note=EXCLUDED.note,updated_at=NOW()`,
          [
            categoryId,
            row.category_name || "",
            Number(row.commission_rate),
            row.note || null,
          ],
        );
        await client.query(
          `UPDATE products SET
             commission_rate=$1,
             base_commission_rate=$1,
             special_commission_active=CASE
               WHEN trendyol_commission_rate IS NOT NULL
                 AND trendyol_commission_rate > 0
                 AND $1::numeric > 0
                 AND trendyol_commission_rate < $1::numeric - 0.0001
               THEN TRUE
               ELSE FALSE
             END,
             special_commission_note=CASE
               WHEN trendyol_commission_rate IS NOT NULL
                 AND trendyol_commission_rate > 0
                 AND $1::numeric > 0
                 AND trendyol_commission_rate < $1::numeric - 0.0001
               THEN 'Trendyol API komisyonu manuel komisyondan düşük'
               ELSE NULL
             END,
             updated_at=NOW()
           WHERE marketplace='TRENDYOL' AND category_id=$2`,
          [Number(row.commission_rate), categoryId],
        );
      }
      return { updated: rows.length };
    });
  }

  async shipping(marketplace = "TRENDYOL") {
    const [rates, barems, packaging] = await Promise.all([
      this.db.query(
        "SELECT * FROM shipping_costs WHERE marketplace=$1 ORDER BY carrier,desi_kg",
        [marketplace],
      ),
      this.db.query(
        "SELECT * FROM shipping_barems WHERE marketplace=$1 ORDER BY carrier,min_basket",
        [marketplace],
      ),
      this.db.query(
        `SELECT * FROM packaging_rules WHERE marketplace=$1
         ORDER BY CASE rule_scope WHEN 'BARCODE' THEN 1 WHEN 'PRODUCT_NAME' THEN 2
           WHEN 'CATEGORY' THEN 3 WHEN 'BRAND' THEN 4 ELSE 5 END,priority DESC,min_desi`,
        [marketplace],
      ),
    ]);
    return {
      rates: rates.rows,
      barems: barems.rows,
      packaging: packaging.rows,
    };
  }

  async shippingPage({
    marketplace = "TRENDYOL",
    page = 1,
    limit = 50,
    carrier,
    desi,
  } = {}) {
    const normalizedMarketplace = String(
      marketplace || "TRENDYOL",
    ).toUpperCase();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const params = [normalizedMarketplace];
    const filters = ["marketplace=$1"];
    if (carrier) {
      params.push(String(carrier));
      filters.push(`carrier=$${params.length}`);
    }
    const normalizedDesi = Number(desi);
    if (
      desi !== undefined &&
      desi !== null &&
      desi !== "" &&
      Number.isFinite(normalizedDesi)
    ) {
      params.push(normalizedDesi);
      filters.push(`desi_kg=$${params.length}`);
    }
    const where = filters.join(" AND ");
    const offset = (safePage - 1) * safeLimit;
    const [rates, total, carriers, barems, packaging] = await Promise.all([
      this.db.query(
        `SELECT * FROM shipping_costs WHERE ${where}
         ORDER BY carrier,desi_kg LIMIT $${params.length + 1}
         OFFSET $${params.length + 2}`,
        [...params, safeLimit, offset],
      ),
      this.db.query(
        `SELECT COUNT(*)::integer AS total FROM shipping_costs WHERE ${where}`,
        params,
      ),
      this.db.query(
        `SELECT carrier FROM (
           SELECT carrier FROM shipping_costs WHERE marketplace=$1
           UNION
           SELECT carrier FROM shipping_barems WHERE marketplace=$1
         ) carriers ORDER BY carrier`,
        [normalizedMarketplace],
      ),
      this.db.query(
        "SELECT * FROM shipping_barems WHERE marketplace=$1 ORDER BY carrier,min_basket",
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT * FROM packaging_rules WHERE marketplace=$1
         ORDER BY CASE rule_scope WHEN 'BARCODE' THEN 1 WHEN 'PRODUCT_NAME' THEN 2
           WHEN 'CATEGORY' THEN 3 WHEN 'BRAND' THEN 4 ELSE 5 END,priority DESC,min_desi`,
        [normalizedMarketplace],
      ),
    ]);
    return {
      marketplace: normalizedMarketplace,
      rates: rates.rows,
      barems: barems.rows,
      packaging: packaging.rows,
      carriers: carriers.rows.map((row) => row.carrier),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: total.rows[0]?.total || 0,
      },
    };
  }

  async saveShippingRate(input, id) {
    if (id)
      return (
        await this.db.query(
          `UPDATE shipping_costs SET desi_kg=$1,carrier=$2,cost_ex_vat=$3,
           cost_inc_vat=ROUND($3*(1+$4/100),2),vat_rate=$4,
           marketplace=$6,updated_at=NOW()
           WHERE id=$5 RETURNING *`,
          [
            input.desi_kg,
            input.carrier,
            input.cost_ex_vat,
            input.vat_rate ?? 20,
            id,
            input.marketplace || "TRENDYOL",
          ],
        )
      ).rows[0];
    return (
      await this.db.query(
        `INSERT INTO shipping_costs(
           marketplace,desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at
         )VALUES($5,$1,$2,$3,ROUND($3*(1+$4/100),2),$4,NOW())
         ON CONFLICT(marketplace,desi_kg,carrier)DO UPDATE SET
           cost_ex_vat=EXCLUDED.cost_ex_vat,
           cost_inc_vat=EXCLUDED.cost_inc_vat,
           vat_rate=EXCLUDED.vat_rate,updated_at=NOW() RETURNING *`,
        [
          input.desi_kg,
          input.carrier,
          input.cost_ex_vat,
          input.vat_rate ?? 20,
          input.marketplace || "TRENDYOL",
        ],
      )
    ).rows[0];
  }
  async deleteShippingRate(id) {
    return (
      await this.db.query(
        "DELETE FROM shipping_costs WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
  }
  async saveBarem(input, id) {
    const marketplace = String(input.marketplace || "TRENDYOL").toUpperCase();
    const overlap = await this.db.query(
      `SELECT id FROM shipping_barems WHERE marketplace=$1 AND carrier=$2
       AND ($5::bigint IS NULL OR id<>$5)
       AND NOT($4<=min_basket OR $3>=max_basket) LIMIT 1`,
      [
        marketplace,
        input.carrier,
        input.min_basket,
        input.max_basket,
        id || null,
      ],
    );
    if (overlap.rowCount)
      throw new AppError(
        "Bu kargo firması için sepet baremi çakışıyor",
        409,
        "OVERLAPPING_BAREM",
      );
    if (id)
      return (
        await this.db.query(
          `UPDATE shipping_barems SET marketplace=$1,min_basket=$2,max_basket=$3,
           barem_name=$4,carrier=$5,cost_ex_vat=$6,
           cost_inc_vat=ROUND($6*(1+$7/100),2),vat_rate=$7,updated_at=NOW()
           WHERE id=$8 RETURNING *`,
          [
            marketplace,
            input.min_basket,
            input.max_basket,
            input.barem_name,
            input.carrier,
            input.cost_ex_vat,
            input.vat_rate ?? 20,
            id,
          ],
        )
      ).rows[0];
    return (
      await this.db.query(
        `INSERT INTO shipping_barems(marketplace,min_basket,max_basket,barem_name,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,ROUND($6*(1+$7/100),2),$7,NOW())ON CONFLICT(marketplace,min_basket,max_basket,carrier)DO UPDATE SET barem_name=EXCLUDED.barem_name,cost_ex_vat=EXCLUDED.cost_ex_vat,cost_inc_vat=EXCLUDED.cost_inc_vat,vat_rate=EXCLUDED.vat_rate,updated_at=NOW()RETURNING *`,
        [
          marketplace,
          input.min_basket,
          input.max_basket,
          input.barem_name,
          input.carrier,
          input.cost_ex_vat,
          input.vat_rate ?? 20,
        ],
      )
    ).rows[0];
  }
  async deleteBarem(id) {
    return (
      await this.db.query(
        "DELETE FROM shipping_barems WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
  }
  async savePackaging(input, id) {
    const marketplace = String(input.marketplace || "TRENDYOL").toUpperCase();
    const scope = String(input.rule_scope || "DESI").toUpperCase();
    const matchValue =
      scope === "DESI" ? null : String(input.match_value || "").trim();
    const minDesi = scope === "DESI" ? Number(input.min_desi) : 0;
    const maxDesi = scope === "DESI" ? Number(input.max_desi) : 999;
    if (scope === "DESI") {
      const overlap = await this.db.query(
        `SELECT id FROM packaging_rules WHERE marketplace=$1 AND rule_scope='DESI'
         AND ($4::bigint IS NULL OR id<>$4)
         AND NOT($3<=min_desi OR $2>=max_desi) LIMIT 1`,
        [marketplace, minDesi, maxDesi, id || null],
      );
      if (overlap.rowCount)
        throw new AppError(
          "Ambalaj desi aralığı mevcut kuralla çakışıyor",
          409,
          "OVERLAPPING_PACKAGING_RULE",
        );
    }
    const params = [
      marketplace,
      minDesi,
      maxDesi,
      input.packaging_cost,
      input.note || null,
      String(input.profile_name || input.note || "Ambalaj profili").trim(),
      String(input.packaging_type || "STANDARD").toUpperCase(),
      scope,
      matchValue,
      Number(input.priority || 0),
      input.active !== false,
    ];
    if (id)
      return (
        await this.db.query(
          `UPDATE packaging_rules SET marketplace=$1,min_desi=$2,max_desi=$3,
           packaging_cost=$4,note=$5,profile_name=$6,packaging_type=$7,
           rule_scope=$8,match_value=$9,priority=$10,active=$11,updated_at=NOW()
           WHERE id=$12 RETURNING *`,
          [...params, id],
        )
      ).rows[0];
    return (
      await this.db.query(
        `INSERT INTO packaging_rules(
          marketplace,min_desi,max_desi,packaging_cost,note,profile_name,
          packaging_type,rule_scope,match_value,priority,active
         )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)RETURNING *`,
        params,
      )
    ).rows[0];
  }
  async deletePackaging(id) {
    return (
      await this.db.query(
        "DELETE FROM packaging_rules WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
  }
}

module.exports = { CostRepository };
