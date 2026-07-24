DELETE FROM jobs
WHERE name IN('sync-hepsiburada-products','generate-hepsiburada-repricer-actions');

UPDATE marketplace_registry
SET capabilities='{"supportsCatalogSearch":false,"supportsCatalogProductRead":false,"supportsExistingCatalogOfferCreate":false,"supportsNewProductCreate":false,"supportsCategorySync":false,"supportsAttributeSync":false,"supportsBrandSync":false,"supportsCommissionApi":false,"supportsBuybox":false,"supportsContentUpdate":false,"supportsImageUpdate":false,"supportsVideo":false,"supportsOrders":true,"supportsFinancialTransactions":false,"supportsPriceUpdate":false,"supportsInventoryUpdate":false,"supportsBatchStatus":false,"supportsListingVerification":false}'::jsonb,
    updated_at=NOW()
WHERE code='HEPSIBURADA';
