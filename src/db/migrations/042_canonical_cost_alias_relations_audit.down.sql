DROP TABLE IF EXISTS cost_integrity_operations;
DROP TABLE IF EXISTS supplier_offer_relations;
DROP TABLE IF EXISTS cost_item_aliases;

ALTER TABLE file_market_items
  DROP CONSTRAINT IF EXISTS file_market_items_offer_type_check;

ALTER TABLE file_market_items
  DROP COLUMN IF EXISTS checked_at,
  DROP COLUMN IF EXISTS physical_supplier_code,
  DROP COLUMN IF EXISTS offer_type;
