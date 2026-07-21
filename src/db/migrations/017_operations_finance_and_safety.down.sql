DELETE FROM jobs WHERE name IN(
  'daily-system-health',
  'estimate-cost-desi',
  'sync-orders',
  'sync-hepsiburada-orders',
  'sync-financial-transactions',
  'import-hepsiburada-shipping',
  'sync-buybox-adaptive'
);
UPDATE jobs SET enabled=TRUE,updated_at=NOW() WHERE name='sync-buybox';

DELETE FROM system_settings WHERE key IN(
  'global_max_daily_decrease_pct',
  'global_unlimited_increase',
  'supplier_sync_timezone',
  'supplier_sync_daily_at',
  'health_scan_daily_at',
  'orders_sync_minutes',
  'finance_vat_mode'
);

DROP TABLE IF EXISTS monthly_packaging_expenses;
DROP TABLE IF EXISTS marketplace_financial_transactions;
DROP TABLE IF EXISTS marketplace_order_items;
DROP TABLE IF EXISTS marketplace_orders;
DROP TABLE IF EXISTS health_check_runs;
DROP TABLE IF EXISTS desi_review_queue;
DROP TABLE IF EXISTS supplier_cost_sync_events;
DROP TABLE IF EXISTS shipping_tariff_imports;

ALTER TABLE product_settings DROP COLUMN IF EXISTS unlimited_increase;
ALTER TABLE product_settings DROP COLUMN IF EXISTS competition_score;
ALTER TABLE product_settings DROP COLUMN IF EXISTS next_buybox_sync_at;
ALTER TABLE product_settings DROP COLUMN IF EXISTS adaptive_sync_minutes;
ALTER TABLE product_settings DROP COLUMN IF EXISTS adaptive_sync_enabled;

ALTER TABLE product_cost_mappings DROP COLUMN IF EXISTS supplier_price_tier;
ALTER TABLE product_cost_mappings DROP COLUMN IF EXISTS effective_unit_cost;

ALTER TABLE cost_items DROP COLUMN IF EXISTS desi_checked_at;
ALTER TABLE cost_items DROP COLUMN IF EXISTS desi_confidence;
ALTER TABLE cost_items DROP COLUMN IF EXISTS desi_source;

DROP INDEX IF EXISTS shipping_costs_marketplace_rate_uidx;
ALTER TABLE shipping_costs DROP COLUMN IF EXISTS marketplace;
ALTER TABLE shipping_costs
  ADD CONSTRAINT shipping_costs_desi_kg_carrier_key UNIQUE(desi_kg,carrier);

ALTER TABLE jobs DROP COLUMN IF EXISTS schedule_timezone;
ALTER TABLE jobs DROP COLUMN IF EXISTS daily_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS schedule_type;
