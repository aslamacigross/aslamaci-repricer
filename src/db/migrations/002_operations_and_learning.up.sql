CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  schedule_minutes INTEGER,
  enabled BOOLEAN DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  duration_ms INTEGER,
  processed_count INTEGER DEFAULT 0,
  successful_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS job_runs_recent_idx ON job_runs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  ip_address TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_recent_idx ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS integration_logs (
  id BIGSERIAL PRIMARY KEY,
  integration TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'INFO',
  operation TEXT,
  message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integration_logs_recent_idx ON integration_logs(integration, created_at DESC);

CREATE TABLE IF NOT EXISTS repricer_actions (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  product_name TEXT,
  old_price NUMERIC(14,2) NOT NULL,
  proposed_price NUMERIC(14,2) NOT NULL,
  applied_price NUMERIC(14,2),
  action TEXT NOT NULL,
  strategy TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  source TEXT NOT NULL DEFAULT 'WEB',
  batch_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  min_price NUMERIC(14,2),
  buybox_before NUMERIC(14,2),
  rank_before INTEGER,
  second_price NUMERIC(14,2),
  third_price NUMERIC(14,2),
  net_profit_before NUMERIC(14,2),
  expected_profit NUMERIC(14,2),
  expected_margin NUMERIC(10,4),
  safety_checks JSONB DEFAULT '{}'::jsonb,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  api_response JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS repricer_actions_status_idx ON repricer_actions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS repricer_actions_barcode_idx ON repricer_actions(barcode, status, created_at DESC);

CREATE TABLE IF NOT EXISTS repricer_decisions (
  id BIGSERIAL PRIMARY KEY,
  action_id BIGINT REFERENCES repricer_actions(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  strategy TEXT,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision JSONB NOT NULL DEFAULT '{}'::jsonb,
  rule_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repricer_observations (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  observed_price NUMERIC(14,2),
  buybox_price NUMERIC(14,2),
  second_price NUMERIC(14,2),
  third_price NUMERIC(14,2),
  rank INTEGER,
  has_multiple_seller BOOLEAN,
  observed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS repricer_observations_barcode_idx ON repricer_observations(barcode, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS repricer_observations_identity_uidx ON repricer_observations(marketplace, barcode, observed_at);

CREATE TABLE IF NOT EXISTS repricer_outcomes (
  id BIGSERIAL PRIMARY KEY,
  action_id BIGINT REFERENCES repricer_actions(id) ON DELETE CASCADE,
  rank_before INTEGER,
  rank_after INTEGER,
  buybox_before NUMERIC(14,2),
  buybox_after NUMERIC(14,2),
  buybox_won BOOLEAN,
  buybox_lost BOOLEAN,
  profit_before NUMERIC(14,2),
  expected_profit NUMERIC(14,2),
  elapsed_minutes INTEGER NOT NULL,
  outcome TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(action_id, elapsed_minutes)
);
CREATE INDEX IF NOT EXISTS repricer_outcomes_action_idx ON repricer_outcomes(action_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS competitor_price_observations (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  rank INTEGER,
  price NUMERIC(14,2),
  seller_score NUMERIC(8,3),
  coupon_data JSONB,
  observed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repricer_learning (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL,
  barcode TEXT NOT NULL,
  learned_price_cut_tl NUMERIC DEFAULT 0,
  failed_attempts INTEGER DEFAULT 0,
  success_attempts INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(marketplace, barcode)
);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'Öğrenen Pilot';
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS base_undercut NUMERIC(14,2) DEFAULT 0.10;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS min_undercut NUMERIC(14,2) DEFAULT 0.10;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS max_undercut NUMERIC(14,2) DEFAULT 75;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(8,4) DEFAULT 0;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_successful_undercut NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_failed_undercut NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT FALSE;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS strategy_scores JSONB DEFAULT '{}'::jsonb;

INSERT INTO jobs(name, description, schedule_minutes, enabled) VALUES
  ('sync-products', 'Trendyol urunlerini yeniler', 360, TRUE),
  ('sync-buybox', 'Buybox fiyat ve sira verisini yeniler', 10, TRUE),
  ('calculate-costs', 'Maliyet ve minimum fiyatlari hesaplar', 30, TRUE),
  ('validate-data', 'Urun veri butunlugunu kontrol eder', 30, TRUE),
  ('generate-repricer-actions', 'Guvenli fiyat onerileri uretir', 10, TRUE),
  ('run-auto-repricer', 'Secili urunlerde repricer uygular', 10, TRUE),
  ('check-action-outcomes-5m', 'Fiyat sonucunu 5 dakikada olcer', 5, TRUE),
  ('check-action-outcomes-15m', 'Fiyat sonucunu 15 dakikada olcer', 15, TRUE),
  ('check-action-outcomes-60m', 'Fiyat sonucunu 60 dakikada olcer', 60, TRUE),
  ('sheets-import', 'Sheets verilerini transaction ile alir', 1440, TRUE),
  ('sheets-export', 'PostgreSQL ozetini Sheets e aktarir', 60, TRUE),
  ('cleanup-old-logs', 'Eski loglari temizler', 1440, TRUE)
ON CONFLICT (name) DO NOTHING;

-- Preserve pilot history by backfilling only rows that do not already exist.
INSERT INTO repricer_observations (
  marketplace, barcode, observed_price, buybox_price, second_price, third_price,
  rank, has_multiple_seller, observed_at
)
SELECT marketplace, barcode, my_price, buybox_price, second_price, third_price,
       rank, has_multiple_seller, created_at
FROM buybox_snapshots
ON CONFLICT (marketplace, barcode, observed_at) DO NOTHING;
