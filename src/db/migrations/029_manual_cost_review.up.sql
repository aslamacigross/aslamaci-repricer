ALTER TABLE cost_items
  ADD COLUMN IF NOT EXISTS manual_review_interval_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS manual_review_last_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_review_next_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_review_status TEXT NOT NULL DEFAULT 'OK',
  ADD COLUMN IF NOT EXISTS manual_review_note TEXT;

CREATE INDEX IF NOT EXISTS cost_items_manual_review_due_idx
  ON cost_items(manual_review_next_due_at)
  WHERE COALESCE(price_source,'MANUAL') IN ('MANUAL','OTHER') OR source_checked_at IS NULL;
