DROP INDEX IF EXISTS idx_hb_seller_portal_metadata_merchant_sku;
DROP TABLE IF EXISTS hepsiburada_seller_portal_metadata;
DROP INDEX IF EXISTS idx_hb_seller_portal_imports_imported_at;
DROP TABLE IF EXISTS hepsiburada_seller_portal_imports;

ALTER TABLE products
  DROP COLUMN IF EXISTS metadata_refreshed_at,
  DROP COLUMN IF EXISTS product_image_source,
  DROP COLUMN IF EXISTS category_name_source,
  DROP COLUMN IF EXISTS brand_source,
  DROP COLUMN IF EXISTS product_name_source;
