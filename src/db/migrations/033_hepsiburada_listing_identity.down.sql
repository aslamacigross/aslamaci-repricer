DROP INDEX IF EXISTS idx_products_hepsiburada_listing_id;
DROP INDEX IF EXISTS idx_products_hepsiburada_hb_sku;
DROP INDEX IF EXISTS idx_products_hepsiburada_merchant_sku;

ALTER TABLE products
  DROP COLUMN IF EXISTS listing_id,
  DROP COLUMN IF EXISTS hb_sku,
  DROP COLUMN IF EXISTS merchant_sku;
