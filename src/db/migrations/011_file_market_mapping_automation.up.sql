ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS price_source TEXT DEFAULT 'MANUAL';
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS previous_unit_cost NUMERIC(14,4);
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS file_market_items (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT UNIQUE NOT NULL,
  product_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  brand TEXT,
  size_value NUMERIC(14,4),
  size_unit TEXT,
  current_price NUMERIC(14,2) NOT NULL,
  previous_price NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'TRY',
  availability TEXT NOT NULL DEFAULT 'AVAILABLE',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS file_market_price_history (
  id BIGSERIAL PRIMARY KEY,
  file_market_item_id BIGINT NOT NULL REFERENCES file_market_items(id) ON DELETE CASCADE,
  price NUMERIC(14,2) NOT NULL,
  availability TEXT NOT NULL DEFAULT 'AVAILABLE',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_item_file_links (
  id BIGSERIAL PRIMARY KEY,
  cost_item_code TEXT UNIQUE NOT NULL,
  file_market_item_id BIGINT NOT NULL REFERENCES file_market_items(id) ON DELETE CASCADE,
  confidence NUMERIC(6,5) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'APPROVED',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(file_market_item_id, cost_item_code)
);

CREATE TABLE IF NOT EXISTS mapping_suggestions (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  confidence NUMERIC(6,5) NOT NULL,
  confidence_band TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_barcode TEXT,
  file_market_item_id BIGINT REFERENCES file_market_items(id) ON DELETE SET NULL,
  update_file_price BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mapping_suggestion_items (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id BIGINT NOT NULL REFERENCES mapping_suggestions(id) ON DELETE CASCADE,
  cost_item_code TEXT NOT NULL,
  file_market_item_id BIGINT REFERENCES file_market_items(id) ON DELETE SET NULL,
  quantity NUMERIC(14,4) NOT NULL,
  current_unit_cost NUMERIC(14,4),
  suggested_unit_cost NUMERIC(14,4),
  unit_desi NUMERIC(12,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(suggestion_id, cost_item_code)
);

CREATE INDEX IF NOT EXISTS file_market_items_search_idx
  ON file_market_items(normalized_name);
CREATE INDEX IF NOT EXISTS file_market_price_history_item_idx
  ON file_market_price_history(file_market_item_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS mapping_suggestions_queue_idx
  ON mapping_suggestions(status, confidence DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS mapping_suggestions_barcode_idx
  ON mapping_suggestions(marketplace, barcode, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mapping_suggestions_actionable_uidx
  ON mapping_suggestions(marketplace, barcode)
  WHERE status IN ('PENDING', 'APPROVED');

INSERT INTO jobs(name, description, schedule_minutes, enabled)
VALUES(
  'generate-mapping-suggestions',
  'Eksik ürünler için geçmiş mapping ve File fiyat havuzundan akıllı öneriler üretir',
  1440,
  FALSE
)
ON CONFLICT(name) DO NOTHING;
