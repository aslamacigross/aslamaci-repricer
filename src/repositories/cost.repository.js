const { AppError } = require("../utils/errors");
const {
  decimalToInteger,
  integerToDecimal,
  multiplyDecimals,
} = require("../utils/numbers");
const { roundProductDesi } = require("../domain/supplier-products");

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

  async saveCostItem(input, id) {
    if (id)
      return (
        await this.db.query(
          `UPDATE cost_items SET item_code=$1,item_name=$2,unit_cost=$3,unit_desi=$4,unit=$5,note=$6,updated_at=NOW()
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
        `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,unit,note)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
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
            `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,unit,note)
             VALUES($1,$2,$3,$4,$5,$6)
             ON CONFLICT(item_code)DO UPDATE SET
               item_name=EXCLUDED.item_name,unit_cost=EXCLUDED.unit_cost,
               unit_desi=EXCLUDED.unit_desi,unit=EXCLUDED.unit,note=EXCLUDED.note,
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

  async listMappings({ barcode, search, limit = 10000 }) {
    const params = [];
    const where = ["1=1"];
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
      const key = `${barcode}:${code}`;
      if (!barcode || !code || !Number.isFinite(quantity) || quantity <= 0)
        errors.push({ row: index + 1, code: "INVALID_ROW" });
      else if (seen.has(key))
        errors.push({ row: index + 1, code: "DUPLICATE_MAPPING", key });
      else {
        seen.add(key);
        normalized.push({
          marketplace: row.marketplace || "TRENDYOL",
          barcode,
          cost_item_code: code,
          quantity,
        });
      }
    }
    if (errors.length) return { valid: false, errors, rows: normalized };

    const codes = [...new Set(normalized.map((row) => row.cost_item_code))];
    const barcodes = [...new Set(normalized.map((row) => row.barcode))];
    const codePlaceholders = codes.map((_, index) => `$${index + 1}`).join(",");
    const barcodePlaceholders = barcodes
      .map((_, index) => `$${index + 1}`)
      .join(",");
    const [costResult, productResult] = await Promise.all([
      queryable.query(
        `SELECT item_code,unit_cost,unit_desi FROM cost_items
         WHERE item_code IN (${codePlaceholders})`,
        codes,
      ),
      queryable.query(
        `SELECT barcode FROM products WHERE marketplace='TRENDYOL'
         AND barcode IN (${barcodePlaceholders})`,
        barcodes,
      ),
    ]);
    const existingCodes = new Set(costResult.rows.map((row) => row.item_code));
    const existingProducts = new Set(
      productResult.rows.map((row) => row.barcode),
    );
    for (const code of codes)
      if (!existingCodes.has(code))
        errors.push({ code: "ORPHAN_COST_CODE", value: code });
    for (const item of costResult.rows)
      if (Number(item.unit_cost) <= 0 || Number(item.unit_desi) <= 0)
        errors.push({ code: "INCOMPLETE_COST_ITEM", value: item.item_code });
    for (const barcode of barcodes)
      if (!existingProducts.has(barcode))
        errors.push({ code: "PRODUCT_NOT_FOUND", value: barcode });
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
      await client.query(
        "DELETE FROM product_cost_mappings WHERE marketplace='TRENDYOL'",
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
    const barcodes = [...new Set(validation.rows.map((row) => row.barcode))];
    return this.withTransaction(async (client) => {
      await client.query(
        `DELETE FROM product_cost_mappings
         WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])`,
        [barcodes],
      );
      for (const row of validation.rows)
        await client.query(
          `INSERT INTO product_cost_mappings(
            marketplace,barcode,cost_item_code,quantity,updated_at
          )VALUES($1,$2,$3,$4,NOW())`,
          [row.marketplace, row.barcode, row.cost_item_code, row.quantity],
        );
      return {
        replacedBarcodes: barcodes.length,
        insertedMappings: validation.rows.length,
        barcodes,
      };
    });
  }

  async cloneMappings(sourceBarcode, targetBarcodes) {
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
         WHERE marketplace='TRENDYOL' AND barcode=$1 ORDER BY id`,
        [source],
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
        sourceRows.map((row) => ({ ...row, barcode })),
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

  async listCommissions() {
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
         WHERE p.marketplace='TRENDYOL' AND p.category_id IS NOT NULL
         GROUP BY p.category_id
         ORDER BY MAX(p.category_name), p.category_id`,
      )
    ).rows;
  }

  async missingCommissionCategories() {
    return (
      await this.db.query(
        `SELECT category_id,MAX(category_name) AS category_name,
                COUNT(*)::int AS product_count
         FROM products WHERE marketplace='TRENDYOL'
           AND category_id IS NOT NULL
           AND (commission_rate IS NULL OR commission_rate<=0)
         GROUP BY category_id ORDER BY product_count DESC,category_id`,
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

  async shipping() {
    const [rates, barems, packaging] = await Promise.all([
      this.db.query("SELECT * FROM shipping_costs ORDER BY carrier,desi_kg"),
      this.db.query(
        "SELECT * FROM shipping_barems ORDER BY carrier,min_basket",
      ),
      this.db.query("SELECT * FROM packaging_rules ORDER BY min_desi"),
    ]);
    return {
      rates: rates.rows,
      barems: barems.rows,
      packaging: packaging.rows,
    };
  }

  async saveShippingRate(input, id) {
    if (id)
      return (
        await this.db.query(
          `UPDATE shipping_costs SET desi_kg=$1,carrier=$2,cost_ex_vat=$3,
           cost_inc_vat=ROUND($3*(1+$4/100),2),vat_rate=$4,updated_at=NOW()
           WHERE id=$5 RETURNING *`,
          [
            input.desi_kg,
            input.carrier,
            input.cost_ex_vat,
            input.vat_rate ?? 20,
            id,
          ],
        )
      ).rows[0];
    return (
      await this.db.query(
        `INSERT INTO shipping_costs(desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at)
    VALUES($1,$2,$3,ROUND($3*(1+$4/100),2),$4,NOW())ON CONFLICT(desi_kg,carrier)DO UPDATE SET cost_ex_vat=EXCLUDED.cost_ex_vat,cost_inc_vat=EXCLUDED.cost_inc_vat,vat_rate=EXCLUDED.vat_rate,updated_at=NOW()RETURNING *`,
        [input.desi_kg, input.carrier, input.cost_ex_vat, input.vat_rate ?? 20],
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
    const overlap = await this.db.query(
      `SELECT id FROM shipping_barems WHERE carrier=$1
       AND ($4::bigint IS NULL OR id<>$4)
       AND NOT($3<=min_basket OR $2>=max_basket) LIMIT 1`,
      [input.carrier, input.min_basket, input.max_basket, id || null],
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
          `UPDATE shipping_barems SET min_basket=$1,max_basket=$2,
           barem_name=$3,carrier=$4,cost_ex_vat=$5,
           cost_inc_vat=ROUND($5*(1+$6/100),2),vat_rate=$6,updated_at=NOW()
           WHERE id=$7 RETURNING *`,
          [
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
        `INSERT INTO shipping_barems(min_basket,max_basket,barem_name,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at)
    VALUES($1,$2,$3,$4,$5,ROUND($5*(1+$6/100),2),$6,NOW())ON CONFLICT(min_basket,max_basket,carrier)DO UPDATE SET barem_name=EXCLUDED.barem_name,cost_ex_vat=EXCLUDED.cost_ex_vat,cost_inc_vat=EXCLUDED.cost_inc_vat,vat_rate=EXCLUDED.vat_rate,updated_at=NOW()RETURNING *`,
        [
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
    const overlap = await this.db.query(
      `SELECT id FROM packaging_rules WHERE ($3::bigint IS NULL OR id<>$3) AND NOT($2<=min_desi OR $1>=max_desi) LIMIT 1`,
      [input.min_desi, input.max_desi, id || null],
    );
    if (overlap.rowCount)
      throw new AppError(
        "Ambalaj desi aralığı mevcut kuralla çakışıyor",
        409,
        "OVERLAPPING_PACKAGING_RULE",
      );
    if (id)
      return (
        await this.db.query(
          "UPDATE packaging_rules SET min_desi=$1,max_desi=$2,packaging_cost=$3,note=$4,updated_at=NOW()WHERE id=$5 RETURNING *",
          [
            input.min_desi,
            input.max_desi,
            input.packaging_cost,
            input.note,
            id,
          ],
        )
      ).rows[0];
    return (
      await this.db.query(
        "INSERT INTO packaging_rules(min_desi,max_desi,packaging_cost,note)VALUES($1,$2,$3,$4)RETURNING *",
        [input.min_desi, input.max_desi, input.packaging_cost, input.note],
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
