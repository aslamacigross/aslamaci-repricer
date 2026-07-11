const { AppError } = require("../utils/errors");
const { parseNumber } = require("../utils/numbers");

const VAT = 1.2;
const text = (value) => String(value ?? "").trim();

class SheetsSyncService {
  constructor({ db, withTransaction, sheets, costEngine, audit }) {
    this.db = db;
    this.withTransaction = withTransaction;
    this.sheets = sheets;
    this.costEngine = costEngine;
    this.audit = audit;
  }

  parseCostItems(values) {
    return values
      .slice(1)
      .map((row, index) => ({
        row: index + 2,
        item_code: text(row[0]),
        item_name: text(row[1]),
        unit_cost: parseNumber(row[2], NaN),
        unit_desi: parseNumber(row[3]),
        unit: text(row[4]) || "adet",
        note: text(row[5]),
      }))
      .filter((row) => row.item_code || row.item_name);
  }
  parseMappings(values) {
    return values
      .slice(1)
      .map((row, index) => ({
        row: index + 2,
        marketplace: "TRENDYOL",
        barcode: text(row[0]),
        cost_item_code: text(row[1]),
        quantity: parseNumber(row[2], NaN),
      }))
      .filter((row) => row.barcode || row.cost_item_code);
  }
  parseCommissions(values) {
    return values
      .slice(1)
      .map((row, index) => ({
        row: index + 2,
        category_id: text(row[0]),
        commission_rate: parseNumber(row[1], NaN),
        category_name: text(row[2]),
        note: text(row[3]),
      }))
      .filter((row) => row.category_id);
  }
  parseShipping(values) {
    const headers = (values[0] || []).map(text);
    const rows = [];
    for (let r = 1; r < values.length; r++)
      for (let c = 1; c < headers.length; c++) {
        const amount = parseNumber(values[r][c], NaN);
        const desi = parseNumber(values[r][0], NaN);
        if (
          headers[c] &&
          Number.isFinite(amount) &&
          amount > 0 &&
          Number.isFinite(desi)
        )
          rows.push({
            desi_kg: desi,
            carrier: headers[c],
            cost_ex_vat: amount,
            cost_inc_vat: Number((amount * VAT).toFixed(2)),
          });
      }
    return rows;
  }
  parseBarems(values) {
    const headers = (values[0] || []).map(text);
    const rows = [];
    for (let r = 1; r < values.length; r++)
      for (let c = 3; c < headers.length; c++) {
        const amount = parseNumber(values[r][c], NaN);
        if (headers[c] && Number.isFinite(amount) && amount > 0)
          rows.push({
            min_basket: parseNumber(values[r][0]),
            max_basket: parseNumber(values[r][1], 999999),
            barem_name: text(values[r][2]),
            carrier: headers[c],
            cost_ex_vat: amount,
            cost_inc_vat: Number((amount * VAT).toFixed(2)),
          });
      }
    return rows;
  }
  parsePackaging(values) {
    return values
      .slice(1)
      .map((row, index) => ({
        row: index + 2,
        min_desi: parseNumber(row[0], NaN),
        max_desi: parseNumber(row[1], NaN),
        packaging_cost: parseNumber(row[2], NaN),
        note: text(row[3]),
      }))
      .filter((row) => Number.isFinite(row.packaging_cost));
  }

  validate(data) {
    const errors = [];
    const duplicate = (items, key, label) => {
      const seen = new Set();
      for (const item of items) {
        const value = key(item);
        if (seen.has(value))
          errors.push({
            sheet: label,
            row: item.row,
            code: "DUPLICATE",
            value,
          });
        seen.add(value);
      }
    };
    for (const item of data.costItems)
      if (
        !item.item_code ||
        !item.item_name ||
        !Number.isFinite(item.unit_cost) ||
        item.unit_cost <= 0
      )
        errors.push({
          sheet: "MaliyetIndex",
          row: item.row,
          code: "INVALID_COST_ITEM",
        });
    for (const item of data.mappings)
      if (
        !item.barcode ||
        !item.cost_item_code ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0
      )
        errors.push({
          sheet: "UrunMaliyetMap",
          row: item.row,
          code: "INVALID_MAPPING",
        });
    for (const item of data.commissions)
      if (
        !item.category_id ||
        !Number.isFinite(item.commission_rate) ||
        item.commission_rate <= 0 ||
        item.commission_rate >= 100
      )
        errors.push({
          sheet: "KomisyonKurallari",
          row: item.row,
          code: "INVALID_COMMISSION",
        });
    for (const item of data.packaging)
      if (
        !Number.isFinite(item.min_desi) ||
        !Number.isFinite(item.max_desi) ||
        item.min_desi > item.max_desi ||
        item.packaging_cost < 0
      )
        errors.push({
          sheet: "AmbalajKurallari",
          row: item.row,
          code: "INVALID_PACKAGING",
        });
    duplicate(data.costItems, (item) => item.item_code, "MaliyetIndex");
    duplicate(
      data.mappings,
      (item) => `${item.barcode}:${item.cost_item_code}`,
      "UrunMaliyetMap",
    );
    duplicate(
      data.commissions,
      (item) => item.category_id,
      "KomisyonKurallari",
    );
    const sorted = [...data.packaging].sort((a, b) => a.min_desi - b.min_desi);
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i].min_desi < sorted[i - 1].max_desi)
        errors.push({
          sheet: "AmbalajKurallari",
          row: sorted[i].row,
          code: "OVERLAPPING_RULE",
        });
    if (
      !data.costItems.length ||
      !data.mappings.length ||
      !data.shipping.length ||
      !data.barems.length ||
      !data.packaging.length
    )
      errors.push({ code: "REQUIRED_SHEET_EMPTY" });
    return errors;
  }

  async importAll() {
    let raw;
    try {
      raw = await Promise.all([
        this.sheets.values("MaliyetIndex!A1:F"),
        this.sheets.values("UrunMaliyetMap!A1:D"),
        this.sheets.values("KomisyonKurallari!A1:D"),
        this.sheets.values("KargoMaliyetleri!A1:K"),
        this.sheets.values("KargoBarem!A1:J"),
        this.sheets.values("AmbalajKurallari!A1:D"),
      ]);
    } catch (error) {
      await this.audit.integration({
        integration: "GOOGLE",
        level: "ERROR",
        operation: "SHEETS_IMPORT_READ",
        message: error.message,
      });
      throw error;
    }
    const values = raw.map((result) => result.values || []);
    const data = {
      costItems: this.parseCostItems(values[0]),
      mappings: this.parseMappings(values[1]),
      commissions: this.parseCommissions(values[2]),
      shipping: this.parseShipping(values[3]),
      barems: this.parseBarems(values[4]),
      packaging: this.parsePackaging(values[5]),
    };
    const errors = this.validate(data);
    if (errors.length)
      throw new AppError(
        "Google Sheets doğrulaması başarısız; mevcut DB verisi korunuyor",
        422,
        "SHEETS_VALIDATION_FAILED",
        errors,
      );

    const result = await this.withTransaction(async (client) => {
      for (const item of data.costItems)
        await client.query(
          `INSERT INTO cost_items(item_code,item_name,unit_cost,unit_desi,unit,note,updated_at)VALUES($1,$2,$3,$4,$5,$6,NOW())ON CONFLICT(item_code)DO UPDATE SET item_name=EXCLUDED.item_name,unit_cost=EXCLUDED.unit_cost,unit_desi=EXCLUDED.unit_desi,unit=EXCLUDED.unit,note=EXCLUDED.note,updated_at=NOW()`,
          [
            item.item_code,
            item.item_name,
            item.unit_cost,
            item.unit_desi,
            item.unit,
            item.note,
          ],
        );
      const codes = [
        ...new Set(data.mappings.map((row) => row.cost_item_code)),
      ];
      const barcodes = [...new Set(data.mappings.map((row) => row.barcode))];
      const [costs, products] = await Promise.all([
        client.query(
          "SELECT item_code FROM cost_items WHERE item_code=ANY($1::text[])",
          [codes],
        ),
        client.query(
          "SELECT barcode FROM products WHERE marketplace='TRENDYOL' AND barcode=ANY($1::text[])",
          [barcodes],
        ),
      ]);
      const knownCodes = new Set(costs.rows.map((row) => row.item_code));
      const knownProducts = new Set(products.rows.map((row) => row.barcode));
      const refs = [];
      for (const code of codes)
        if (!knownCodes.has(code))
          refs.push({ code: "ORPHAN_COST_CODE", value: code });
      for (const barcode of barcodes)
        if (!knownProducts.has(barcode))
          refs.push({ code: "PRODUCT_NOT_FOUND", value: barcode });
      if (refs.length)
        throw new AppError(
          "Mapping referans doğrulaması başarısız",
          422,
          "MAPPING_REFERENCE_FAILED",
          refs,
        );
      await client.query(
        "CREATE TEMP TABLE mapping_stage(LIKE product_cost_mappings INCLUDING DEFAULTS)ON COMMIT DROP",
      );
      for (const row of data.mappings)
        await client.query(
          "INSERT INTO mapping_stage(marketplace,barcode,cost_item_code,quantity)VALUES('TRENDYOL',$1,$2,$3)",
          [row.barcode, row.cost_item_code, row.quantity],
        );
      await client.query(
        "DELETE FROM product_cost_mappings WHERE marketplace='TRENDYOL'",
      );
      await client.query(
        "INSERT INTO product_cost_mappings(marketplace,barcode,cost_item_code,quantity,updated_at)SELECT marketplace,barcode,cost_item_code,quantity,NOW()FROM mapping_stage",
      );
      for (const item of data.commissions) {
        await client.query(
          `INSERT INTO commission_rules(marketplace,category_id,category_name,commission_rate,note,updated_at)VALUES('TRENDYOL',$1,$2,$3,$4,NOW())ON CONFLICT(marketplace,category_id)DO UPDATE SET category_name=EXCLUDED.category_name,commission_rate=EXCLUDED.commission_rate,note=EXCLUDED.note,updated_at=NOW()`,
          [
            item.category_id,
            item.category_name,
            item.commission_rate,
            item.note,
          ],
        );
        await client.query(
          "UPDATE products SET commission_rate=$1 WHERE marketplace='TRENDYOL' AND category_id=$2",
          [item.commission_rate, item.category_id],
        );
      }
      await client.query(
        "CREATE TEMP TABLE shipping_stage(LIKE shipping_costs INCLUDING DEFAULTS)ON COMMIT DROP",
      );
      for (const item of data.shipping)
        await client.query(
          "INSERT INTO shipping_stage(desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate)VALUES($1,$2,$3,$4,20)",
          [item.desi_kg, item.carrier, item.cost_ex_vat, item.cost_inc_vat],
        );
      await client.query("DELETE FROM shipping_costs");
      await client.query(
        "INSERT INTO shipping_costs(desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at)SELECT desi_kg,carrier,cost_ex_vat,cost_inc_vat,vat_rate,NOW()FROM shipping_stage",
      );
      await client.query(
        "CREATE TEMP TABLE barem_stage(LIKE shipping_barems INCLUDING DEFAULTS)ON COMMIT DROP",
      );
      for (const item of data.barems)
        await client.query(
          "INSERT INTO barem_stage(min_basket,max_basket,barem_name,carrier,cost_ex_vat,cost_inc_vat,vat_rate)VALUES($1,$2,$3,$4,$5,$6,20)",
          [
            item.min_basket,
            item.max_basket,
            item.barem_name,
            item.carrier,
            item.cost_ex_vat,
            item.cost_inc_vat,
          ],
        );
      await client.query("DELETE FROM shipping_barems");
      await client.query(
        "INSERT INTO shipping_barems(min_basket,max_basket,barem_name,carrier,cost_ex_vat,cost_inc_vat,vat_rate,updated_at)SELECT min_basket,max_basket,barem_name,carrier,cost_ex_vat,cost_inc_vat,vat_rate,NOW()FROM barem_stage",
      );
      await client.query(
        "CREATE TEMP TABLE packaging_stage(LIKE packaging_rules INCLUDING DEFAULTS)ON COMMIT DROP",
      );
      for (const item of data.packaging)
        await client.query(
          "INSERT INTO packaging_stage(min_desi,max_desi,packaging_cost,note)VALUES($1,$2,$3,$4)",
          [item.min_desi, item.max_desi, item.packaging_cost, item.note],
        );
      await client.query("DELETE FROM packaging_rules");
      await client.query(
        "INSERT INTO packaging_rules(min_desi,max_desi,packaging_cost,note,updated_at)SELECT min_desi,max_desi,packaging_cost,note,NOW()FROM packaging_stage",
      );
      return {
        costItems: data.costItems.length,
        mappings: data.mappings.length,
        commissions: data.commissions.length,
        shipping: data.shipping.length,
        barems: data.barems.length,
        packaging: data.packaging.length,
      };
    });
    await this.costEngine.recalculate();
    await this.audit.integration({
      integration: "GOOGLE",
      operation: "SHEETS_IMPORT",
      message: "Sheets import tamamlandı",
      details: result,
    });
    return {
      processed: Object.values(result).reduce((a, b) => a + b, 0),
      metadata: result,
    };
  }

  async exportProducts() {
    const [existing, products] = await Promise.all([
      this.sheets.values("Urunler!A1:AA"),
      this.db.query(
        `SELECT * FROM products WHERE marketplace='TRENDYOL' ORDER BY category_name,product_name`,
      ),
    ]);
    const controls = new Map(
      (existing.values || [])
        .slice(1)
        .map((row) => [text(row[0]), row.slice(20, 27)]),
    );
    const header = [
      "Barkod",
      "Ürün Adı",
      "Marka",
      "Kategori",
      "Kategori ID",
      "TY Fiyatı",
      "Komisyon %",
      "Stok",
      "Aktif mi",
      "Maliyet Durumu",
      "Desi",
      "Ürün Maliyeti",
      "Kargo Maliyeti",
      "Ambalaj Maliyeti",
      "Hizmet Bedeli",
      "Toplam Maliyet",
      "Minimum Fiyat",
      "Net Kâr",
      "Net Marj %",
      "Son Güncelleme",
      "Repricer Aktif mi",
      "Strateji",
      "Fiyat Kırma TL",
      "Maks Artış TL",
      "Maks Günlük Değişim %",
      "Minimum Kâr TL",
      "Not",
    ];
    const rows = products.rows.map((p) => [
      p.barcode,
      p.product_name,
      p.brand,
      p.category_name,
      p.category_id,
      parseNumber(p.my_price),
      p.commission_rate == null ? "" : parseNumber(p.commission_rate),
      p.stock_quantity,
      p.is_active ? "EVET" : "HAYIR",
      p.data_complete ? "TAMAM" : p.data_status,
      parseNumber(p.desi),
      parseNumber(p.calculated_product_cost),
      parseNumber(p.calculated_shipping_cost),
      parseNumber(p.packaging_cost),
      parseNumber(p.service_fee),
      parseNumber(p.calculated_total_cost),
      parseNumber(p.min_price),
      parseNumber(p.calculated_net_profit),
      parseNumber(p.calculated_net_margin),
      p.updated_at,
      ...(controls.get(p.barcode) || [
        p.auto_update ? "EVET" : "HAYIR",
        "Normal",
        0.1,
        10,
        15,
        parseNumber(p.target_profit),
        "",
      ]),
    ]);
    await this.sheets.update("Urunler!A1", [header, ...rows]);
    const oldRowCount = (existing.values || []).length;
    const newRowCount = rows.length + 1;
    if (oldRowCount > newRowCount) {
      await this.sheets.clear(`Urunler!A${newRowCount + 1}:T${oldRowCount}`);
    }
    return { processed: rows.length };
  }
}

module.exports = { SheetsSyncService };
