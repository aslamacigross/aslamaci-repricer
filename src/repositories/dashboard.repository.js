class DashboardRepository {
  constructor(db) {
    this.db = db;
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  async get({ fresh = false } = {}) {
    if (!fresh && this.cache && Date.now() < this.cacheExpiresAt)
      return this.cache;
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
    ] = await Promise.all([
      this.db.query(`SELECT
        COUNT(*)::int total_products,
        COUNT(*) FILTER(WHERE is_active)::int active_products,
        COUNT(*) FILTER(WHERE stock_quantity>0)::int stocked_products,
        COUNT(*) FILTER(WHERE data_complete)::int complete_products,
        COUNT(*) FILTER(WHERE needs_cost_mapping)::int missing_mapping,
        COUNT(*) FILTER(WHERE commission_rate IS NULL OR commission_rate<=0)::int missing_commission,
        COUNT(*) FILTER(WHERE calculated_shipping_cost<=0)::int missing_shipping,
        COUNT(*) FILTER(WHERE calculated_net_profit<0)::int loss_products,
        COUNT(*) FILTER(WHERE min_price>0 AND my_price<min_price)::int below_minimum,
        COUNT(*) FILTER(WHERE rank=1)::int buybox_owned,
        COUNT(*) FILTER(WHERE rank IS DISTINCT FROM 1)::int buybox_outside,
        COUNT(*) FILTER(WHERE rank IS DISTINCT FROM 1 AND data_complete=TRUE
          AND buybox_price>0 AND min_price<=buybox_price)::int buybox_available,
        COUNT(*) FILTER(WHERE buybox_updated_at IS NULL OR buybox_updated_at<NOW()-INTERVAL '20 minutes')::int stale_buybox,
        COUNT(*) FILTER(WHERE auto_update)::int auto_update_enabled,
        ROUND(AVG(calculated_net_margin)::numeric,2) average_margin,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE created_at>NOW()-INTERVAL '24 hours') actions_24h,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE created_at>NOW()-INTERVAL '24 hours' AND status IN('SUCCESS','SENT','AWAITING_RESULT','DRY_RUN')) successful_actions_24h,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE created_at>NOW()-INTERVAL '24 hours' AND status='FAILED') failed_actions_24h
        FROM products WHERE marketplace='TRENDYOL'`),
      this.db
        .query(`SELECT COALESCE(category_name,'Kategori Yok') name,COUNT(*)::int count,
        ROUND(AVG(calculated_net_margin)::numeric,2) margin FROM products WHERE marketplace='TRENDYOL'
        GROUP BY category_name ORDER BY count DESC LIMIT 12`),
      this.db.query(`SELECT DATE(created_at) AS "day",COUNT(*)::int count,
        COUNT(*) FILTER(WHERE status IN('SUCCESS','SENT','DRY_RUN'))::int successful,
        COUNT(*) FILTER(WHERE status='FAILED')::int failed
        FROM repricer_actions WHERE created_at>NOW()-INTERVAL '14 days' GROUP BY DATE(created_at) ORDER BY day`),
      this.db.query(`SELECT DATE(checked_at) AS "day",
        COUNT(*) FILTER(WHERE buybox_won=TRUE)::int won,
        COUNT(*) FILTER(WHERE buybox_lost=TRUE)::int lost,
        COUNT(*) FILTER(WHERE target_achieved=TRUE)::int target_achieved
        FROM price_change_outcomes WHERE checked_at>NOW()-INTERVAL '14 days'
        GROUP BY DATE(checked_at) ORDER BY day`),
      this.db.query(`SELECT COALESCE(ra.strategy,'Belirsiz') name,
        COUNT(*)::int attempts,
        COUNT(*) FILTER(WHERE rr.target_achieved=TRUE)::int successes,
        ROUND(100.0*COUNT(*) FILTER(WHERE rr.target_achieved=TRUE)/NULLIF(COUNT(*),0),2) success_rate
        FROM repricer_results rr JOIN repricer_actions ra ON ra.id=rr.action_id
        WHERE rr.checked_at>NOW()-INTERVAL '90 days'
        GROUP BY ra.strategy ORDER BY attempts DESC`),
      this.db.query(`SELECT CASE
          WHEN learned_price_cut_tl<=0.50 THEN '0-0,50 TL'
          WHEN learned_price_cut_tl<=1 THEN '0,51-1 TL'
          WHEN learned_price_cut_tl<=2 THEN '1,01-2 TL'
          ELSE '2 TL üzeri' END name,
        COUNT(*)::int count
        FROM repricer_learning GROUP BY 1 ORDER BY MIN(learned_price_cut_tl)`),
      this.db
        .query(`SELECT barcode,product_name,calculated_net_profit value,calculated_net_margin margin
        FROM products WHERE calculated_net_profit IS NOT NULL ORDER BY calculated_net_profit DESC LIMIT 7`),
      this.db
        .query(`SELECT barcode,product_name,calculated_net_profit value,calculated_net_margin margin,
        CASE WHEN my_price<min_price THEN 'Minimum fiyat altı' WHEN calculated_net_profit<0 THEN 'Zarar' ELSE 'Düşük marj' END reason
        FROM products WHERE my_price<min_price OR calculated_net_profit<0 OR calculated_net_margin<5
        ORDER BY calculated_net_margin ASC LIMIT 7`),
      this.db.query(
        `SELECT DISTINCT ON(job_name) job_name,status AS last_status,
           started_at AS last_started_at,finished_at AS last_finished_at,error
           FROM job_runs ORDER BY job_name,started_at DESC`,
      ),
      this.db.query(
        `SELECT message,created_at FROM integration_logs WHERE level='ERROR' ORDER BY created_at DESC LIMIT 1`,
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
    };
    this.cache = data;
    this.cacheExpiresAt = Date.now() + 60000;
    return data;
  }

  async refresh() {
    const data = await this.get({ fresh: true });
    await this.db.query(
      `INSERT INTO dashboard_cache(cache_key,payload,refreshed_at)
       VALUES('main',$1::jsonb,NOW())
       ON CONFLICT(cache_key)DO UPDATE SET payload=EXCLUDED.payload,refreshed_at=NOW()`,
      [JSON.stringify(data)],
    );
    return { processed: 1, successful: 1, failed: 0 };
  }
}

module.exports = { DashboardRepository };
