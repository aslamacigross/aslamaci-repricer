INSERT INTO jobs(name, description, schedule_minutes, enabled)
VALUES(
  'sync-bim-market-prices',
  'Yemeksepeti BİM kataloğundan dondurulmuş gıda hariç maliyet havuzunu yeniler',
  1440,
  FALSE
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=COALESCE(jobs.schedule_minutes, EXCLUDED.schedule_minutes),
  updated_at=NOW();
