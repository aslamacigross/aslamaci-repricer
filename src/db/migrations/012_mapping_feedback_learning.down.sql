DROP INDEX IF EXISTS mapping_suggestions_learning_idx;
DROP INDEX IF EXISTS mapping_feedback_events_decision_idx;
DROP INDEX IF EXISTS mapping_feedback_events_learning_idx;
DROP INDEX IF EXISTS mapping_feedback_events_barcode_idx;
DROP TABLE IF EXISTS mapping_feedback_events;
DROP TABLE IF EXISTS mapping_learning_profiles;
ALTER TABLE mapping_suggestions DROP COLUMN IF EXISTS learning_adjustment;
ALTER TABLE mapping_suggestions DROP COLUMN IF EXISTS base_confidence;
ALTER TABLE mapping_suggestions DROP COLUMN IF EXISTS learning_key;
