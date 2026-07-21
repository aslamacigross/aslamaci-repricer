DELETE FROM jobs
WHERE name IN ('sheets-import', 'sheets-export');

DELETE FROM system_settings
WHERE key IN ('google_sheets_sync_enabled', 'sheets_sync_cron_minutes');
