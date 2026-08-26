ALTER TABLE products
  ADD COLUMN IF NOT EXISTS marketplace_catalog_barcode TEXT;

CREATE INDEX IF NOT EXISTS idx_products_marketplace_catalog_barcode
  ON products(marketplace,marketplace_catalog_barcode)
  WHERE marketplace_catalog_barcode IS NOT NULL;
