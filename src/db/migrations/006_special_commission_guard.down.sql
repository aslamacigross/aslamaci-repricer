DROP INDEX IF EXISTS products_special_commission_idx;

ALTER TABLE products DROP COLUMN IF EXISTS special_commission_note;
ALTER TABLE products DROP COLUMN IF EXISTS special_commission_checked_at;
ALTER TABLE products DROP COLUMN IF EXISTS special_commission_active;
ALTER TABLE products DROP COLUMN IF EXISTS base_commission_rate;
ALTER TABLE products DROP COLUMN IF EXISTS trendyol_commission_rate;
