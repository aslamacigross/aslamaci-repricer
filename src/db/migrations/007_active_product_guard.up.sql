UPDATE products
SET is_active = (
  approved IS TRUE
  AND on_sale IS TRUE
  AND archived IS NOT TRUE
  AND locked IS NOT TRUE
  AND COALESCE(stock_quantity, 0) > 0
  AND COALESCE(my_price, 0) > 0
)
WHERE marketplace='TRENDYOL';

CREATE INDEX IF NOT EXISTS products_active_guard_idx
  ON products(marketplace, is_active, on_sale, stock_quantity);
