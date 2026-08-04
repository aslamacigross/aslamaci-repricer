ALTER TABLE products
  ADD COLUMN IF NOT EXISTS active_seller_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trendyol_funded_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaign_adjustment_source TEXT,
  ADD COLUMN IF NOT EXISTS campaign_adjustment_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS campaign_adjustment_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_campaign_adjustment_updated
  ON products(marketplace,campaign_adjustment_updated_at)
  WHERE active_seller_discount > 0 OR trendyol_funded_discount > 0;
