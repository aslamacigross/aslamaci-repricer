const { AppError } = require("../utils/errors");

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

  async listMappings({ barcode, search, limit = 200 }) {
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
    params.push(Math.min(Number(limit) || 200, 1000));
    return (
      await this.db.query(
        `SELECT pcm.*, p.product_name, ci.item_name, ci.unit_cost, ci.unit_desi,
              pcm.quantity*ci.unit_cost AS line_cost, (ci.id IS NULL) AS orphan
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
    const [costResult, productResult] = await Promise.all([
      queryable.query(
        "SELECT item_code FROM cost_items WHERE item_code=ANY($1::text[])",
        [codes],
      ),
      queryable.query(
        "SELECT barcode FROM products WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])",
        [barcodes],
      ),
    ]);
    const existingCodes = new Set(costResult.rows.map((row) => row.item_code));
    const existingProducts = new Set(
      productResult.rows.map((row) => row.barcode),
    );
    for (const code of codes)
      if (!existingCodes.has(code))
        errors.push({ code: "ORPHAN_COST_CODE", value: code });
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
    return (
      await this.db.query(
        `UPDATE product_cost_mappings SET marketplace=$1,barcode=$2,cost_item_code=$3,quantity=$4,updated_at=NOW()WHERE id=$5 RETURNING *`,
        [row.marketplace, row.barcode, row.cost_item_code, row.quantity, id],
      )
    ).rows[0];
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
        `SELECT cr.*, COUNT(p.id)::int AS product_count
       FROM commission_rules cr LEFT JOIN products p ON p.marketplace=cr.marketplace AND p.category_id=cr.category_id
       GROUP BY cr.id ORDER BY cr.category_name, cr.category_id`,
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
      `UPDATE products SET commission_rate=$1,updated_at=NOW() WHERE marketplace='TRENDYOL' AND category_id=$2`,
      [input.commission_rate, input.category_id],
    );
    return row;
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

  async saveShippingRate(input) {
    return (
      await this.db.query(
        `INSERT INTO shipping_costs(desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at)
    VALUES($1,$2,$3,ROUND($3*(1+$4/100),2),$4,NOW())ON CONFLICT(desi_kg,carrier)DO UPDATE SET cost_ex_vat=EXCLUDED.cost_ex_vat,cost_inc_vat=EXCLUDED.cost_inc_vat,vat_rate=EXCLUDED.vat_rate,updated_at=NOW()RETURNING *`,
        [input.desi_kg, input.carrier, input.cost_ex_vat, input.vat_rate ?? 20],
      )
    ).rows[0];
  }
  async saveBarem(input) {
    const overlap = await this.db.query(
      `SELECT id FROM shipping_barems WHERE carrier=$1 AND NOT($3<=min_basket OR $2>=max_basket) AND NOT(min_basket=$2 AND max_basket=$3) LIMIT 1`,
      [input.carrier, input.min_basket, input.max_basket],
    );
    if (overlap.rowCount)
      throw new AppError(
        "Bu kargo firması için sepet baremi çakışıyor",
        409,
        "OVERLAPPING_BAREM",
      );
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
