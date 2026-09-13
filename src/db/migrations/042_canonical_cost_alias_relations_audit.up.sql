ALTER TABLE file_market_items
  ADD COLUMN IF NOT EXISTS offer_type TEXT,
  ADD COLUMN IF NOT EXISTS physical_supplier_code TEXT,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;

ALTER TABLE file_market_items
  ADD CONSTRAINT file_market_items_offer_type_check
  CHECK(
    offer_type IS NULL OR offer_type='LIVE' OR (
      offer_type='MANUAL' AND physical_supplier_code IS NOT NULL
      AND checked_at IS NOT NULL
    )
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS cost_item_aliases (
  id BIGSERIAL PRIMARY KEY,
  alias_code TEXT UNIQUE NOT NULL,
  canonical_cost_item_id BIGINT NOT NULL REFERENCES cost_items(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  actor TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_item_aliases_status_check
    CHECK(status IN('ACTIVE','RETIRED'))
);

CREATE INDEX IF NOT EXISTS cost_item_aliases_canonical_idx
  ON cost_item_aliases(canonical_cost_item_id,status);

CREATE TABLE IF NOT EXISTS supplier_offer_relations (
  id BIGSERIAL PRIMARY KEY,
  from_supplier_offer_id BIGINT NOT NULL REFERENCES file_market_items(id) ON DELETE RESTRICT,
  to_supplier_offer_id BIGINT NOT NULL REFERENCES file_market_items(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  reversed_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversal_reason TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_offer_relations_identity_uidx
    UNIQUE(from_supplier_offer_id,to_supplier_offer_id,relation_type),
  CONSTRAINT supplier_offer_relations_distinct_check
    CHECK(from_supplier_offer_id<>to_supplier_offer_id),
  CONSTRAINT supplier_offer_relations_type_check
    CHECK(relation_type IN('REPLACED_BY','ALIAS_OF')),
  CONSTRAINT supplier_offer_relations_status_check
    CHECK(status IN('PENDING','APPROVED','REJECTED','REVERSED')),
  CONSTRAINT supplier_offer_relations_approval_check
    CHECK(status<>'APPROVED' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT supplier_offer_relations_reversal_check
    CHECK(
      status<>'REVERSED' OR (
        reversed_at IS NOT NULL AND reversed_by IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS supplier_offer_relations_from_idx
  ON supplier_offer_relations(from_supplier_offer_id,status);

CREATE INDEX IF NOT EXISTS supplier_offer_relations_to_idx
  ON supplier_offer_relations(to_supplier_offer_id,status);

CREATE TABLE IF NOT EXISTS cost_integrity_operations (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  status TEXT NOT NULL DEFAULT 'APPLIED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  reversed_by TEXT,
  reversal_reason TEXT,
  CONSTRAINT cost_integrity_operations_status_check
    CHECK(status IN('PLANNED','APPLIED','FAILED','REVERSED')),
  CONSTRAINT cost_integrity_operations_reversal_check
    CHECK(
      status<>'REVERSED' OR (
        reversed_at IS NOT NULL AND reversed_by IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS cost_integrity_operations_batch_idx
  ON cost_integrity_operations(batch_id,created_at);

CREATE INDEX IF NOT EXISTS cost_integrity_operations_target_idx
  ON cost_integrity_operations(target_type,target_id,created_at DESC);
