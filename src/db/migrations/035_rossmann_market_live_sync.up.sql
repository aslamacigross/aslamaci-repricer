INSERT INTO jobs(
  name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone
) VALUES(
  'sync-rossmann-market-prices',
  'Rossmann public elastic kataloğundan Rossmann Card fiyat öncelikli maliyet havuzunu yeniler',
  1440,
  FALSE,
  'DAILY',
  '00:00',
  'Europe/Istanbul'
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=COALESCE(jobs.schedule_minutes, EXCLUDED.schedule_minutes),
  schedule_type=EXCLUDED.schedule_type,
  daily_at=EXCLUDED.daily_at,
  schedule_timezone=EXCLUDED.schedule_timezone,
  updated_at=NOW();
