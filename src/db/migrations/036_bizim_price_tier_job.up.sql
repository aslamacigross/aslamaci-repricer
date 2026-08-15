INSERT INTO jobs(
  name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone
) VALUES(
  'sync-bizim-price-tiers',
  'Bizim Toptan available ürün detaylarından quantity price tier doğrulamasını rate-limit dostu yeniler',
  1440,
  TRUE,
  'DAILY',
  '01:30',
  'Europe/Istanbul'
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=COALESCE(jobs.schedule_minutes, EXCLUDED.schedule_minutes),
  schedule_type=EXCLUDED.schedule_type,
  daily_at=EXCLUDED.daily_at,
  schedule_timezone=EXCLUDED.schedule_timezone,
  updated_at=NOW();
