ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_name_source TEXT,
  ADD COLUMN IF NOT EXISTS brand_source TEXT,
  ADD COLUMN IF NOT EXISTS category_name_source TEXT,
  ADD COLUMN IF NOT EXISTS product_image_source TEXT,
  ADD COLUMN IF NOT EXISTS metadata_refreshed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS hepsiburada_seller_portal_imports (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_active_in_excel INTEGER NOT NULL DEFAULT 0,
  rows_closed_in_excel INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  identity_mismatch INTEGER NOT NULL DEFAULT 0,
  excel_only INTEGER NOT NULL DEFAULT 0,
  active_not_in_excel INTEGER NOT NULL DEFAULT 0,
  valid_gtin_accepted INTEGER NOT NULL DEFAULT 0,
  invalid_gtin INTEGER NOT NULL DEFAULT 0,
  ambiguous_gtin INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_hb_seller_portal_imports_imported_at
  ON hepsiburada_seller_portal_imports(imported_at DESC);

CREATE TABLE IF NOT EXISTS hepsiburada_seller_portal_metadata (
  hb_sku TEXT PRIMARY KEY,
  merchant_sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category_name TEXT NOT NULL,
  root_category_name TEXT,
  main_category_name TEXT,
  raw_barcode TEXT,
  catalog_gtin TEXT,
  catalog_gtin_status TEXT NOT NULL DEFAULT 'NOT_PROVIDED',
  listing_status TEXT,
  import_id BIGINT REFERENCES hepsiburada_seller_portal_imports(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_seller_portal_metadata_merchant_sku
  ON hepsiburada_seller_portal_metadata(merchant_sku);
