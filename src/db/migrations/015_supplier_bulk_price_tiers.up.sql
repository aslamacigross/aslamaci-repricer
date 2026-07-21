ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS price_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE mapping_suggestion_items
  ADD COLUMN IF NOT EXISTS selected_price_tier JSONB;

CREATE INDEX IF NOT EXISTS supplier_price_items_tiers_idx
  ON file_market_items(supplier_code)
  WHERE price_tiers <> '[]'::jsonb;
