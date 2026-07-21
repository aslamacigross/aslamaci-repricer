DELETE FROM jobs WHERE name IN('sync-bizim-market-prices','sync-bim-market-prices');

DROP INDEX IF EXISTS mapping_suggestions_supplier_idx;
DROP INDEX IF EXISTS supplier_price_items_search_idx;
DROP INDEX IF EXISTS supplier_price_items_pool_idx;

ALTER TABLE mapping_suggestion_items DROP COLUMN IF EXISTS supplier_code;
ALTER TABLE mapping_suggestions DROP COLUMN IF EXISTS supplier_code;
ALTER TABLE file_market_items DROP COLUMN IF EXISTS desi_confidence;
ALTER TABLE file_market_items DROP COLUMN IF EXISTS estimated_unit_desi;
ALTER TABLE file_market_items DROP COLUMN IF EXISTS source_category;
ALTER TABLE file_market_items DROP COLUMN IF EXISTS source_url;
ALTER TABLE file_market_items DROP COLUMN IF EXISTS supplier_code;
