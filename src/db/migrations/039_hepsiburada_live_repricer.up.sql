INSERT INTO jobs(
  name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone
)
VALUES
  (
    'run-auto-hepsiburada-repricer',
    'Hepsiburada otomatik repricer aksiyonlarını ayrı executor ile uygular',
    10,
    FALSE,
    'INTERVAL',
    NULL,
    'Europe/Istanbul'
  ),
  (
    'check-hepsiburada-action-outcomes-5m',
    'Hepsiburada fiyat aksiyonu sonucunu 5 dakikada ölçer',
    5,
    FALSE,
    'INTERVAL',
    NULL,
    'Europe/Istanbul'
  ),
  (
    'check-hepsiburada-action-outcomes-15m',
    'Hepsiburada fiyat aksiyonu sonucunu 15 dakikada ölçer',
    15,
    FALSE,
    'INTERVAL',
    NULL,
    'Europe/Istanbul'
  ),
  (
    'check-hepsiburada-action-outcomes-60m',
    'Hepsiburada fiyat aksiyonu sonucunu 60 dakikada ölçer',
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
