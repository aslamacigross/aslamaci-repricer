ALTER TABLE products
  ADD COLUMN IF NOT EXISTS merchant_sku TEXT,
  ADD COLUMN IF NOT EXISTS hb_sku TEXT,
  ADD COLUMN IF NOT EXISTS listing_id TEXT;

CREATE INDEX IF NOT EXISTS idx_products_hepsiburada_merchant_sku
  ON products(marketplace,merchant_sku)
  WHERE marketplace='HEPSIBURADA' AND merchant_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_hepsiburada_hb_sku
  ON products(marketplace,hb_sku)
  WHERE marketplace='HEPSIBURADA' AND hb_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_hepsiburada_listing_id
  ON products(marketplace,listing_id)
  WHERE marketplace='HEPSIBURADA' AND listing_id IS NOT NULL;
