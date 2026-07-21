DELETE FROM shipping_barems WHERE marketplace='HEPSIBURADA';
DELETE FROM packaging_rules WHERE marketplace='HEPSIBURADA';
DELETE FROM system_settings WHERE key IN(
  'default_carrier_trendyol','default_carrier_hepsiburada',
  'service_fee_trendyol','service_fee_hepsiburada'
);

DROP INDEX IF EXISTS shipping_barems_marketplace_range_carrier_uidx;
DROP INDEX IF EXISTS packaging_rules_marketplace_range_idx;

ALTER TABLE shipping_barems DROP COLUMN IF EXISTS marketplace;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS marketplace;

ALTER TABLE shipping_barems
  ADD CONSTRAINT shipping_barems_min_basket_max_basket_carrier_key
  UNIQUE(min_basket,max_basket,carrier);
