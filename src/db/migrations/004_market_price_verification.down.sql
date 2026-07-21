DROP INDEX IF EXISTS repricer_actions_verification_idx;

ALTER TABLE repricer_actions DROP COLUMN IF EXISTS verification_error;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS batch_checked_at;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS market_price_checked_at;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS market_price_before;
ALTER TABLE product_settings DROP COLUMN IF EXISTS max_single_change_pct;
