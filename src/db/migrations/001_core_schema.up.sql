CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  barcode TEXT NOT NULL,
  product_name TEXT,
  brand TEXT,
  category_name TEXT,
  category_id TEXT,
  commission_rate NUMERIC(8,4),
  my_price NUMERIC(14,2),
  list_price NUMERIC(14,2),
  stock_quantity INTEGER DEFAULT 0,
  archived BOOLEAN DEFAULT FALSE,
  locked BOOLEAN DEFAULT FALSE,
  on_sale BOOLEAN DEFAULT FALSE,
  approved BOOLEAN DEFAULT FALSE,
  buybox_price NUMERIC(14,2),
  second_price NUMERIC(14,2),
  third_price NUMERIC(14,2),
  rank INTEGER,
  has_multiple_seller BOOLEAN,
  desi NUMERIC(12,3),
  packaging_cost NUMERIC(14,2) DEFAULT 0,
  service_fee NUMERIC(14,2) DEFAULT 13.19,
  target_profit NUMERIC(14,2) DEFAULT 40,
  calculated_product_cost NUMERIC(14,2) DEFAULT 0,
  calculated_shipping_cost NUMERIC(14,2) DEFAULT 0,
  calculated_total_cost NUMERIC(14,2) DEFAULT 0,
  calculated_min_price NUMERIC(14,2) DEFAULT 0,
  min_price NUMERIC(14,2) DEFAULT 0,
  calculated_net_profit NUMERIC(14,2) DEFAULT 0,
  calculated_net_margin NUMERIC(10,4) DEFAULT 0,
  auto_update BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  needs_cost_mapping BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(marketplace, barcode)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS buybox_updated_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_price_change_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS data_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS data_status TEXT DEFAULT 'INCOMPLETE';
ALTER TABLE products ADD COLUMN IF NOT EXISTS marketplace_product_id TEXT;

CREATE TABLE IF NOT EXISTS cost_items (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'adet',
  unit_desi NUMERIC(12,4) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS note TEXT;

CREATE TABLE IF NOT EXISTS product_cost_mappings (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  barcode TEXT NOT NULL,
  cost_item_code TEXT NOT NULL,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(marketplace, barcode, cost_item_code)
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  category_id TEXT NOT NULL,
  category_name TEXT,
  commission_rate NUMERIC(8,4) NOT NULL,
  note TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(marketplace, category_id)
);

CREATE TABLE IF NOT EXISTS shipping_costs (
  id BIGSERIAL PRIMARY KEY,
  desi_kg NUMERIC(12,3) NOT NULL,
  carrier TEXT NOT NULL,
  cost_ex_vat NUMERIC(14,2) NOT NULL,
  cost_inc_vat NUMERIC(14,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(desi_kg, carrier)
);
ALTER TABLE shipping_costs ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(8,4) DEFAULT 20;

CREATE TABLE IF NOT EXISTS shipping_barems (
  id BIGSERIAL PRIMARY KEY,
  min_basket NUMERIC(14,2) NOT NULL,
  max_basket NUMERIC(14,2) NOT NULL,
  barem_name TEXT,
  carrier TEXT NOT NULL,
  cost_ex_vat NUMERIC(14,2) NOT NULL,
  cost_inc_vat NUMERIC(14,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(min_basket, max_basket, carrier)
);
ALTER TABLE shipping_barems ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(8,4) DEFAULT 20;

CREATE TABLE IF NOT EXISTS packaging_rules (
  id BIGSERIAL PRIMARY KEY,
  min_desi NUMERIC(12,3) NOT NULL,
  max_desi NUMERIC(12,3) NOT NULL,
  packaging_cost NUMERIC(14,2) NOT NULL,
  note TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_war_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  marketplace TEXT NOT NULL,
  barcode TEXT NOT NULL,
  product_name TEXT,
  old_price NUMERIC,
  new_price NUMERIC,
  price_diff NUMERIC,
  buybox_price NUMERIC,
  second_price NUMERIC,
  third_price NUMERIC,
  rank INTEGER,
  min_price NUMERIC,
  action TEXT
);

CREATE TABLE IF NOT EXISTS buybox_snapshots (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  barcode TEXT NOT NULL,
  product_name TEXT,
  my_price NUMERIC,
  buybox_price NUMERIC,
  second_price NUMERIC,
  third_price NUMERIC,
  rank INTEGER,
  has_multiple_seller BOOLEAN,
  min_price NUMERIC,
  net_profit NUMERIC,
  net_margin NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_settings (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  barcode TEXT,
  category_id TEXT,
  strategy TEXT DEFAULT 'Normal',
  price_cut_tl NUMERIC(14,2) DEFAULT 0.10,
  max_increase_tl NUMERIC(14,2) DEFAULT 10,
  max_daily_change_pct NUMERIC(8,3) DEFAULT 15,
  auto_update BOOLEAN DEFAULT FALSE,
  note TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS minimum_profit_tl NUMERIC(14,2) DEFAULT 40;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS minimum_profit_pct NUMERIC(8,3);
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS minimum_margin_pct NUMERIC(8,3);
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS minimum_price NUMERIC(14,2);
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS maximum_price NUMERIC(14,2);
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS min_undercut_tl NUMERIC(14,2) DEFAULT 0.10;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS max_undercut_tl NUMERIC(14,2) DEFAULT 75;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS min_change_interval_minutes INTEGER DEFAULT 30;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS daily_action_limit INTEGER DEFAULT 3;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS buybox_max_age_minutes INTEGER DEFAULT 20;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN DEFAULT FALSE;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS learning_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'MANUAL';

CREATE UNIQUE INDEX IF NOT EXISTS product_settings_barcode_uidx
  ON product_settings(marketplace, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_filters_idx ON products(marketplace, is_active, auto_update, category_id);
CREATE INDEX IF NOT EXISTS products_sale_idx ON products(marketplace, on_sale);
CREATE INDEX IF NOT EXISTS products_buybox_idx ON products(marketplace, rank, buybox_updated_at);
CREATE INDEX IF NOT EXISTS mappings_barcode_idx ON product_cost_mappings(marketplace, barcode);
CREATE INDEX IF NOT EXISTS mappings_cost_code_idx ON product_cost_mappings(cost_item_code);
CREATE INDEX IF NOT EXISTS price_war_log_barcode_idx ON price_war_log(barcode, created_at DESC);
CREATE INDEX IF NOT EXISTS buybox_snapshots_barcode_idx ON buybox_snapshots(barcode, created_at DESC);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_settings(key, value, description) VALUES
  ('global_dry_run', 'true', 'Gercek fiyat gonderimini engeller'),
  ('global_repricer_enabled', 'false', 'Otomatik repricer ana anahtari'),
  ('google_sheets_sync_enabled', 'false', 'Sheets gecis donemi senkronizasyonu'),
  ('default_target_profit', '40', 'Varsayilan minimum kar TL'),
  ('default_price_cut_tl', '0.10', 'Varsayilan fiyat kirma TL'),
  ('global_max_price_change_pct', '15', 'Global fiyat degisim limiti'),
  ('default_carrier', '"TEX"', 'Varsayilan kargo firmasi'),
  ('service_fee', '13.19', 'Varsayilan hizmet bedeli')
ON CONFLICT (key) DO NOTHING;

INSERT INTO commission_rules(marketplace,category_id,category_name,commission_rate)
SELECT DISTINCT ON (marketplace,category_id) marketplace,category_id,category_name,commission_rate
FROM products WHERE category_id IS NOT NULL AND commission_rate>0
ON CONFLICT (marketplace,category_id) DO NOTHING;

-- Migration safety baseline. Existing explicit TRUE values are preserved.
UPDATE products SET auto_update = FALSE WHERE auto_update IS NULL;
