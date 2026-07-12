ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS target_rank INTEGER;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS rank_after INTEGER;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS buybox_after NUMERIC(14,2);
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS buybox_won BOOLEAN;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS buybox_lost BOOLEAN;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS elapsed_minutes INTEGER;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS reverts_action_id BIGINT REFERENCES repricer_actions(id) ON DELETE SET NULL;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS reverted_by_action_id BIGINT REFERENCES repricer_actions(id) ON DELETE SET NULL;
ALTER TABLE repricer_actions ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS repricer_actions_reverts_idx
  ON repricer_actions(reverts_action_id)
  WHERE reverts_action_id IS NOT NULL;

ALTER TABLE repricer_outcomes ADD COLUMN IF NOT EXISTS target_rank INTEGER;
ALTER TABLE repricer_outcomes ADD COLUMN IF NOT EXISTS target_achieved BOOLEAN;
ALTER TABLE repricer_outcomes ADD COLUMN IF NOT EXISTS profit_after NUMERIC(14,2);

ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS learned_max_increase_tl NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_outcome TEXT;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_rank INTEGER;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_my_price NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_buybox_price NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_second_price NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_required_gap_tl NUMERIC(14,2);
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_action TEXT;
ALTER TABLE repricer_learning ADD COLUMN IF NOT EXISTS last_note TEXT;

CREATE TABLE IF NOT EXISTS buybox_history (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  product_name TEXT,
  observed_price NUMERIC(14,2),
  buybox_price NUMERIC(14,2),
  second_price NUMERIC(14,2),
  third_price NUMERIC(14,2),
  rank INTEGER,
  has_multiple_seller BOOLEAN,
  min_price NUMERIC(14,2),
  net_profit NUMERIC(14,2),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace, barcode, observed_at)
);
CREATE INDEX IF NOT EXISTS buybox_history_barcode_idx
  ON buybox_history(marketplace, barcode, observed_at DESC);

CREATE TABLE IF NOT EXISTS price_change_outcomes (
  id BIGSERIAL PRIMARY KEY,
  action_id BIGINT NOT NULL REFERENCES repricer_actions(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  old_price NUMERIC(14,2),
  proposed_price NUMERIC(14,2),
  applied_price NUMERIC(14,2),
  buybox_before NUMERIC(14,2),
  buybox_after NUMERIC(14,2),
  rank_before INTEGER,
  rank_after INTEGER,
  target_rank INTEGER,
  target_achieved BOOLEAN,
  buybox_won BOOLEAN,
  buybox_lost BOOLEAN,
  net_profit_before NUMERIC(14,2),
  net_profit_after NUMERIC(14,2),
  expected_net_profit_after NUMERIC(14,2),
  elapsed_minutes INTEGER NOT NULL,
  result TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(action_id, elapsed_minutes)
);
CREATE INDEX IF NOT EXISTS price_change_outcomes_barcode_idx
  ON price_change_outcomes(marketplace, barcode, checked_at DESC);

CREATE TABLE IF NOT EXISTS repricer_results (
  id BIGSERIAL PRIMARY KEY,
  action_id BIGINT NOT NULL UNIQUE REFERENCES repricer_actions(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  barcode TEXT NOT NULL,
  applied_price NUMERIC(14,2),
  buybox_before NUMERIC(14,2),
  buybox_after NUMERIC(14,2),
  rank_before INTEGER,
  rank_after INTEGER,
  target_rank INTEGER,
  target_achieved BOOLEAN,
  buybox_won BOOLEAN,
  buybox_lost BOOLEAN,
  result TEXT,
  elapsed_minutes INTEGER,
  checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS repricer_results_barcode_idx
  ON repricer_results(marketplace, barcode, updated_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS competitor_observations_barcode_idx
  ON competitor_price_observations(marketplace, barcode, observed_at DESC);

INSERT INTO system_settings(key, value, description) VALUES
  ('default_max_increase_tl', '10', 'Varsayilan maksimum artis TL'),
  ('buybox_max_age_minutes', '20', 'Buybox verisinin izin verilen maksimum yasi'),
  ('product_sync_cron_minutes', '360', 'Urun senkronizasyon sikligi'),
  ('buybox_sync_cron_minutes', '10', 'Buybox senkronizasyon sikligi'),
  ('cost_calculation_cron_minutes', '30', 'Maliyet hesaplama sikligi'),
  ('repricer_cron_minutes', '10', 'Repricer karar sikligi'),
  ('sheets_sync_cron_minutes', '1440', 'Google Sheets import sikligi'),
  ('log_retention_days', '90', 'Log saklama suresi')
ON CONFLICT (key) DO NOTHING;

INSERT INTO jobs(name, description, schedule_minutes, enabled) VALUES
  ('dashboard-cache-refresh', 'Dashboard ozetini onbellege alir', 5, TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO repricer_actions(
  marketplace,barcode,product_name,old_price,proposed_price,applied_price,
  action,strategy,reason,status,source,idempotency_key,min_price,
  buybox_before,rank_before,second_price,third_price,target_rank,sent_at,
  verified_at,created_at,updated_at
)
SELECT marketplace,barcode,product_name,old_price,new_price,new_price,
       COALESCE(action,'LEGACY_PRICE_CHANGE'),'Legacy Pilot',
       'V1 price_war_log kaydindan korundu','SUCCESS','LEGACY',
       'legacy-price-war:' || id::text,min_price,buybox_price,rank,
       second_price,third_price,rank,created_at,created_at,created_at,created_at
FROM price_war_log
WHERE barcode IS NOT NULL AND old_price>0 AND new_price>0
ON CONFLICT (idempotency_key) DO NOTHING;

UPDATE repricer_actions
SET target_rank = COALESCE(target_rank, rank_before, 1)
WHERE target_rank IS NULL;

INSERT INTO buybox_history(
  marketplace, barcode, product_name, observed_price, buybox_price,
  second_price, third_price, rank, has_multiple_seller, min_price,
  net_profit, observed_at
)
SELECT ro.marketplace, ro.barcode, p.product_name, ro.observed_price,
       ro.buybox_price, ro.second_price, ro.third_price, ro.rank,
       ro.has_multiple_seller, p.min_price, p.calculated_net_profit,
       ro.observed_at
FROM repricer_observations ro
LEFT JOIN products p ON p.marketplace=ro.marketplace AND p.barcode=ro.barcode
ON CONFLICT (marketplace, barcode, observed_at) DO NOTHING;

INSERT INTO price_change_outcomes(
  action_id, marketplace, barcode, old_price, proposed_price, applied_price,
  buybox_before, buybox_after, rank_before, rank_after, target_rank,
  target_achieved, buybox_won, buybox_lost, net_profit_before,
  net_profit_after, expected_net_profit_after, elapsed_minutes, result,
  checked_at
)
SELECT ro.action_id, ra.marketplace, ra.barcode, ra.old_price,
       ra.proposed_price, ra.applied_price, ro.buybox_before,
       ro.buybox_after, ro.rank_before, ro.rank_after,
       COALESCE(ro.target_rank, ra.target_rank, ra.rank_before, 1),
       COALESCE(ro.target_achieved,
         ro.rank_after > 0 AND ro.rank_after <= COALESCE(ra.target_rank, ra.rank_before, 1)),
       ro.buybox_won, ro.buybox_lost, ro.profit_before, ro.profit_after,
       ro.expected_profit, ro.elapsed_minutes, ro.outcome, ro.checked_at
FROM repricer_outcomes ro
JOIN repricer_actions ra ON ra.id=ro.action_id
ON CONFLICT (action_id, elapsed_minutes) DO NOTHING;

INSERT INTO repricer_results(
  action_id, marketplace, barcode, applied_price, buybox_before, buybox_after,
  rank_before, rank_after, target_rank, target_achieved, buybox_won,
  buybox_lost, result, elapsed_minutes, checked_at, updated_at
)
SELECT pco.action_id, pco.marketplace, pco.barcode, pco.applied_price,
       pco.buybox_before, pco.buybox_after, pco.rank_before, pco.rank_after,
       pco.target_rank, pco.target_achieved, pco.buybox_won,
       pco.buybox_lost, pco.result, pco.elapsed_minutes, pco.checked_at, NOW()
FROM price_change_outcomes pco
JOIN (
  SELECT action_id,MAX(elapsed_minutes) AS elapsed_minutes
  FROM price_change_outcomes GROUP BY action_id
) latest ON latest.action_id=pco.action_id
  AND latest.elapsed_minutes=pco.elapsed_minutes
ON CONFLICT (action_id) DO NOTHING;
