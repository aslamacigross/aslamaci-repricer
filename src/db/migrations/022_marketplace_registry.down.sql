DELETE FROM system_settings
WHERE key IN(
  'product_publishing_enabled',
  'content_auto_update_enabled',
  'opportunity_auto_publish_enabled'
);

DROP TABLE IF EXISTS marketplace_registry;

