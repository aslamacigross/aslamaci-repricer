INSERT INTO jobs(name, description, schedule_minutes, enabled)
VALUES(
  'sync-file-market-prices',
  'File Market canlı API üzerinden Harras, Daycare ve Actisoft maliyet havuzunu günceller',
  1440,
  FALSE
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=COALESCE(jobs.schedule_minutes, EXCLUDED.schedule_minutes),
  updated_at=NOW();
