DROP INDEX IF EXISTS cost_items_manual_review_due_idx;

ALTER TABLE cost_items
  DROP COLUMN IF EXISTS manual_review_note,
  DROP COLUMN IF EXISTS manual_review_status,
  DROP COLUMN IF EXISTS manual_review_next_due_at,
  DROP COLUMN IF EXISTS manual_review_last_confirmed_at,
  DROP COLUMN IF EXISTS manual_review_interval_days;
