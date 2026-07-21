INSERT INTO system_settings(key, value, description)
VALUES
  ('google_sheets_sync_enabled', 'false', 'Sheets gecis donemi senkronizasyonu'),
  ('sheets_sync_cron_minutes', '1440', 'Google Sheets import sikligi')
ON CONFLICT (key) DO NOTHING;

INSERT INTO jobs(name, description, schedule_minutes, enabled)
VALUES
  ('sheets-import', 'Sheets verilerini transaction ile alir', 1440, FALSE),
  ('sheets-export', 'PostgreSQL ozetini Sheets e aktarir', 60, FALSE)
ON CONFLICT (name) DO NOTHING;
