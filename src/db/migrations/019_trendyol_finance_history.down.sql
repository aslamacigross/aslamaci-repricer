DELETE FROM jobs WHERE name='backfill-trendyol-finance-history';

DELETE FROM system_settings WHERE key IN(
  'trendyol_finance_history_start',
  'trendyol_finance_history_backfill'
);

DROP INDEX IF EXISTS marketplace_financial_barcode_idx;
DROP INDEX IF EXISTS marketplace_financial_order_period_idx;

ALTER TABLE marketplace_financial_transactions
  DROP COLUMN IF EXISTS barcode;

ALTER TABLE marketplace_financial_transactions
  DROP COLUMN IF EXISTS order_date;
