CREATE TABLE IF NOT EXISTS ai_content_drafts (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE CASCADE,
  listing_id BIGINT REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  publication_draft_id BIGINT REFERENCES product_publication_drafts(id) ON DELETE SET NULL,
  workflow_status TEXT NOT NULL DEFAULT 'AI_DRAFT',
  provider_mode TEXT NOT NULL DEFAULT 'MOCK_DRAFT',
  source_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  diff_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_content_workflow_check CHECK (
    workflow_status IN (
      'AI_DRAFT','HUMAN_REVIEW','APPROVED','MARKETPLACE_SUBMITTED',
      'VERIFIED','REJECTED'
    )
  ),
  CONSTRAINT ai_content_provider_mode_check CHECK (
    provider_mode IN ('MOCK_DRAFT','EXTERNAL_AI')
  )
);
CREATE INDEX IF NOT EXISTS ai_content_drafts_marketplace_status_idx
  ON ai_content_drafts(marketplace,workflow_status,updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_content_drafts_recipe_idx
  ON ai_content_drafts(recipe_id,marketplace);

CREATE TABLE IF NOT EXISTS listing_content_snapshots (
  id BIGSERIAL PRIMARY KEY,
  content_draft_id BIGINT NOT NULL REFERENCES ai_content_drafts(id) ON DELETE CASCADE,
  listing_id BIGINT REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  snapshot_type TEXT NOT NULL,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_checksum TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listing_content_snapshot_type_check CHECK (
    snapshot_type IN ('CURRENT','PROPOSED','APPROVED','ROLLBACK_PREVIEW')
  )
);
CREATE INDEX IF NOT EXISTS listing_content_snapshots_draft_idx
  ON listing_content_snapshots(content_draft_id,created_at DESC);

CREATE TABLE IF NOT EXISTS listing_health_assessments (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  listing_id BIGINT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE CASCADE,
  quality_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  checks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id),
  CONSTRAINT listing_health_score_check CHECK (quality_score >= 0 AND quality_score <= 100),
  CONSTRAINT listing_health_confidence_check CHECK (
    confidence IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')
  )
);
CREATE INDEX IF NOT EXISTS listing_health_marketplace_score_idx
  ON listing_health_assessments(marketplace,quality_score,assessed_at DESC);

INSERT INTO jobs(name,description,schedule_minutes,enabled)
VALUES
  ('listing-health-scan','Listing içerik ve operasyon kalitesini açıklanabilir kontrollerle tarar',1440,FALSE),
  ('content-quality-scan','İçerik taslaklarını kaynak gerçekleri ve güvenlik kurallarıyla doğrular',1440,FALSE)
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,updated_at=NOW();
