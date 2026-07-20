ALTER TABLE marketplace_financial_transactions
  ADD COLUMN IF NOT EXISTS order_date TIMESTAMPTZ;

ALTER TABLE marketplace_financial_transactions
  ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE INDEX IF NOT EXISTS marketplace_financial_order_period_idx
  ON marketplace_financial_transactions(marketplace,order_date DESC);

CREATE INDEX IF NOT EXISTS marketplace_financial_barcode_idx
  ON marketplace_financial_transactions(marketplace,barcode,order_date DESC);

INSERT INTO system_settings(key,value,description) VALUES
  ('trendyol_finance_history_start','"2025-12-15"',
   'Trendyol finans geçmişinin işletme başlangıç tarihi')
ON CONFLICT(key) DO NOTHING;

INSERT INTO jobs(
  name,description,schedule_minutes,enabled,schedule_type,daily_at,
  schedule_timezone
) VALUES (
  'backfill-trendyol-finance-history',
  '15 Aralık 2025 tarihinden itibaren erişilebilir Trendyol finans geçmişini tamamlar',
  1440,FALSE,'INTERVAL',NULL,'Europe/Istanbul'
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  updated_at=NOW();
