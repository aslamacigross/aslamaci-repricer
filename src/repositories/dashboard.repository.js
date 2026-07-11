class DashboardRepository {
  constructor(db) { this.db = db; }

  async get() {
    const [kpis,categories,actions,profit,risk,jobs,error] = await Promise.all([
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
        COUNT(*) FILTER(WHERE buybox_updated_at IS NULL OR buybox_updated_at<NOW()-INTERVAL '20 minutes')::int stale_buybox,
        COUNT(*) FILTER(WHERE auto_update)::int auto_update_enabled,
        ROUND(AVG(calculated_net_margin)::numeric,2) average_margin,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE created_at>NOW()-INTERVAL '24 hours') actions_24h,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE created_at>NOW()-INTERVAL '24 hours' AND status IN('SUCCESS','SENT','AWAITING_RESULT','DRY_RUN')) successful_actions_24h,
        (SELECT COUNT(*)::int FROM repricer_actions WHERE created_at>NOW()-INTERVAL '24 hours' AND status='FAILED') failed_actions_24h
        FROM products WHERE marketplace='TRENDYOL'`),
      this.db.query(`SELECT COALESCE(category_name,'Kategori Yok') name,COUNT(*)::int count,
        ROUND(AVG(calculated_net_margin)::numeric,2) margin FROM products WHERE marketplace='TRENDYOL'
        GROUP BY category_name ORDER BY count DESC LIMIT 12`),
      this.db.query(`SELECT DATE(created_at) day,COUNT(*)::int count,
        COUNT(*) FILTER(WHERE status IN('SUCCESS','SENT','DRY_RUN'))::int successful,
        COUNT(*) FILTER(WHERE status='FAILED')::int failed
        FROM repricer_actions WHERE created_at>NOW()-INTERVAL '14 days' GROUP BY DATE(created_at) ORDER BY day`),
      this.db.query(`SELECT barcode,product_name,calculated_net_profit value,calculated_net_margin margin
        FROM products WHERE calculated_net_profit IS NOT NULL ORDER BY calculated_net_profit DESC LIMIT 7`),
      this.db.query(`SELECT barcode,product_name,calculated_net_profit value,calculated_net_margin margin,
        CASE WHEN my_price<min_price THEN 'Minimum fiyat altı' WHEN calculated_net_profit<0 THEN 'Zarar' ELSE 'Düşük marj' END reason
        FROM products WHERE my_price<min_price OR calculated_net_profit<0 OR calculated_net_margin<5
        ORDER BY calculated_net_margin ASC LIMIT 7`),
      this.db.query(`SELECT DISTINCT ON(job_name) job_name,status,started_at,finished_at,error FROM job_runs ORDER BY job_name,started_at DESC`),
      this.db.query(`SELECT message,created_at FROM integration_logs WHERE level='ERROR' ORDER BY created_at DESC LIMIT 1`)
    ]);
    return { kpis: kpis.rows[0], charts: { categories:categories.rows,actions:actions.rows }, topProfit:profit.rows,
      topRisk:risk.rows, jobs:jobs.rows, lastError:error.rows[0] || null };
  }
}

module.exports = { DashboardRepository };
