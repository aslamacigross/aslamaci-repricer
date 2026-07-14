UPDATE products
SET commission_rate = trendyol_commission_rate,
    base_commission_rate = trendyol_commission_rate,
    special_commission_active = FALSE,
    special_commission_note = NULL,
    updated_at = NOW()
WHERE marketplace='TRENDYOL'
  AND trendyol_commission_rate IS NOT NULL
  AND trendyol_commission_rate > 0;

DELETE FROM commission_rules
WHERE marketplace='TRENDYOL';
