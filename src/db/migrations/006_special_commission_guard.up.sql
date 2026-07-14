ALTER TABLE products
  ADD COLUMN IF NOT EXISTS trendyol_commission_rate NUMERIC(8,4);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS base_commission_rate NUMERIC(8,4);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS special_commission_active BOOLEAN DEFAULT FALSE;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS special_commission_checked_at TIMESTAMPTZ;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS special_commission_note TEXT;

CREATE INDEX IF NOT EXISTS products_special_commission_idx
  ON products(marketplace, special_commission_active, updated_at DESC);

UPDATE products
SET base_commission_rate = commission_rate
WHERE base_commission_rate IS NULL
  AND commission_rate IS NOT NULL
  AND commission_rate > 0;

UPDATE products
SET special_commission_active =
  CASE
    WHEN trendyol_commission_rate IS NOT NULL
      AND COALESCE(base_commission_rate, commission_rate) IS NOT NULL
      AND trendyol_commission_rate > 0
      AND COALESCE(base_commission_rate, commission_rate) > 0
      AND trendyol_commission_rate < COALESCE(base_commission_rate, commission_rate) - 0.0001
    THEN TRUE
    ELSE FALSE
  END,
  special_commission_note =
    CASE
      WHEN trendyol_commission_rate IS NOT NULL
        AND COALESCE(base_commission_rate, commission_rate) IS NOT NULL
        AND trendyol_commission_rate > 0
        AND COALESCE(base_commission_rate, commission_rate) > 0
        AND trendyol_commission_rate < COALESCE(base_commission_rate, commission_rate) - 0.0001
      THEN 'Trendyol API komisyonu manuel komisyondan düşük'
      ELSE NULL
    END;
