DELETE FROM jobs WHERE name='dashboard-cache-refresh';
DELETE FROM repricer_actions
WHERE source='LEGACY' AND idempotency_key LIKE 'legacy-price-war:%';
DELETE FROM system_settings WHERE key IN(
  'default_max_increase_tl',
  'buybox_max_age_minutes',
  'product_sync_cron_minutes',
  'buybox_sync_cron_minutes',
  'cost_calculation_cron_minutes',
  'repricer_cron_minutes',
  'sheets_sync_cron_minutes',
  'log_retention_days'
);

DROP TABLE IF EXISTS dashboard_cache;
DROP TABLE IF EXISTS repricer_results;
DROP TABLE IF EXISTS price_change_outcomes;
DROP TABLE IF EXISTS buybox_history;

ALTER TABLE repricer_outcomes DROP COLUMN IF EXISTS profit_after;
ALTER TABLE repricer_outcomes DROP COLUMN IF EXISTS target_achieved;
ALTER TABLE repricer_outcomes DROP COLUMN IF EXISTS target_rank;

ALTER TABLE repricer_actions DROP COLUMN IF EXISTS elapsed_minutes;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS buybox_lost;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS buybox_won;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS checked_at;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS buybox_after;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS rank_after;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS target_rank;
DROP INDEX IF EXISTS repricer_actions_reverts_idx;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS reverted_at;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS reverted_by_action_id;
ALTER TABLE repricer_actions DROP COLUMN IF EXISTS reverts_action_id;

ALTER TABLE repricer_learning DROP COLUMN IF EXISTS learned_max_increase_tl;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_note;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_action;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_required_gap_tl;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_second_price;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_buybox_price;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_my_price;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_rank;
ALTER TABLE repricer_learning DROP COLUMN IF EXISTS last_outcome;
