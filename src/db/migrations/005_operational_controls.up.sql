INSERT INTO system_settings(key, value, description)
VALUES ('maintenance_mode', 'false', 'Bakim modunda yonetim mutasyonlarini durdurur')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE cost_items
  ADD CONSTRAINT ck_cost_items_nonnegative
  CHECK (unit_cost >= 0 AND COALESCE(unit_desi, 0) >= 0) NOT VALID;

ALTER TABLE product_cost_mappings
  ADD CONSTRAINT ck_product_cost_mapping_quantity
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE commission_rules
  ADD CONSTRAINT ck_commission_rate_range
  CHECK (commission_rate > 0 AND commission_rate < 100) NOT VALID;

ALTER TABLE shipping_costs
  ADD CONSTRAINT ck_shipping_costs_values
  CHECK (desi_kg >= 0 AND cost_ex_vat >= 0 AND cost_inc_vat >= 0) NOT VALID;

ALTER TABLE shipping_barems
  ADD CONSTRAINT ck_shipping_barems_values
  CHECK (
    min_basket >= 0 AND max_basket > min_basket
    AND cost_ex_vat >= 0 AND cost_inc_vat >= 0
  ) NOT VALID;

ALTER TABLE packaging_rules
  ADD CONSTRAINT ck_packaging_rules_values
  CHECK (
    min_desi >= 0 AND max_desi >= min_desi AND packaging_cost >= 0
  ) NOT VALID;

ALTER TABLE repricer_actions
  ADD CONSTRAINT ck_repricer_action_prices
  CHECK (
    old_price > 0 AND proposed_price > 0 AND COALESCE(min_price, 0) >= 0
  ) NOT VALID;
