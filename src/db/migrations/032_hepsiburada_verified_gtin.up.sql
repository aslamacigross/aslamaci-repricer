ALTER TABLE products
  ADD COLUMN IF NOT EXISTS catalog_gtin TEXT,
  ADD COLUMN IF NOT EXISTS catalog_gtin_source TEXT;

CREATE INDEX IF NOT EXISTS idx_products_verified_catalog_gtin
  ON products(marketplace,catalog_gtin)
  WHERE catalog_gtin IS NOT NULL
    AND catalog_gtin_source IS NOT NULL;
