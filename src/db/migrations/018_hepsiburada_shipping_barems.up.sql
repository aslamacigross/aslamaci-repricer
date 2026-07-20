ALTER TABLE shipping_barems
  ADD COLUMN IF NOT EXISTS marketplace TEXT NOT NULL DEFAULT 'TRENDYOL';

ALTER TABLE packaging_rules
  ADD COLUMN IF NOT EXISTS marketplace TEXT NOT NULL DEFAULT 'TRENDYOL';

ALTER TABLE shipping_barems
  DROP CONSTRAINT IF EXISTS shipping_barems_min_basket_max_basket_carrier_key;

CREATE UNIQUE INDEX IF NOT EXISTS shipping_barems_marketplace_range_carrier_uidx
  ON shipping_barems(marketplace,min_basket,max_basket,carrier);

CREATE INDEX IF NOT EXISTS packaging_rules_marketplace_range_idx
  ON packaging_rules(marketplace,min_desi,max_desi);

INSERT INTO system_settings(key,value,description)
SELECT 'default_carrier_trendyol',value,'Trendyol varsayılan kargo firması'
FROM system_settings WHERE key='default_carrier'
ON CONFLICT(key) DO NOTHING;

INSERT INTO system_settings(key,value,description) VALUES
  ('default_carrier_hepsiburada','"hepsiJET"','Hepsiburada varsayılan kargo firması'),
  ('service_fee_hepsiburada','10.50','Hepsiburada KDV dahil varsayılan hizmet bedeli')
ON CONFLICT(key) DO NOTHING;

INSERT INTO system_settings(key,value,description)
SELECT 'service_fee_trendyol',value,'Trendyol varsayılan hizmet bedeli'
FROM system_settings WHERE key='service_fee'
ON CONFLICT(key) DO NOTHING;

INSERT INTO shipping_barems(
  marketplace,min_basket,max_basket,barem_name,carrier,
  cost_ex_vat,cost_inc_vat,vat_rate,updated_at
) VALUES
  ('HEPSIBURADA',0,199.99,'BAREM','hepsiJET',42,50.40,20,NOW()),
  ('HEPSIBURADA',0,199.99,'BAREM','DHL Kargo',96,115.20,20,NOW()),
  ('HEPSIBURADA',0,199.99,'BAREM','PTT Kargo',87,104.40,20,NOW()),
  ('HEPSIBURADA',0,199.99,'BAREM','Kolay Gelsin',96.20,115.44,20,NOW()),
  ('HEPSIBURADA',0,199.99,'BAREM','Sürat Kargo',42,50.40,20,NOW()),
  ('HEPSIBURADA',0,199.99,'BAREM','TEX',27.08,32.50,20,NOW()),
  ('HEPSIBURADA',0,199.99,'BAREM','Yurtiçi Kargo',123.70,148.44,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','hepsiJET',72,86.40,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','DHL Kargo',104,124.80,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','PTT Kargo',106.60,127.92,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','Kolay Gelsin',106.40,127.68,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','Sürat Kargo',72,86.40,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','TEX',51.66,61.99,20,NOW()),
  ('HEPSIBURADA',200,399.99,'BAREM2','Yurtiçi Kargo',131.50,157.80,20,NOW())
ON CONFLICT(marketplace,min_basket,max_basket,carrier) DO UPDATE SET
  barem_name=EXCLUDED.barem_name,
  cost_ex_vat=EXCLUDED.cost_ex_vat,
  cost_inc_vat=EXCLUDED.cost_inc_vat,
  vat_rate=EXCLUDED.vat_rate,
  updated_at=NOW();
