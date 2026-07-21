ALTER TABLE mapping_suggestions
  ADD COLUMN IF NOT EXISTS learning_key TEXT;
ALTER TABLE mapping_suggestions
  ADD COLUMN IF NOT EXISTS base_confidence NUMERIC(6,5);
ALTER TABLE mapping_suggestions
  ADD COLUMN IF NOT EXISTS learning_adjustment NUMERIC(7,5) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mapping_learning_profiles (
  learning_key TEXT PRIMARY KEY,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  sample_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_decision TEXT,
  last_decision_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mapping_feedback_events (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id BIGINT UNIQUE REFERENCES mapping_suggestions(id) ON DELETE SET NULL,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  learning_key TEXT NOT NULL,
  decision TEXT NOT NULL,
  actor TEXT NOT NULL,
  base_confidence NUMERIC(6,5),
  confidence NUMERIC(6,5) NOT NULL,
  confidence_band TEXT NOT NULL,
  learning_adjustment NUMERIC(7,5) NOT NULL DEFAULT 0,
  source_type TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mapping_feedback_events_barcode_idx
  ON mapping_feedback_events(marketplace, barcode, created_at DESC);
CREATE INDEX IF NOT EXISTS mapping_feedback_events_learning_idx
  ON mapping_feedback_events(learning_key, created_at DESC);
CREATE INDEX IF NOT EXISTS mapping_feedback_events_decision_idx
  ON mapping_feedback_events(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS mapping_suggestions_learning_idx
  ON mapping_suggestions(learning_key, created_at DESC);
