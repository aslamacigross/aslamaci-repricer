ALTER TABLE cost_items
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE cost_items
  ADD CONSTRAINT cost_items_lifecycle_status_check
  CHECK(lifecycle_status IN('ACTIVE','ARCHIVED'));

CREATE INDEX IF NOT EXISTS cost_items_lifecycle_status_idx
  ON cost_items(lifecycle_status,updated_at DESC);

ALTER TABLE cost_integrity_operations
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS operation_payload JSONB,
  ADD COLUMN IF NOT EXISTS reverses_operation_id BIGINT
    REFERENCES cost_integrity_operations(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS cost_integrity_operations_idempotency_uidx
  ON cost_integrity_operations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS cost_integrity_operations_reverses_idx
  ON cost_integrity_operations(reverses_operation_id)
  WHERE reverses_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cost_integrity_quarantine (
  id BIGSERIAL PRIMARY KEY,
  operation_id BIGINT NOT NULL
    REFERENCES cost_integrity_operations(id) ON DELETE RESTRICT,
  source_table TEXT NOT NULL,
  source_row_id BIGINT NOT NULL,
  row_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUARANTINED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  restored_by TEXT,
  restore_reason TEXT,
  CONSTRAINT cost_integrity_quarantine_source_check
    CHECK(source_table IN('PRODUCT_COST_MAPPINGS','COST_ITEM_FILE_LINKS')),
  CONSTRAINT cost_integrity_quarantine_status_check
    CHECK(status IN('QUARANTINED','RESTORED')),
  CONSTRAINT cost_integrity_quarantine_restore_check
    CHECK(
      status<>'RESTORED' OR (
        restored_at IS NOT NULL AND restored_by IS NOT NULL
        AND restore_reason IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_integrity_quarantine_active_uidx
  ON cost_integrity_quarantine(source_table,source_row_id)
  WHERE status='QUARANTINED';

CREATE INDEX IF NOT EXISTS cost_integrity_quarantine_operation_idx
  ON cost_integrity_quarantine(operation_id,status);
