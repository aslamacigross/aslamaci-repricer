ALTER TABLE packaging_rules
  ADD COLUMN IF NOT EXISTS profile_name TEXT,
  ADD COLUMN IF NOT EXISTS packaging_type TEXT,
  ADD COLUMN IF NOT EXISTS rule_scope TEXT NOT NULL DEFAULT 'DESI',
  ADD COLUMN IF NOT EXISTS match_value TEXT,
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE packaging_rules
SET profile_name=CASE
      WHEN profile_name IS NULL OR profile_name='' THEN
        CASE WHEN note IS NULL OR note='' THEN 'Eski desi kuralı' ELSE note END
      ELSE profile_name
    END,
    packaging_type=CASE
      WHEN packaging_type IS NULL OR packaging_type='' THEN 'LEGACY_DESI'
      ELSE packaging_type
    END
WHERE rule_scope='DESI';

ALTER TABLE packaging_rules
  DROP CONSTRAINT IF EXISTS ck_packaging_rules_scope;
ALTER TABLE packaging_rules
  ADD CONSTRAINT ck_packaging_rules_scope CHECK(
    rule_scope IN('DESI','BARCODE','PRODUCT_NAME','CATEGORY','BRAND')
  );

CREATE INDEX IF NOT EXISTS packaging_rules_match_idx
  ON packaging_rules(marketplace,active,rule_scope,priority DESC);
CREATE UNIQUE INDEX IF NOT EXISTS packaging_rules_named_match_uidx
  ON packaging_rules(marketplace,rule_scope,match_value,profile_name)
  WHERE rule_scope<>'DESI';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS packaging_rule_id BIGINT,
  ADD COLUMN IF NOT EXISTS packaging_profile_name TEXT,
  ADD COLUMN IF NOT EXISTS packaging_rule_source TEXT;

INSERT INTO packaging_rules(
  marketplace,min_desi,max_desi,packaging_cost,note,profile_name,
  packaging_type,rule_scope,match_value,priority,active,updated_at
) VALUES
  ('TRENDYOL',0,999,10,'Manuel barkod istisnası','Standart korumalı ambalaj',
   'STANDARD', 'BARCODE','8695636269586',1000,TRUE,NOW()),
  ('TRENDYOL',0,999,27.50,'Koli ve balonlu koruma','Yumuşatıcı koli + balon',
   'BOX_BUBBLE','PRODUCT_NAME','YUMUŞATICI',500,TRUE,NOW()),
  ('TRENDYOL',0,999,3,'Küçük ve dayanıklı ürün kargo poşeti','Çikolata kargo poşeti',
   'MAILER','PRODUCT_NAME','ÇİKOLATA',400,TRUE,NOW()),
  ('TRENDYOL',0,999,3,'Küçük ve dayanıklı ürün kargo poşeti','Kolonya kargo poşeti',
   'MAILER','PRODUCT_NAME','KOLONYA',400,TRUE,NOW())
ON CONFLICT DO NOTHING;
