const systemNumericSettingSql = (key) =>
  `(SELECT NULLIF(ss.value #>> '{}','null')::numeric FROM system_settings ss WHERE ss.key='${key}')`;

const productSettingNumericSql = (alias, key) =>
  `(SELECT ps.${key}
     FROM product_settings ps
     WHERE ps.marketplace=${alias}.marketplace AND ps.barcode=${alias}.barcode)`;

const learningNumericSql = (alias, key) =>
  `(SELECT rl.${key}
     FROM repricer_learning rl
     WHERE rl.marketplace=${alias}.marketplace AND rl.barcode=${alias}.barcode)`;

const strategyFactorSql = (alias) =>
  `(CASE COALESCE(
    (SELECT ps.strategy
     FROM product_settings ps
     WHERE ps.marketplace=${alias}.marketplace AND ps.barcode=${alias}.barcode),
    'Normal'
  )
    WHEN 'Temkinli' THEN 0.75
    WHEN 'Agresif' THEN 1.5
    WHEN 'Buybox Odaklı' THEN 1.25
    ELSE 1
  END)`;

const basePriceCutSql = (alias) =>
  `COALESCE(
    (SELECT ps.price_cut_tl
     FROM product_settings ps
     WHERE ps.marketplace=${alias}.marketplace AND ps.barcode=${alias}.barcode),
    ${systemNumericSettingSql("default_price_cut_tl")},
    5
  )`;

const effectivePriceCutSql = (alias) =>
  `LEAST(
    GREATEST(
      GREATEST(${basePriceCutSql(alias)}, COALESCE(${learningNumericSql(alias, "learned_price_cut_tl")},0))
        * ${strategyFactorSql(alias)},
      COALESCE(${productSettingNumericSql(alias, "min_undercut_tl")},0.1)
    ),
    COALESCE(${productSettingNumericSql(alias, "max_undercut_tl")},75)
  )`;

const buyboxActionableSql = (alias) =>
  `${alias}.rank IS DISTINCT FROM 1 AND ${alias}.data_complete=TRUE
    AND ${alias}.buybox_price>0
    AND ${alias}.min_price<=GREATEST(${alias}.buybox_price-${effectivePriceCutSql(alias)},0)`;

class DashboardRepository {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
  }

  async get({ fresh = false, marketplace = "TRENDYOL" } = {}) {
    const normalizedMarketplace = String(
      marketplace || "TRENDYOL",
    ).toUpperCase();
    const cached = this.cache.get(normalizedMarketplace);
    if (!fresh && cached && Date.now() < cached.expiresAt) return cached.data;
    const [
      kpis,
      categories,
      actions,
      buybox,
      strategies,
      learnedSteps,
      profit,
      risk,
      jobs,
      error,
      settings,
    ] = await Promise.all([
      this.db.query(
        `SELECT
        COUNT(*)::int total_products,
        COUNT(*) FILTER(WHERE is_active)::int active_products,
        COUNT(*) FILTER(WHERE stock_quantity>0)::int stocked_products,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND data_complete)::int complete_products,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND (data_status='MAPPING_MISSING' OR NOT EXISTS(
          SELECT 1 FROM product_cost_mappings pcm
          WHERE pcm.marketplace=products.marketplace AND pcm.barcode=products.barcode
        )))::int missing_mapping,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND needs_cost_mapping AND data_status<>'MAPPING_MISSING')::int cost_data_issue,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND (commission_rate IS NULL OR commission_rate<=0))::int missing_commission,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND calculated_shipping_cost<=0)::int missing_shipping,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND calculated_net_profit<0)::int loss_products,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND min_price>0 AND my_price<min_price)::int below_minimum,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND rank=1)::int buybox_owned,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND rank IS DISTINCT FROM 1)::int buybox_outside,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND ${buyboxActionableSql("products")})::int buybox_available,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND (buybox_updated_at IS NULL OR buybox_updated_at<NOW()-INTERVAL '20 minutes'))::int stale_buybox,
        COUNT(*) FILTER(WHERE is_active=TRUE AND stock_quantity>0 AND auto_update)::int auto_update_enabled,
        ROUND(AVG(calculated_net_margin)::numeric,2) average_margin,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE marketplace=$1 AND created_at>NOW()-INTERVAL '24 hours') actions_24h,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE marketplace=$1 AND created_at>NOW()-INTERVAL '24 hours' AND status IN('SUCCESS','SENT','AWAITING_RESULT','DRY_RUN')) successful_actions_24h,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE marketplace=$1 AND created_at>NOW()-INTERVAL '24 hours' AND status='FAILED') failed_actions_24h
        FROM products WHERE marketplace=$1`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT COALESCE(category_name,'Kategori Yok') name,COUNT(*)::int count,
        ROUND(AVG(calculated_net_margin)::numeric,2) margin FROM products WHERE marketplace=$1
        GROUP BY category_name ORDER BY count DESC LIMIT 12`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT DATE(created_at) AS "day",COUNT(*)::int count,
        COUNT(*) FILTER(WHERE status IN('SUCCESS','SENT','DRY_RUN'))::int successful,
        COUNT(*) FILTER(WHERE status='FAILED')::int failed
        FROM repricer_actions WHERE marketplace=$1 AND created_at>NOW()-INTERVAL '14 days'
        GROUP BY DATE(created_at) ORDER BY day`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT DATE(checked_at) AS "day",
        COUNT(*) FILTER(WHERE buybox_won=TRUE)::int won,
        COUNT(*) FILTER(WHERE buybox_lost=TRUE)::int lost,
        COUNT(*) FILTER(WHERE target_achieved=TRUE)::int target_achieved
        FROM price_change_outcomes WHERE marketplace=$1 AND checked_at>NOW()-INTERVAL '14 days'
        GROUP BY DATE(checked_at) ORDER BY day`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT COALESCE(ra.strategy,'Belirsiz') name,
        COUNT(*)::int attempts,
        COUNT(*) FILTER(WHERE rr.target_achieved=TRUE)::int successes,
        ROUND(100.0*COUNT(*) FILTER(WHERE rr.target_achieved=TRUE)/NULLIF(COUNT(*),0),2) success_rate
        FROM repricer_results rr JOIN repricer_actions ra ON ra.id=rr.action_id
        WHERE ra.marketplace=$1 AND rr.checked_at>NOW()-INTERVAL '90 days'
        GROUP BY ra.strategy ORDER BY attempts DESC`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT CASE
          WHEN learned_price_cut_tl<=0.50 THEN '0-0,50 TL'
          WHEN learned_price_cut_tl<=1 THEN '0,51-1 TL'
          WHEN learned_price_cut_tl<=2 THEN '1,01-2 TL'
          ELSE '2 TL üzeri' END name,
        COUNT(*)::int count
        FROM repricer_learning WHERE marketplace=$1
        GROUP BY 1 ORDER BY MIN(learned_price_cut_tl)`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT barcode,product_name,calculated_net_profit value,calculated_net_margin margin
        FROM products WHERE marketplace=$1 AND is_active=TRUE AND stock_quantity>0
          AND calculated_net_profit IS NOT NULL
        ORDER BY calculated_net_profit DESC LIMIT 7`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT barcode,product_name,calculated_net_profit value,calculated_net_margin margin,
        CASE WHEN my_price<min_price THEN 'Minimum fiyat altı' WHEN calculated_net_profit<0 THEN 'Zarar' ELSE 'Düşük marj' END reason
        FROM products WHERE marketplace=$1 AND is_active=TRUE AND stock_quantity>0
          AND (my_price<min_price OR calculated_net_profit<0 OR calculated_net_margin<5)
        ORDER BY calculated_net_margin ASC LIMIT 7`,
        [normalizedMarketplace],
      ),
      this.db.query(
        `SELECT DISTINCT ON(job_name) job_name,status AS last_status,
           started_at AS last_started_at,finished_at AS last_finished_at,error
           FROM job_runs ORDER BY job_name,started_at DESC`,
      ),
      this.db.query(
        `SELECT message,created_at FROM integration_logs WHERE level='ERROR' ORDER BY created_at DESC LIMIT 1`,
      ),
      this.db.query(
        `SELECT key,value FROM system_settings
         WHERE key IN('global_dry_run','global_repricer_enabled','maintenance_mode')`,
      ),
    ]);
    const data = {
      kpis: kpis.rows[0],
      charts: {
        categories: categories.rows,
        actions: actions.rows,
        buybox: buybox.rows,
        strategies: strategies.rows,
        learnedSteps: learnedSteps.rows,
      },
      topProfit: profit.rows,
      topRisk: risk.rows,
      jobs: jobs.rows,
      lastError: error.rows[0] || null,
      settings: Object.fromEntries(
        settings.rows.map((row) => [row.key, row.value]),
      ),
    };
    this.cache.set(normalizedMarketplace, {
      data,
      expiresAt: Date.now() + 60000,
    });
    return data;
  }

  async refresh(marketplace = "TRENDYOL") {
    const normalizedMarketplace = String(
      marketplace || "TRENDYOL",
    ).toUpperCase();
    const data = await this.get({
      fresh: true,
      marketplace: normalizedMarketplace,
    });
    await this.db.query(
      `INSERT INTO dashboard_cache(cache_key,payload,refreshed_at)
       VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(cache_key)DO UPDATE SET payload=EXCLUDED.payload,refreshed_at=NOW()`,
      [`main:${normalizedMarketplace}`, JSON.stringify(data)],
    );
    return { processed: 1, successful: 1, failed: 0 };
  }

  async metricDetails(metric, { limit = 100, marketplace = "TRENDYOL" } = {}) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const normalizedMarketplace = String(
      marketplace || "TRENDYOL",
    ).toUpperCase();
    const sellableProduct = "p.is_active=TRUE AND p.stock_quantity>0";
    const productMetrics = {
      total_products: "TRUE",
      active_products: "p.is_active=TRUE",
      complete_products: `${sellableProduct} AND p.data_complete=TRUE`,
      missing_mapping: `${sellableProduct} AND (p.data_status='MAPPING_MISSING' OR NOT EXISTS(
        SELECT 1 FROM product_cost_mappings pcm
        WHERE pcm.marketplace=p.marketplace AND pcm.barcode=p.barcode
      ))`,
      cost_data_issue: `${sellableProduct} AND p.needs_cost_mapping=TRUE AND p.data_status<>'MAPPING_MISSING'`,
      missing_commission: `${sellableProduct} AND (p.commission_rate IS NULL OR p.commission_rate<=0)`,
      missing_shipping: `${sellableProduct} AND p.calculated_shipping_cost<=0`,
      loss_products: `${sellableProduct} AND p.calculated_net_profit<0`,
      below_minimum: `${sellableProduct} AND p.min_price>0 AND p.my_price<p.min_price`,
      buybox_owned: `${sellableProduct} AND p.rank=1`,
      buybox_available: `${sellableProduct} AND ${buyboxActionableSql("p")}`,
      buybox_outside: `${sellableProduct} AND p.rank IS DISTINCT FROM 1`,
      stale_buybox: `${sellableProduct} AND (p.buybox_updated_at IS NULL OR p.buybox_updated_at<NOW()-INTERVAL '20 minutes')`,
      auto_update_enabled: `${sellableProduct} AND p.auto_update=TRUE`,
    };
    const actionMetrics = {
      actions_24h: "ra.created_at>NOW()-INTERVAL '24 hours'",
      successful_actions_24h:
        "ra.created_at>NOW()-INTERVAL '24 hours' AND ra.status IN('SUCCESS','SENT','AWAITING_RESULT','DRY_RUN')",
      failed_actions_24h:
        "ra.created_at>NOW()-INTERVAL '24 hours' AND ra.status='FAILED'",
    };
    if (productMetrics[metric]) {
      const data = await this.db.query(
        `SELECT p.barcode,p.product_name,p.brand,p.category_name,p.is_active,
          p.stock_quantity,p.my_price,p.buybox_price,p.rank,p.min_price,
          p.calculated_net_profit,p.calculated_net_margin,p.data_status,
          p.auto_update,p.buybox_updated_at,p.needs_cost_mapping,
          p.calculated_product_cost,p.desi,p.calculated_shipping_cost,
          p.packaging_cost,p.service_fee,p.commission_rate,
          COALESCE(mt.mapping_count,0)::int AS mapping_count,
          CASE
            WHEN COALESCE(mt.mapping_count,0)=0 THEN 'Mapping reçetesi yok'
            WHEN p.calculated_product_cost<=0 THEN 'Ürün maliyeti hesaplanmadı'
            WHEN COALESCE(p.desi,0)<=0 THEN 'Desi eksik'
            WHEN COALESCE(p.calculated_shipping_cost,0)<=0 THEN 'Kargo maliyeti eksik'
            WHEN p.commission_rate IS NULL OR p.commission_rate<=0 THEN 'Komisyon eksik'
            WHEN p.data_status='COMPLETE' THEN 'Tamam'
            ELSE p.data_status
          END AS data_issue_label
         FROM products p
         LEFT JOIN (
           SELECT marketplace,barcode,COUNT(*)::int AS mapping_count
           FROM product_cost_mappings
           GROUP BY marketplace,barcode
         ) mt ON mt.marketplace=p.marketplace AND mt.barcode=p.barcode
         WHERE p.marketplace=$1 AND ${productMetrics[metric]}
         ORDER BY
          CASE WHEN p.is_active THEN 0 ELSE 1 END,
          p.product_name NULLS LAST
         LIMIT $2`,
        [normalizedMarketplace, cappedLimit],
      );
      return { type: "products", limit: cappedLimit, items: data.rows };
    }
    if (actionMetrics[metric]) {
      const data = await this.db.query(
        `SELECT ra.id,ra.created_at,ra.barcode,ra.product_name,ra.action,
          ra.status,ra.old_price,ra.proposed_price,ra.min_price,ra.reason,
          ra.source,ra.strategy
         FROM repricer_actions ra
         WHERE ra.marketplace=$1 AND ${actionMetrics[metric]}
         ORDER BY ra.created_at DESC
         LIMIT $2`,
        [normalizedMarketplace, cappedLimit],
      );
      return { type: "actions", limit: cappedLimit, items: data.rows };
    }
    return null;
  }
}

module.exports = { DashboardRepository };
