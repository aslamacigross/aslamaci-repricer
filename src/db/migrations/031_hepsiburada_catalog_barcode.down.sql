DROP INDEX IF EXISTS idx_products_marketplace_catalog_barcode;

ALTER TABLE products
  DROP COLUMN IF EXISTS marketplace_catalog_barcode;
