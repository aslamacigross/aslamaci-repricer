DROP TABLE IF EXISTS cost_integrity_quarantine;

DROP INDEX IF EXISTS cost_integrity_operations_reverses_idx;
DROP INDEX IF EXISTS cost_integrity_operations_idempotency_uidx;

ALTER TABLE cost_integrity_operations
  DROP CONSTRAINT IF EXISTS cost_integrity_operations_reverses_operation_id_fk,
  DROP COLUMN IF EXISTS reverses_operation_id,
  DROP COLUMN IF EXISTS operation_payload,
  DROP COLUMN IF EXISTS preview_fingerprint,
  DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS cost_items_lifecycle_status_idx;

ALTER TABLE cost_items
  DROP CONSTRAINT IF EXISTS cost_items_lifecycle_status_check,
  DROP COLUMN IF EXISTS archive_reason,
  DROP COLUMN IF EXISTS archived_by,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS lifecycle_status;
