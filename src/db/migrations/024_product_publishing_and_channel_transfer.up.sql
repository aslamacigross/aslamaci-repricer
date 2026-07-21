CREATE TABLE IF NOT EXISTS marketplace_categories (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  category_id TEXT NOT NULL,
  parent_category_id TEXT,
  category_name TEXT NOT NULL,
  path TEXT,
  leaf BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  title_limit INTEGER,
  description_limit INTEGER,
  image_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,category_id)
);

CREATE TABLE IF NOT EXISTS marketplace_category_attributes (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  category_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  attribute_name TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  allow_custom BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,category_id,attribute_id),
  FOREIGN KEY(marketplace,category_id)
    REFERENCES marketplace_categories(marketplace,category_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS marketplace_brands (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  brand_id TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,brand_id)
);
CREATE INDEX IF NOT EXISTS marketplace_brands_name_idx
  ON marketplace_brands(marketplace,normalized_name);

CREATE TABLE IF NOT EXISTS internal_category_mappings (
  id BIGSERIAL PRIMARY KEY,
  internal_category TEXT NOT NULL,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  marketplace_category_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(internal_category,marketplace),
  CONSTRAINT internal_category_mapping_status_check CHECK (
    status IN ('DRAFT','REVIEW_REQUIRED','CONFIRMED','REJECTED')
  )
);

CREATE TABLE IF NOT EXISTS attribute_mappings (
  id BIGSERIAL PRIMARY KEY,
  internal_attribute TEXT NOT NULL,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  marketplace_category_id TEXT NOT NULL,
  marketplace_attribute_id TEXT NOT NULL,
  value_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(internal_attribute,marketplace,marketplace_category_id)
);

CREATE TABLE IF NOT EXISTS brand_mappings (
  id BIGSERIAL PRIMARY KEY,
  internal_brand TEXT NOT NULL,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  marketplace_brand_id TEXT NOT NULL,
  marketplace_brand_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(internal_brand,marketplace)
);

CREATE TABLE IF NOT EXISTS product_publication_drafts (
  id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE RESTRICT,
  source_marketplace TEXT REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  source_listing_id BIGINT REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  target_marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  catalog_match_id BIGINT REFERENCES marketplace_catalog_matches(id) ON DELETE SET NULL,
  listing_barcode_pool_id BIGINT REFERENCES listing_barcode_pools(id) ON DELETE SET NULL,
  workflow_status TEXT NOT NULL DEFAULT 'DRAFT',
  publication_mode TEXT NOT NULL DEFAULT 'NEW_PRODUCT',
  target_category_id TEXT,
  target_brand_id TEXT,
  title TEXT,
  description TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  stock INTEGER NOT NULL DEFAULT 0,
  requested_price_minor BIGINT,
  pricing_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  external_batch_id TEXT,
  verified_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT publication_draft_workflow_check CHECK (
    workflow_status IN (
      'DRAFT','CATEGORY_REVIEW','ATTRIBUTE_REVIEW','PRICE_REVIEW',
      'READY_TO_PUBLISH','APPROVED','DRY_RUN_COMPLETE','SUBMITTED',
      'PUBLISHED','REJECTED','FAILED'
    )
  ),
  CONSTRAINT publication_draft_mode_check CHECK (
    publication_mode IN ('EXISTING_CATALOG_OFFER','NEW_PRODUCT')
  ),
  CONSTRAINT publication_draft_stock_check CHECK (stock >= 0),
  UNIQUE(recipe_id,target_marketplace)
);
CREATE INDEX IF NOT EXISTS product_publication_drafts_status_idx
  ON product_publication_drafts(target_marketplace,workflow_status,updated_at DESC);

CREATE TABLE IF NOT EXISTS channel_transfer_batches (
  id BIGSERIAL PRIMARY KEY,
  source_marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  target_marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'PREVIEWING',
  idempotency_key TEXT UNIQUE NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  ready_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_transfer_marketplace_check CHECK (source_marketplace<>target_marketplace),
  CONSTRAINT channel_transfer_status_check CHECK (
    status IN ('PREVIEWING','PREVIEW_READY','PARTIAL','APPROVED','DRY_RUN_COMPLETE','FAILED')
  )
);

CREATE TABLE IF NOT EXISTS channel_transfer_items (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES channel_transfer_batches(id) ON DELETE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE RESTRICT,
  source_listing_id BIGINT REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  publication_draft_id BIGINT REFERENCES product_publication_drafts(id) ON DELETE SET NULL,
  item_status TEXT NOT NULL,
  catalog_match_status TEXT,
  blocker_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id,recipe_id),
  CONSTRAINT channel_transfer_item_status_check CHECK (
    item_status IN (
      'EXISTING_MATCH_CONFIRMED','EXISTING_MATCH_REVIEW_REQUIRED','NEW_PRODUCT_REQUIRED',
      'CATEGORY_MAPPING_REQUIRED','ATTRIBUTE_MAPPING_REQUIRED','LISTING_BARCODE_REQUIRED',
      'COST_MAPPING_MISSING','DESI_MISSING','COMMISSION_MISSING',
      'SHIPPING_TARIFF_MISSING','PRICE_NOT_PROFITABLE','READY_TO_LIST','BLOCKED'
    )
  )
);
CREATE INDEX IF NOT EXISTS channel_transfer_items_status_idx
  ON channel_transfer_items(batch_id,item_status);

INSERT INTO jobs(name,description,schedule_minutes,enabled) VALUES
  ('marketplace-category-sync','Pazaryeri kategori ağacını adapter üzerinden yeniler',1440,FALSE),
  ('marketplace-attribute-sync','Pazaryeri kategori özelliklerini yeniler',1440,FALSE),
  ('marketplace-brand-sync','Pazaryeri marka listesini yeniler',1440,FALSE),
  ('catalog-matching','PIM reçeteleri için hedef katalog eşleşmesi üretir',1440,FALSE),
  ('publish-batch-verification','Dry-run dışı gelecek yayın batchlerini doğrular',5,FALSE),
  ('listing-content-verification','Yayınlanan listing içeriğini doğrular',60,FALSE)
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,updated_at=NOW();
