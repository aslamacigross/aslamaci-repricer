ALTER TABLE jobs ADD COLUMN IF NOT EXISTS schedule_type TEXT NOT NULL DEFAULT 'INTERVAL';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS daily_at TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS schedule_timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul';

ALTER TABLE product_cost_mappings
  ADD COLUMN IF NOT EXISTS effective_unit_cost NUMERIC(14,4);
ALTER TABLE product_cost_mappings
  ADD COLUMN IF NOT EXISTS supplier_price_tier JSONB;

ALTER TABLE shipping_costs
  ADD COLUMN IF NOT EXISTS marketplace TEXT NOT NULL DEFAULT 'TRENDYOL';
ALTER TABLE shipping_costs
  DROP CONSTRAINT IF EXISTS shipping_costs_desi_kg_carrier_key;
CREATE UNIQUE INDEX IF NOT EXISTS shipping_costs_marketplace_rate_uidx
  ON shipping_costs(marketplace,desi_kg,carrier);

ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS desi_source TEXT;
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS desi_confidence TEXT;
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS desi_checked_at TIMESTAMPTZ;

ALTER TABLE product_settings
  ADD COLUMN IF NOT EXISTS adaptive_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE product_settings
  ADD COLUMN IF NOT EXISTS adaptive_sync_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE product_settings
  ADD COLUMN IF NOT EXISTS next_buybox_sync_at TIMESTAMPTZ;
ALTER TABLE product_settings
  ADD COLUMN IF NOT EXISTS competition_score NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE product_settings
  ADD COLUMN IF NOT EXISTS unlimited_increase BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS product_settings_adaptive_sync_idx
  ON product_settings(marketplace, adaptive_sync_enabled, next_buybox_sync_at);

CREATE TABLE IF NOT EXISTS supplier_cost_sync_events (
  id BIGSERIAL PRIMARY KEY,
  supplier_code TEXT NOT NULL,
  file_market_item_id BIGINT REFERENCES file_market_items(id) ON DELETE SET NULL,
  cost_item_code TEXT NOT NULL,
  old_unit_cost NUMERIC(14,4),
  new_unit_cost NUMERIC(14,4) NOT NULL,
  affected_barcodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supplier_cost_sync_events_recent_idx
  ON supplier_cost_sync_events(supplier_code, created_at DESC);

CREATE TABLE IF NOT EXISTS shipping_tariff_imports (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_name TEXT NOT NULL,
  rate_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,source_version)
);

CREATE TABLE IF NOT EXISTS health_check_runs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS health_check_runs_recent_idx
  ON health_check_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS desi_review_queue (
  id BIGSERIAL PRIMARY KEY,
  cost_item_code TEXT NOT NULL REFERENCES cost_items(item_code) ON DELETE CASCADE,
  product_name TEXT,
  product_image_url TEXT,
  proposed_desi NUMERIC(12,4),
  confidence TEXT NOT NULL DEFAULT 'LOW',
  basis TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cost_item_code)
);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  external_order_number TEXT NOT NULL,
  external_package_id TEXT,
  status TEXT,
  order_date TIMESTAMPTZ,
  last_modified_at TIMESTAMPTZ,
  customer_city TEXT,
  customer_district TEXT,
  gross_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  marketplace_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  seller_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  service_fee_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  product_cost_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  operational_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace, external_order_number, external_package_id)
);
CREATE INDEX IF NOT EXISTS marketplace_orders_period_idx
  ON marketplace_orders(marketplace, order_date DESC);
CREATE INDEX IF NOT EXISTS marketplace_orders_status_idx
  ON marketplace_orders(marketplace, status, order_date DESC);

CREATE TABLE IF NOT EXISTS marketplace_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  external_line_id TEXT,
  barcode TEXT,
  product_name TEXT,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit_sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(8,4),
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  product_unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  product_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  desi NUMERIC(12,3),
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, external_line_id)
);
CREATE INDEX IF NOT EXISTS marketplace_order_items_barcode_idx
  ON marketplace_order_items(barcode, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_financial_transactions (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  external_transaction_id TEXT NOT NULL,
  external_order_number TEXT,
  external_package_id TEXT,
  transaction_type TEXT NOT NULL,
  transaction_date TIMESTAMPTZ,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  seller_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace, external_transaction_id, transaction_type)
);
CREATE INDEX IF NOT EXISTS marketplace_financial_period_idx
  ON marketplace_financial_transactions(marketplace, transaction_date DESC);

CREATE TABLE IF NOT EXISTS monthly_packaging_expenses (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'ALL',
  period_month DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace, period_month)
);

INSERT INTO system_settings(key,value,description) VALUES
  ('global_max_daily_decrease_pct','5','Aşağı yönlü günlük azami fiyat değişimi'),
  ('global_unlimited_increase','true','Buybox korunabildiği sürece yukarı yönlü limiti kaldırır'),
  ('supplier_sync_timezone','"Europe/Istanbul"','Tedarikçi gece senkronizasyon saat dilimi'),
  ('supplier_sync_daily_at','"00:00"','Tedarikçi günlük senkronizasyon saati'),
  ('health_scan_daily_at','"00:30"','Günlük sistem sağlık taraması saati'),
  ('orders_sync_minutes','60','Sipariş senkronizasyon sıklığı'),
  ('finance_vat_mode','"CASH_AND_VAT_EXCLUDED"','Nakit ve KDV hariç kârlılığı ayrı raporlar')
ON CONFLICT(key) DO NOTHING;

UPDATE jobs
SET schedule_type='DAILY',daily_at='00:00',schedule_timezone='Europe/Istanbul',
    enabled=TRUE,updated_at=NOW()
WHERE name IN(
  'sync-file-market-prices',
  'sync-bizim-market-prices',
  'sync-bim-market-prices'
);

INSERT INTO jobs(
  name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone
) VALUES
  ('daily-system-health','Veri, entegrasyon ve job sağlığını günlük tarar',1440,TRUE,'DAILY','00:30','Europe/Istanbul'),
  ('estimate-cost-desi','Tedarikçi gramajı ve ürün tipinden cost code desilerini yeniler',1440,TRUE,'DAILY','00:20','Europe/Istanbul'),
  ('sync-orders','Trendyol siparişlerini ve maliyet anlık görüntülerini yeniler',60,TRUE,'INTERVAL',NULL,'Europe/Istanbul'),
  ('sync-hepsiburada-orders','Hepsiburada siparişlerini read-only yeniler',60,FALSE,'INTERVAL',NULL,'Europe/Istanbul'),
  ('sync-financial-transactions','Trendyol finansal mutabakat kayıtlarını yeniler',360,TRUE,'INTERVAL',NULL,'Europe/Istanbul'),
  ('import-hepsiburada-shipping','Paketli Hepsiburada kargo tarifesini güvenli biçimde içe aktarır',1440,FALSE,'INTERVAL',NULL,'Europe/Istanbul'),
  ('sync-buybox-adaptive','Barkod bazlı rekabet yoğunluğuna göre buybox verisini yeniler',1,TRUE,'INTERVAL',NULL,'Europe/Istanbul')
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=EXCLUDED.schedule_minutes,
  schedule_type=EXCLUDED.schedule_type,
  daily_at=EXCLUDED.daily_at,
  schedule_timezone=EXCLUDED.schedule_timezone,
  updated_at=NOW();

UPDATE jobs SET enabled=FALSE,updated_at=NOW() WHERE name='sync-buybox';
