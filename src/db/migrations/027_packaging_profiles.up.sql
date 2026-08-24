ALTER TABLE packaging_rules
  ADD COLUMN IF NOT EXISTS profile_name TEXT,
  ADD COLUMN IF NOT EXISTS packaging_type TEXT,
  ADD COLUMN IF NOT EXISTS rule_scope TEXT NOT NULL DEFAULT 'DESI',
  ADD COLUMN IF NOT EXISTS match_value TEXT,
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

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
