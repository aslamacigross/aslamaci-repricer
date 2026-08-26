DROP INDEX IF EXISTS idx_products_verified_catalog_gtin;

ALTER TABLE products
  DROP COLUMN IF EXISTS catalog_gtin,
  DROP COLUMN IF EXISTS catalog_gtin_source;
