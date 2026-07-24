UPDATE marketplace_registry
SET adapter_status='WAITING_CREDENTIALS',
    capabilities='{"supportsCatalogSearch":false,"supportsCatalogProductRead":true,"supportsExistingCatalogOfferCreate":false,"supportsNewProductCreate":false,"supportsCategorySync":false,"supportsAttributeSync":false,"supportsBrandSync":false,"supportsCommissionApi":false,"supportsBuybox":false,"supportsContentUpdate":false,"supportsImageUpdate":false,"supportsVideo":false,"supportsOrders":true,"supportsFinancialTransactions":false,"supportsPriceUpdate":false,"supportsInventoryUpdate":false,"supportsBatchStatus":false,"supportsListingVerification":false}'::jsonb,
    updated_at=NOW()
WHERE code='HEPSIBURADA';

INSERT INTO jobs(name,description,schedule_minutes,enabled,schedule_type,daily_at,schedule_timezone)
VALUES
  (
    'sync-hepsiburada-products',
    'Hepsiburada listinglerini read-only yeniler ve ürün/mapping hazırlığına taşır',
    360,
    FALSE,
    'INTERVAL',
    NULL,
    'Europe/Istanbul'
  ),
  (
    'generate-hepsiburada-repricer-actions',
    'Hepsiburada için güvenli repricer aksiyon önerileri üretir; fiyat göndermez',
    30,
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
