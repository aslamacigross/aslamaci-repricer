ALTER TABLE products
  ADD COLUMN IF NOT EXISTS buybox_seller TEXT,
  ADD COLUMN IF NOT EXISTS second_seller TEXT,
  ADD COLUMN IF NOT EXISTS third_seller TEXT,
  ADD COLUMN IF NOT EXISTS seller_count INTEGER,
  ADD COLUMN IF NOT EXISTS buybox_source TEXT,
  ADD COLUMN IF NOT EXISTS buybox_error_code TEXT;

ALTER TABLE buybox_history
  ADD COLUMN IF NOT EXISTS buybox_seller TEXT,
  ADD COLUMN IF NOT EXISTS second_seller TEXT,
  ADD COLUMN IF NOT EXISTS third_seller TEXT,
  ADD COLUMN IF NOT EXISTS seller_count INTEGER,
  ADD COLUMN IF NOT EXISTS buybox_source TEXT;

INSERT INTO jobs(name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone)
VALUES(
  'sync-hepsiburada-buybox',
  'Hepsiburada public ürün sayfalarından read-only buybox ve ilk görünür teklifleri toplar',
  60,
  FALSE,
  'INTERVAL',
  NULL,
  'Europe/Istanbul'
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=EXCLUDED.schedule_minutes,
  schedule_type=EXCLUDED.schedule_type,
  schedule_timezone=EXCLUDED.schedule_timezone,
  updated_at=NOW();
