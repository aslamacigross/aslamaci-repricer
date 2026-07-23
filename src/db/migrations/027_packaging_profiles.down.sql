DELETE FROM packaging_rules
WHERE marketplace='TRENDYOL' AND rule_scope<>'DESI'
  AND profile_name IN(
    'Standart korumalı ambalaj','Yumuşatıcı koli + balon',
    'Çikolata kargo poşeti','Kolonya kargo poşeti'
  );

ALTER TABLE products DROP COLUMN IF EXISTS packaging_rule_source;
ALTER TABLE products DROP COLUMN IF EXISTS packaging_profile_name;
ALTER TABLE products DROP COLUMN IF EXISTS packaging_rule_id;

DROP INDEX IF EXISTS packaging_rules_named_match_uidx;
DROP INDEX IF EXISTS packaging_rules_match_idx;
ALTER TABLE packaging_rules DROP CONSTRAINT IF EXISTS ck_packaging_rules_scope;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS active;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS priority;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS match_value;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS rule_scope;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS packaging_type;
ALTER TABLE packaging_rules DROP COLUMN IF EXISTS profile_name;
