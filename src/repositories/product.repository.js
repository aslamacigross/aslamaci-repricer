const SORT_COLUMNS = {
  name: "p.product_name",
  price: "p.my_price",
  profit: "p.calculated_net_profit",
  margin: "p.calculated_net_margin",
  updated: "p.updated_at",
  rank: "p.rank",
};

class ProductRepository {
  constructor(db) {
    this.db = db;
  }

  async list(filters) {
    const params = [filters.marketplace || "TRENDYOL"];
    const where = ["p.marketplace = $1"];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.search)
      add(
        "(p.barcode ILIKE ? OR p.product_name ILIKE ? OR p.brand ILIKE ?)",
        `%${filters.search}%`,
      );
    if (filters.search) {
      const value = params.pop();
      const start = params.length + 1;
      params.push(value, value, value);
      where[where.length - 1] =
        `(p.barcode ILIKE $${start} OR p.product_name ILIKE $${start + 1} OR p.brand ILIKE $${start + 2})`;
    }
    if (filters.active !== undefined) add("p.is_active = ?", filters.active);
    if (filters.stocked !== undefined)
      add(
        filters.stocked ? "p.stock_quantity > ?" : "p.stock_quantity <= ?",
        0,
      );
    if (filters.category) add("p.category_id = ?", filters.category);
    if (filters.brand) add("p.brand = ?", filters.brand);
    if (filters.status === "incomplete") where.push("p.data_complete = FALSE");
    if (filters.status === "cost_missing")
      where.push(
        "(p.needs_cost_mapping=TRUE OR p.calculated_product_cost<=0 OR p.desi<=0 OR p.calculated_shipping_cost<=0)",
      );
    if (filters.status === "commission_missing")
      where.push("(p.commission_rate IS NULL OR p.commission_rate<=0)");
    if (filters.status === "loss") where.push("p.calculated_net_profit < 0");
    if (filters.status === "below_min") where.push("p.my_price < p.min_price");
    if (filters.status === "buybox") where.push("p.rank = 1");
    if (filters.status === "outside_buybox")
      where.push("p.rank IS DISTINCT FROM 1");
    if (filters.autoUpdate !== undefined)
      add("p.auto_update = ?", filters.autoUpdate);

    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
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
      strategy: "Manuel",
      price_cut_tl: 0.1,
      max_increase_tl: 10,
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
      ...(existing || {}),
      ...input,
    };
    const values = [
      marketplace,
      barcode,
      merged.strategy,
      merged.price_cut_tl,
      merged.max_increase_tl,
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
         marketplace, barcode, strategy, price_cut_tl, max_increase_tl, max_daily_change_pct,
         minimum_profit_tl, minimum_profit_pct, minimum_margin_pct, minimum_price,
         maximum_price, min_undercut_tl, max_undercut_tl, min_change_interval_minutes,
         daily_action_limit, buybox_max_age_minutes, blacklisted, learning_enabled,
         mode, auto_update, note, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
       ON CONFLICT (marketplace, barcode) WHERE barcode IS NOT NULL DO UPDATE SET
         strategy=EXCLUDED.strategy, price_cut_tl=EXCLUDED.price_cut_tl, max_increase_tl=EXCLUDED.max_increase_tl,
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

  async history(barcode, type) {
    const queries = {
      buybox: `SELECT * FROM buybox_history WHERE marketplace='TRENDYOL' AND barcode=$1 ORDER BY observed_at DESC LIMIT 250`,
      price: `SELECT * FROM price_war_log WHERE barcode=$1 ORDER BY created_at DESC LIMIT 250`,
      repricer: `SELECT * FROM repricer_actions WHERE barcode=$1 ORDER BY created_at DESC LIMIT 250`,
    };
    return (await this.db.query(queries[type], [barcode])).rows;
  }
}

module.exports = { ProductRepository };
