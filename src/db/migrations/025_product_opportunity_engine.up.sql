CREATE TABLE IF NOT EXISTS product_opportunities (
  id BIGSERIAL PRIMARY KEY,
  opportunity_key TEXT UNIQUE NOT NULL,
  opportunity_type TEXT NOT NULL,
  target_marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  source_marketplace TEXT REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  recipe_id BIGINT REFERENCES pim_recipes(id) ON DELETE SET NULL,
  proposed_recipe JSONB NOT NULL DEFAULT '{}'::jsonb,
  bundle_fingerprint TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'GENERATED',
  score NUMERIC(6,2) NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  signal_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  economics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  catalog_status TEXT NOT NULL DEFAULT 'NOT_SEARCHED',
  listing_barcode_required BOOLEAN NOT NULL DEFAULT FALSE,
  data_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_opportunity_type_check CHECK (
    opportunity_type IN (
      'MISSING_SINGLE','MISSING_MARKETPLACE','MISSING_PACK_SIZE','MIXED_BUNDLE',
      'PROFITABLE_BUYBOX_GAP','LOW_COMPETITION_GAP','HIGH_MARGIN_VARIANT'
    )
  ),
  CONSTRAINT product_opportunity_workflow_check CHECK (
    workflow_status IN (
      'GENERATED','REVIEWED','RECIPE_APPROVED','CATALOG_SEARCHED',
      'CATALOG_MATCH_REVIEW','CONTENT_READY','LISTING_READY','PUBLISH_APPROVED',
      'SUBMITTED','PUBLISHED','REJECTED','FAILED'
    )
  ),
  CONSTRAINT product_opportunity_confidence_check CHECK (
    confidence IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')
  ),
  CONSTRAINT product_opportunity_score_check CHECK (score >= 0 AND score <= 100)
);
CREATE INDEX IF NOT EXISTS product_opportunities_marketplace_status_idx
  ON product_opportunities(target_marketplace,workflow_status,score DESC);
CREATE INDEX IF NOT EXISTS product_opportunities_recipe_idx
  ON product_opportunities(recipe_id,target_marketplace);

CREATE TABLE IF NOT EXISTS product_opportunity_events (
  id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT NOT NULL REFERENCES product_opportunities(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT,
  reason TEXT,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS product_opportunity_events_opportunity_idx
  ON product_opportunity_events(opportunity_id,created_at DESC);

INSERT INTO jobs(name,description,schedule_minutes,enabled)
VALUES('opportunity-generation','PIM ve pazar verilerinden açıklanabilir ürün fırsatları üretir',1440,FALSE)
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,updated_at=NOW();
