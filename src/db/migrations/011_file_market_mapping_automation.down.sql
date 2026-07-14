DELETE FROM jobs WHERE name='generate-mapping-suggestions';

DROP TABLE IF EXISTS mapping_suggestion_items;
DROP TABLE IF EXISTS mapping_suggestions;
DROP TABLE IF EXISTS cost_item_file_links;
DROP TABLE IF EXISTS file_market_price_history;
DROP TABLE IF EXISTS file_market_items;

ALTER TABLE cost_items DROP COLUMN IF EXISTS source_checked_at;
ALTER TABLE cost_items DROP COLUMN IF EXISTS previous_unit_cost;
ALTER TABLE cost_items DROP COLUMN IF EXISTS price_source;
