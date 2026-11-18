-- DRAFT ONLY. Not discovered by the migration runner. Number/rollout needs review.
-- Persist proof + both economic views without overloading human notes/source data.
ALTER TABLE products ADD COLUMN IF NOT EXISTS hb_cash_economics JSONB;
-- No status, source-selection, rate, policy, price or stock changes.
