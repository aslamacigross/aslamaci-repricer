ALTER TABLE cost_item_file_links
  DROP CONSTRAINT IF EXISTS cost_item_file_links_cost_item_code_fk;

ALTER TABLE product_cost_mappings
  DROP CONSTRAINT IF EXISTS product_cost_mappings_cost_item_code_fk;

DROP TABLE IF EXISTS cost_item_supplier_offers;
