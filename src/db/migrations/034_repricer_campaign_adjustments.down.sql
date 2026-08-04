DROP INDEX IF EXISTS idx_products_campaign_adjustment_updated;

ALTER TABLE products
  DROP COLUMN IF EXISTS campaign_adjustment_updated_at,
  DROP COLUMN IF EXISTS campaign_adjustment_details,
  DROP COLUMN IF EXISTS campaign_adjustment_source,
  DROP COLUMN IF EXISTS trendyol_funded_discount,
  DROP COLUMN IF EXISTS active_seller_discount;
