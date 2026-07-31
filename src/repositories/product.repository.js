const SORT_COLUMNS = {
  name: "p.product_name",
  price: "p.my_price",
  profit: "p.calculated_net_profit",
  margin: "p.calculated_net_margin",
  updated: "p.updated_at",
  rank: "p.rank",
};

const DEFAULT_PRODUCT_SETTINGS = {
  strategy: "Manuel",
  price_cut_tl: 0.1,
  max_increase_tl: 10,
  max_single_change_pct: 15,
  max_daily_change_pct: 15,
  minimum_profit_tl: 40,
  minimum_profit_pct: null,
  minimum_margin_pct: null,
  minimum_price: null,
  maximum_price: null,
  min_undercut_tl: 0.1,
  max_undercut_tl: 75,
  min_change_interval_minutes: 30,
  daily_action_limit: 3,
  buybox_max_age_minutes: 20,
  blacklisted: false,
  learning_enabled: true,
  mode: "MANUAL",
  auto_update: false,
  note: null,
};

class ProductRepository {
  constructor(db) {
    this.db = db;
  }

  buildFilter(filters = {}) {
    const params = [filters.marketplace || "TRENDYOL"];
    const where = ["p.marketplace = $1"];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll("?", `$${params.length}`));
    };
    if (filters.search)
      add(
        "(p.barcode ILIKE ? OR p.marketplace_product_id ILIKE ? OR p.product_name ILIKE ? OR p.brand ILIKE ?)",
        `%${filters.search}%`,
      );
    if (filters.includeArchived !== true)
      where.push("COALESCE(p.archived,FALSE)=FALSE");
    if (filters.active !== undefined) add("p.is_active = ?", filters.active);
    if (filters.stocked !== undefined)
      add(
        filters.stocked ? "p.stock_quantity > ?" : "p.stock_quantity <= ?",
        0,
      );
    if (filters.category)
      add(
        "(p.category_id ILIKE ? OR p.category_name ILIKE ?)",
        `%${filters.category}%`,
      );
    if (filters.brand) add("p.brand ILIKE ?", `%${filters.brand}%`);
    if (filters.status === "incomplete") where.push("p.data_complete = FALSE");
    if (filters.status === "mapping_missing")
      where.push("p.needs_cost_mapping=TRUE");
    if (filters.status === "cost_missing")
      where.push(
        "(p.needs_cost_mapping=TRUE OR p.calculated_product_cost<=0 OR p.desi<=0 OR p.calculated_shipping_cost<=0)",
      );
    if (filters.status === "commission_missing")
      where.push("(p.commission_rate IS NULL OR p.commission_rate<=0)");
    if (filters.status === "shipping_missing")
      where.push("p.calculated_shipping_cost<=0");
    if (filters.status === "loss") where.push("p.calculated_net_profit < 0");
    if (filters.status === "below_min") where.push("p.my_price < p.min_price");
    if (filters.status === "buybox") where.push("p.rank = 1");
    if (filters.status === "outside_buybox")
      where.push("p.rank IS DISTINCT FROM 1");
    if (filters.autoUpdate !== undefined)
      add("p.auto_update = ?", filters.autoUpdate);
    if (["MANUAL", "MONITOR", "AUTOMATIC"].includes(filters.mode))
      add(
        `COALESCE((SELECT psf.mode FROM product_settings psf
          WHERE psf.marketplace=p.marketplace AND psf.barcode=p.barcode),'MANUAL') = ?`,
        filters.mode,
      );
    return { params, where };
  }

  async list(filters) {
    const { params, where } = this.buildFilter(filters);
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 1000);
    const offset = (page - 1) * limit;
    const sort = SORT_COLUMNS[filters.sort] || "p.product_name";
    const direction =
      String(filters.direction).toLowerCase() === "desc" ? "DESC" : "ASC";
    const count = await this.db.query(
      `SELECT COUNT(*) FROM products p WHERE ${where.join(" AND ")}`,
      params,
    );
    params.push(limit, offset);
    const data = await this.db.query(
      `SELECT p.*, COALESCE(ps.strategy, 'Manuel') AS strategy, COALESCE(ps.mode, 'MANUAL') AS repricer_mode,
              COALESCE(ps.blacklisted, FALSE) AS blacklisted,
              COALESCE(rl.learned_price_cut_tl, 0) AS learned_price_cut_tl,
              la.action AS last_action,la.status AS last_action_status,
              la.proposed_price AS last_proposed_price,la.reason AS last_action_reason
       FROM products p
       LEFT JOIN product_settings ps ON ps.marketplace = p.marketplace AND ps.barcode = p.barcode
       LEFT JOIN repricer_learning rl ON rl.marketplace = p.marketplace AND rl.barcode = p.barcode
       LEFT JOIN LATERAL (
         SELECT action,status,proposed_price,reason FROM repricer_actions ra
         WHERE ra.marketplace=p.marketplace AND ra.barcode=p.barcode
         ORDER BY created_at DESC LIMIT 1
       ) la ON TRUE
       WHERE ${where.join(" AND ")} ORDER BY ${sort} ${direction} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: data.rows,
      total: Number(count.rows[0].count),
      page,
      limit,
    };
  }

  async bulkTargets({ barcodes = [], filters = {}, marketplace = "TRENDYOL" }) {
    if (Array.isArray(barcodes) && barcodes.length) {
      const unique = [...new Set(barcodes.map(String).filter(Boolean))];
      if (!unique.length) return [];
      return (
        await this.db.query(
          `SELECT p.* FROM products p
           WHERE p.marketplace=$1 AND p.barcode=ANY($2::text[])
           ORDER BY p.product_name`,
          [marketplace, unique],
        )
      ).rows;
    }
    const { params, where } = this.buildFilter({ ...filters, marketplace });
    return (
      await this.db.query(
        `SELECT p.* FROM products p
         WHERE ${where.join(" AND ")}
         ORDER BY p.product_name
         LIMIT 2000`,
        params,
      )
    ).rows;
  }

  async previewBulkSettings(target) {
    const items = await this.bulkTargets(target);
    return {
      total: items.length,
      complete: items.filter((item) => item.data_complete).length,
      incomplete: items.filter((item) => !item.data_complete).length,
      active: items.filter((item) => item.is_active).length,
      stocked: items.filter((item) => Number(item.stock_quantity) > 0).length,
      commissionMissing: items.filter(
        (item) => Number(item.commission_rate || 0) <= 0,
      ).length,
      mappingMissing: items.filter((item) => item.needs_cost_mapping).length,
      lossMaking: items.filter(
        (item) => Number(item.calculated_net_profit || 0) < 0,
      ).length,
      belowMin: items.filter(
        (item) =>
          Number(item.my_price || 0) > 0 &&
          Number(item.min_price || 0) > 0 &&
          Number(item.my_price) < Number(item.min_price),
      ).length,
      sample: items.slice(0, 10).map((item) => ({
        barcode: item.barcode,
        product_name: item.product_name,
        data_status: item.data_status,
        my_price: item.my_price,
        min_price: item.min_price,
        rank: item.rank,
      })),
      barcodes: items.map((item) => item.barcode),
    };
  }

  async get(barcode, marketplace = "TRENDYOL") {
    return (
      await this.db.query(
        `SELECT p.*, row_to_json(ps) AS settings, row_to_json(rl) AS learning
       FROM products p
       LEFT JOIN product_settings ps ON ps.marketplace=p.marketplace AND ps.barcode=p.barcode
       LEFT JOIN repricer_learning rl ON rl.marketplace=p.marketplace AND rl.barcode=p.barcode
       WHERE p.marketplace=$1 AND p.barcode=$2`,
        [marketplace, barcode],
      )
    ).rows[0];
  }

  async updateSettings(barcode, input, marketplace = "TRENDYOL") {
    const existing = (
      await this.db.query(
        `SELECT * FROM product_settings
         WHERE marketplace=$1 AND barcode=$2`,
        [marketplace, barcode],
      )
    ).rows[0];
    const merged = {
      ...DEFAULT_PRODUCT_SETTINGS,
      ...(existing || {}),
      ...input,
    };
    const values = [
      marketplace,
      barcode,
      merged.strategy,
      merged.price_cut_tl,
      merged.max_increase_tl,
      merged.max_single_change_pct,
      merged.max_daily_change_pct,
      merged.minimum_profit_tl,
      merged.minimum_profit_pct,
      merged.minimum_margin_pct,
      merged.minimum_price,
      merged.maximum_price,
      merged.min_undercut_tl,
      merged.max_undercut_tl,
      merged.min_change_interval_minutes,
      merged.daily_action_limit,
      merged.buybox_max_age_minutes,
      Boolean(merged.blacklisted),
      Boolean(merged.learning_enabled),
      merged.mode,
      Boolean(merged.auto_update),
      merged.note || null,
    ];
    const result = await this.db.query(
      `INSERT INTO product_settings(
         marketplace, barcode, strategy, price_cut_tl, max_increase_tl, max_single_change_pct, max_daily_change_pct,
         minimum_profit_tl, minimum_profit_pct, minimum_margin_pct, minimum_price,
         maximum_price, min_undercut_tl, max_undercut_tl, min_change_interval_minutes,
         daily_action_limit, buybox_max_age_minutes, blacklisted, learning_enabled,
         mode, auto_update, note, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
       ON CONFLICT (marketplace, barcode) WHERE barcode IS NOT NULL DO UPDATE SET
         strategy=EXCLUDED.strategy, price_cut_tl=EXCLUDED.price_cut_tl, max_increase_tl=EXCLUDED.max_increase_tl,
         max_single_change_pct=EXCLUDED.max_single_change_pct,
         max_daily_change_pct=EXCLUDED.max_daily_change_pct, minimum_profit_tl=EXCLUDED.minimum_profit_tl,
         minimum_profit_pct=EXCLUDED.minimum_profit_pct,minimum_margin_pct=EXCLUDED.minimum_margin_pct,
         minimum_price=EXCLUDED.minimum_price,maximum_price=EXCLUDED.maximum_price,
         min_undercut_tl=EXCLUDED.min_undercut_tl,max_undercut_tl=EXCLUDED.max_undercut_tl,
         min_change_interval_minutes=EXCLUDED.min_change_interval_minutes,
         daily_action_limit=EXCLUDED.daily_action_limit, buybox_max_age_minutes=EXCLUDED.buybox_max_age_minutes,
         blacklisted=EXCLUDED.blacklisted, learning_enabled=EXCLUDED.learning_enabled, mode=EXCLUDED.mode,
         auto_update=EXCLUDED.auto_update, note=EXCLUDED.note, updated_at=NOW() RETURNING *`,
      values,
    );
    await this.db.query(
      `UPDATE products SET auto_update=$1, target_profit=COALESCE($2,target_profit), updated_at=NOW()
       WHERE marketplace=$3 AND barcode=$4`,
      [
        Boolean(merged.auto_update),
        merged.minimum_profit_tl,
        marketplace,
        barcode,
      ],
    );
    return result.rows[0];
  }

  async bulkUpdateSettings({ target, input, actor = "system" }) {
    const items = await this.bulkTargets(target);
    if (!items.length) return { updated: 0, barcodes: [] };
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const barcodes = items.map((item) => item.barcode);
      const existingRows = (
        await client.query(
          `SELECT * FROM product_settings
           WHERE marketplace=$1 AND barcode=ANY($2::text[])`,
          [target.marketplace || "TRENDYOL", barcodes],
        )
      ).rows;
      const existingByBarcode = new Map(
        existingRows.map((row) => [row.barcode, row]),
      );
      const rows = [];
      for (const item of items) {
        const merged = {
          ...DEFAULT_PRODUCT_SETTINGS,
          ...(existingByBarcode.get(item.barcode) || {}),
          ...input,
        };
        rows.push(merged);
        await client.query(
          `INSERT INTO product_settings(
             marketplace, barcode, strategy, price_cut_tl, max_increase_tl,
             max_single_change_pct, max_daily_change_pct, minimum_profit_tl,
             minimum_profit_pct, minimum_margin_pct, minimum_price,
             maximum_price, min_undercut_tl, max_undercut_tl,
             min_change_interval_minutes, daily_action_limit,
             buybox_max_age_minutes, blacklisted, learning_enabled,
             mode, auto_update, note, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
           ON CONFLICT (marketplace, barcode) WHERE barcode IS NOT NULL DO UPDATE SET
             strategy=EXCLUDED.strategy, price_cut_tl=EXCLUDED.price_cut_tl,
             max_increase_tl=EXCLUDED.max_increase_tl,
             max_single_change_pct=EXCLUDED.max_single_change_pct,
             max_daily_change_pct=EXCLUDED.max_daily_change_pct,
             minimum_profit_tl=EXCLUDED.minimum_profit_tl,
             minimum_profit_pct=EXCLUDED.minimum_profit_pct,
             minimum_margin_pct=EXCLUDED.minimum_margin_pct,
             minimum_price=EXCLUDED.minimum_price,
             maximum_price=EXCLUDED.maximum_price,
             min_undercut_tl=EXCLUDED.min_undercut_tl,
             max_undercut_tl=EXCLUDED.max_undercut_tl,
             min_change_interval_minutes=EXCLUDED.min_change_interval_minutes,
             daily_action_limit=EXCLUDED.daily_action_limit,
             buybox_max_age_minutes=EXCLUDED.buybox_max_age_minutes,
             blacklisted=EXCLUDED.blacklisted,
             learning_enabled=EXCLUDED.learning_enabled,
             mode=EXCLUDED.mode,
             auto_update=EXCLUDED.auto_update,
             note=EXCLUDED.note,
             updated_at=NOW()`,
          [
            target.marketplace || "TRENDYOL",
            item.barcode,
            merged.strategy,
            merged.price_cut_tl,
            merged.max_increase_tl,
            merged.max_single_change_pct,
            merged.max_daily_change_pct,
            merged.minimum_profit_tl,
            merged.minimum_profit_pct,
            merged.minimum_margin_pct,
            merged.minimum_price,
            merged.maximum_price,
            merged.min_undercut_tl,
            merged.max_undercut_tl,
            merged.min_change_interval_minutes,
            merged.daily_action_limit,
            merged.buybox_max_age_minutes,
            Boolean(merged.blacklisted),
            Boolean(merged.learning_enabled),
            merged.mode,
            Boolean(merged.auto_update),
            merged.note || null,
          ],
        );
      }
      await client.query(
        `UPDATE products p SET auto_update=ps.auto_update,
           target_profit=COALESCE(ps.minimum_profit_tl,p.target_profit),
           updated_at=NOW()
         FROM product_settings ps
         WHERE ps.marketplace=p.marketplace
           AND ps.barcode=p.barcode
           AND p.marketplace=$1
           AND p.barcode=ANY($2::text[])`,
        [target.marketplace || "TRENDYOL", barcodes],
      );
      await client.query("COMMIT");
      return {
        updated: rows.length,
        barcodes,
        sample: items.slice(0, 10).map((item) => ({
          barcode: item.barcode,
          product_name: item.product_name,
        })),
        actor,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async breakdown(barcode, marketplace = "TRENDYOL") {
    const product = await this.get(barcode, marketplace);
    if (!product) return null;
    const mappings = (
      await this.db.query(
        `SELECT pcm.*, ci.item_name, ci.unit_cost, ci.unit_desi,
              pcm.quantity * ci.unit_cost AS line_cost, pcm.quantity * ci.unit_desi AS line_desi,
              (ci.item_code IS NULL) AS orphan
       FROM product_cost_mappings pcm LEFT JOIN cost_items ci ON ci.item_code=pcm.cost_item_code
       WHERE pcm.marketplace=$1 AND pcm.barcode=$2 ORDER BY ci.item_name`,
        [marketplace, barcode],
      )
    ).rows;
    return { product, mappings };
  }

  async history(barcode, type, marketplace = "TRENDYOL") {
    const queries = {
      buybox: `SELECT * FROM buybox_history WHERE marketplace=$1 AND barcode=$2 ORDER BY observed_at DESC LIMIT 250`,
      price: `SELECT * FROM price_war_log WHERE marketplace=$1 AND barcode=$2 ORDER BY created_at DESC LIMIT 250`,
      repricer: `SELECT * FROM repricer_actions WHERE marketplace=$1 AND barcode=$2 ORDER BY created_at DESC LIMIT 250`,
    };
    return (await this.db.query(queries[type], [marketplace, barcode])).rows;
  }
}

module.exports = { ProductRepository };
