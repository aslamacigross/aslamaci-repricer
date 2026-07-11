DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS commission_rules;
DROP INDEX IF EXISTS product_settings_barcode_uidx;
ALTER TABLE products DROP COLUMN IF EXISTS marketplace_product_id;
ALTER TABLE products DROP COLUMN IF EXISTS data_status;
ALTER TABLE products DROP COLUMN IF EXISTS data_complete;
ALTER TABLE products DROP COLUMN IF EXISTS last_price_change_at;
ALTER TABLE products DROP COLUMN IF EXISTS buybox_updated_at;
