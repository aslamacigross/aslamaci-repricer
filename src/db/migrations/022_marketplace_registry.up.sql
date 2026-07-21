CREATE TABLE IF NOT EXISTS marketplace_registry (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  adapter_status TEXT NOT NULL DEFAULT 'SKELETON',
  credentials_status TEXT NOT NULL DEFAULT 'MISSING',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_carrier TEXT,
  default_service_fee_minor BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY',
  locale TEXT NOT NULL DEFAULT 'tr-TR',
  timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  last_category_sync_at TIMESTAMPTZ,
  last_attribute_sync_at TIMESTAMPTZ,
  last_brand_sync_at TIMESTAMPTZ,
  last_product_sync_at TIMESTAMPTZ,
  last_buybox_sync_at TIMESTAMPTZ,
  last_finance_sync_at TIMESTAMPTZ,
  last_connection_test_at TIMESTAMPTZ,
  last_successful_connection_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketplace_registry_adapter_status_check CHECK (
    adapter_status IN ('READY','WAITING_CREDENTIALS','DISABLED','SKELETON')
  ),
  CONSTRAINT marketplace_registry_credentials_status_check CHECK (
    credentials_status IN ('CONFIGURED','MISSING')
  ),
  CONSTRAINT marketplace_registry_service_fee_check CHECK (
    default_service_fee_minor >= 0
  )
);

INSERT INTO marketplace_registry(
  code,display_name,sort_order,enabled,adapter_status,capabilities,
  default_carrier,default_service_fee_minor
) VALUES
  (
    'TRENDYOL','Trendyol',10,TRUE,'READY',
    '{"supportsCatalogSearch":false,"supportsCatalogProductRead":true,"supportsExistingCatalogOfferCreate":false,"supportsNewProductCreate":false,"supportsCategorySync":false,"supportsAttributeSync":false,"supportsBrandSync":false,"supportsCommissionApi":true,"supportsBuybox":true,"supportsContentUpdate":false,"supportsImageUpdate":false,"supportsVideo":false,"supportsOrders":true,"supportsFinancialTransactions":true,"supportsPriceUpdate":true,"supportsInventoryUpdate":true,"supportsBatchStatus":true,"supportsListingVerification":true}',
    'TEX',1319
  ),
  (
    'HEPSIBURADA','Hepsiburada',20,TRUE,'WAITING_CREDENTIALS',
    '{"supportsCatalogSearch":false,"supportsCatalogProductRead":false,"supportsExistingCatalogOfferCreate":false,"supportsNewProductCreate":false,"supportsCategorySync":false,"supportsAttributeSync":false,"supportsBrandSync":false,"supportsCommissionApi":false,"supportsBuybox":false,"supportsContentUpdate":false,"supportsImageUpdate":false,"supportsVideo":false,"supportsOrders":true,"supportsFinancialTransactions":false,"supportsPriceUpdate":false,"supportsInventoryUpdate":false,"supportsBatchStatus":false,"supportsListingVerification":false}',
    'hepsiJET',1050
  ),
  ('PAZARAMA','Pazarama',30,FALSE,'SKELETON','{}','',0),
  ('IDEFIX','İdefix',40,FALSE,'SKELETON','{}','',0),
  ('N11','N11',50,FALSE,'SKELETON','{}','',0),
  ('PTTAVM','PTTAVM',60,FALSE,'SKELETON','{}','',0)
ON CONFLICT(code) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  sort_order=EXCLUDED.sort_order,
  capabilities=EXCLUDED.capabilities,
  default_carrier=EXCLUDED.default_carrier,
  default_service_fee_minor=EXCLUDED.default_service_fee_minor,
  updated_at=NOW();

INSERT INTO system_settings(key,value,description) VALUES
  ('product_publishing_enabled','false','Ürün yayınlama mutasyon anahtarı; varsayılan kapalı'),
  ('content_auto_update_enabled','false','İçerik otomatik güncelleme anahtarı; varsayılan kapalı'),
  ('opportunity_auto_publish_enabled','false','Fırsat otomatik yayın sözleşmesi; fiilen kapalı')
ON CONFLICT(key) DO NOTHING;

