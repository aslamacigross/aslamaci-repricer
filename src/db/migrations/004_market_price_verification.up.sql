ALTER TABLE product_settings
  ADD COLUMN IF NOT EXISTS max_single_change_pct NUMERIC(8,3);

UPDATE product_settings
SET max_single_change_pct = COALESCE(max_single_change_pct, max_daily_change_pct, 15)
WHERE max_single_change_pct IS NULL;

ALTER TABLE product_settings
  ALTER COLUMN max_single_change_pct SET DEFAULT 15;

ALTER TABLE repricer_actions
  ADD COLUMN IF NOT EXISTS market_price_before NUMERIC(14,2);
ALTER TABLE repricer_actions
  ADD COLUMN IF NOT EXISTS market_price_checked_at TIMESTAMPTZ;
ALTER TABLE repricer_actions
  ADD COLUMN IF NOT EXISTS batch_checked_at TIMESTAMPTZ;
ALTER TABLE repricer_actions
  ADD COLUMN IF NOT EXISTS verification_error TEXT;

CREATE INDEX IF NOT EXISTS repricer_actions_verification_idx
  ON repricer_actions(status, sent_at)
  WHERE status='AWAITING_RESULT' AND verified_at IS NULL;
