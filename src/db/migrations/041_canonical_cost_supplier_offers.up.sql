CREATE TABLE IF NOT EXISTS cost_item_supplier_offers (
  id BIGSERIAL PRIMARY KEY,
  cost_item_id BIGINT NOT NULL REFERENCES cost_items(id) ON DELETE RESTRICT,
  supplier_offer_id BIGINT NOT NULL REFERENCES file_market_items(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'CANDIDATE',
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  selected_by TEXT,
  selected_at TIMESTAMPTZ,
  selection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_item_supplier_offers_identity_uidx
    UNIQUE(cost_item_id,supplier_offer_id),
  CONSTRAINT cost_item_supplier_offers_status_check
    CHECK(status IN('CANDIDATE','APPROVED','REJECTED','ARCHIVED','REPLACED')),
  CONSTRAINT cost_item_supplier_offers_approval_check
    CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT cost_item_supplier_offers_selected_check
    CHECK(
      is_selected=FALSE OR (
        status='APPROVED' AND selected_by IS NOT NULL
        AND selected_at IS NOT NULL AND selection_reason IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_item_supplier_offers_selected_uidx
  ON cost_item_supplier_offers(cost_item_id)
  WHERE is_selected=TRUE AND status='APPROVED';

CREATE UNIQUE INDEX IF NOT EXISTS cost_item_supplier_offers_approved_owner_uidx
  ON cost_item_supplier_offers(supplier_offer_id)
  WHERE status='APPROVED';

CREATE INDEX IF NOT EXISTS cost_item_supplier_offers_item_idx
  ON cost_item_supplier_offers(cost_item_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS cost_item_supplier_offers_supplier_idx
  ON cost_item_supplier_offers(supplier_offer_id,status);

ALTER TABLE product_cost_mappings
  ADD CONSTRAINT product_cost_mappings_cost_item_code_fk
  FOREIGN KEY(cost_item_code) REFERENCES cost_items(item_code)
  ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;

ALTER TABLE cost_item_file_links
  ADD CONSTRAINT cost_item_file_links_cost_item_code_fk
  FOREIGN KEY(cost_item_code) REFERENCES cost_items(item_code)
  ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
