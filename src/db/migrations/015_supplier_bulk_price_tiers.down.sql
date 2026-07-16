DROP INDEX IF EXISTS supplier_price_items_tiers_idx;

ALTER TABLE mapping_suggestion_items
  DROP COLUMN IF EXISTS selected_price_tier;

ALTER TABLE file_market_items
  DROP COLUMN IF EXISTS price_tiers;
