ALTER TABLE repricer_actions
  DROP CONSTRAINT IF EXISTS ck_repricer_action_prices;
ALTER TABLE packaging_rules
  DROP CONSTRAINT IF EXISTS ck_packaging_rules_values;
ALTER TABLE shipping_barems
  DROP CONSTRAINT IF EXISTS ck_shipping_barems_values;
ALTER TABLE shipping_costs
  DROP CONSTRAINT IF EXISTS ck_shipping_costs_values;
ALTER TABLE commission_rules
  DROP CONSTRAINT IF EXISTS ck_commission_rate_range;
ALTER TABLE product_cost_mappings
  DROP CONSTRAINT IF EXISTS ck_product_cost_mapping_quantity;
ALTER TABLE cost_items
  DROP CONSTRAINT IF EXISTS ck_cost_items_nonnegative;

DELETE FROM system_settings
WHERE key='maintenance_mode'
  AND description='Bakim modunda yonetim mutasyonlarini durdurur';
