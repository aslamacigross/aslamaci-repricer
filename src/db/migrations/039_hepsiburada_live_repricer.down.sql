DELETE FROM jobs
WHERE name IN(
  'run-auto-hepsiburada-repricer',
  'check-hepsiburada-action-outcomes-5m',
  'check-hepsiburada-action-outcomes-15m',
  'check-hepsiburada-action-outcomes-60m'
);
