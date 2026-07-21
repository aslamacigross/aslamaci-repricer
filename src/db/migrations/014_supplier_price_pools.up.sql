ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS supplier_code TEXT NOT NULL DEFAULT 'FILE_MARKET';
ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS source_category TEXT;
ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS estimated_unit_desi NUMERIC(12,4);
ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS desi_confidence TEXT NOT NULL DEFAULT 'LOW';

ALTER TABLE mapping_suggestions
  ADD COLUMN IF NOT EXISTS supplier_code TEXT;
ALTER TABLE mapping_suggestion_items
  ADD COLUMN IF NOT EXISTS supplier_code TEXT;

UPDATE file_market_items
SET supplier_code='FILE_MARKET'
WHERE supplier_code IS NULL OR supplier_code='';

UPDATE mapping_suggestions
SET supplier_code='FILE_MARKET'
WHERE supplier_code IS NULL;

UPDATE mapping_suggestion_items
SET supplier_code='FILE_MARKET'
WHERE supplier_code IS NULL;

CREATE INDEX IF NOT EXISTS supplier_price_items_pool_idx
  ON file_market_items(supplier_code, availability, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS supplier_price_items_search_idx
  ON file_market_items(supplier_code, normalized_name);
CREATE INDEX IF NOT EXISTS mapping_suggestions_supplier_idx
  ON mapping_suggestions(supplier_code, status, confidence DESC);

INSERT INTO jobs(name, description, schedule_minutes, enabled)
VALUES(
  'sync-bizim-market-prices',
  'Bizim Toptan web kataloğundan dondurulmuş gıda hariç maliyet havuzunu yeniler',
  1440,
  FALSE
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=COALESCE(jobs.schedule_minutes, EXCLUDED.schedule_minutes),
  updated_at=NOW();
