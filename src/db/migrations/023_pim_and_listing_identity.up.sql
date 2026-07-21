CREATE TABLE IF NOT EXISTS pim_physical_products (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT UNIQUE NOT NULL,
  brand TEXT,
  product_family TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  volume_ml INTEGER,
  weight_g INTEGER,
  units_per_pack NUMERIC(12,4) NOT NULL DEFAULT 1,
  scent TEXT,
  flavor TEXT,
  variant TEXT,
  primary_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  manufacturer_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_item_code TEXT UNIQUE REFERENCES cost_items(item_code) ON UPDATE CASCADE ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pim_physical_products_status_check CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  CONSTRAINT pim_physical_products_units_check CHECK (units_per_pack > 0)
);

CREATE TABLE IF NOT EXISTS pim_recipes (
  id BIGSERIAL PRIMARY KEY,
  recipe_code TEXT UNIQUE NOT NULL,
  recipe_name TEXT NOT NULL,
  recipe_type TEXT NOT NULL DEFAULT 'SINGLE',
  bundle_fingerprint TEXT UNIQUE NOT NULL,
  total_cost_minor BIGINT NOT NULL DEFAULT 0,
  fractional_desi NUMERIC(12,4) NOT NULL DEFAULT 0,
  final_desi INTEGER NOT NULL DEFAULT 0,
  packaging_type TEXT,
  packaging_cost_minor BIGINT NOT NULL DEFAULT 0,
  target_profit_minor BIGINT NOT NULL DEFAULT 4000,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pim_recipes_type_check CHECK (recipe_type IN ('SINGLE','PACK','MIXED_BUNDLE')),
  CONSTRAINT pim_recipes_status_check CHECK (status IN ('DRAFT','REVIEW','APPROVED','INACTIVE','ARCHIVED')),
  CONSTRAINT pim_recipes_money_check CHECK (
    total_cost_minor >= 0 AND packaging_cost_minor >= 0 AND target_profit_minor >= 0
  ),
  CONSTRAINT pim_recipes_desi_check CHECK (fractional_desi >= 0 AND final_desi >= 0)
);

CREATE TABLE IF NOT EXISTS pim_recipe_components (
  id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE CASCADE,
  physical_product_id BIGINT NOT NULL REFERENCES pim_physical_products(id) ON DELETE RESTRICT,
  cost_item_code TEXT NOT NULL REFERENCES cost_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity NUMERIC(12,4) NOT NULL,
  variant_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(recipe_id,cost_item_code),
  CONSTRAINT pim_recipe_components_quantity_check CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS pim_recipe_components_product_idx
  ON pim_recipe_components(physical_product_id,recipe_id);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  seller_id TEXT,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE RESTRICT,
  marketplace_product_id TEXT,
  marketplace_catalog_barcode TEXT,
  seller_listing_barcode TEXT NOT NULL,
  seller_sku TEXT,
  external_listing_id TEXT,
  marketplace_category_id TEXT,
  title TEXT,
  description TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  video JSONB,
  stock INTEGER NOT NULL DEFAULT 0,
  sale_price_minor BIGINT NOT NULL DEFAULT 0,
  minimum_price_minor BIGINT NOT NULL DEFAULT 0,
  buybox_price_minor BIGINT NOT NULL DEFAULT 0,
  target_rank INTEGER,
  listing_status TEXT NOT NULL DEFAULT 'DRAFT',
  publication_state TEXT NOT NULL DEFAULT 'DRAFT',
  rejection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,seller_listing_barcode),
  CONSTRAINT marketplace_listings_stock_check CHECK (stock >= 0),
  CONSTRAINT marketplace_listings_money_check CHECK (
    sale_price_minor >= 0 AND minimum_price_minor >= 0 AND buybox_price_minor >= 0
  )
);
CREATE INDEX IF NOT EXISTS marketplace_listings_recipe_idx
  ON marketplace_listings(recipe_id,marketplace);
CREATE INDEX IF NOT EXISTS marketplace_listings_external_idx
  ON marketplace_listings(marketplace,external_listing_id);

CREATE TABLE IF NOT EXISTS marketplace_catalog_matches (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE CASCADE,
  marketplace_product_id TEXT NOT NULL,
  marketplace_catalog_barcode TEXT,
  marketplace_category_id TEXT,
  match_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  match_confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  match_method TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,recipe_id,marketplace_product_id),
  CONSTRAINT marketplace_catalog_matches_status_check CHECK (
    match_status IN ('SUGGESTED','REVIEW_REQUIRED','CONFIRMED','REJECTED','STALE')
  ),
  CONSTRAINT marketplace_catalog_matches_confidence_check CHECK (
    match_confidence >= 0 AND match_confidence <= 100
  )
);

CREATE TABLE IF NOT EXISTS marketplace_listing_identifiers (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES pim_recipes(id) ON DELETE CASCADE,
  marketplace_product_id TEXT,
  seller_listing_barcode TEXT,
  seller_sku TEXT,
  external_listing_id TEXT,
  identifier_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(marketplace,recipe_id,marketplace_product_id,identifier_source),
  CONSTRAINT marketplace_listing_identifiers_source_check CHECK (
    identifier_source IN (
      'EXISTING_MARKETPLACE_CATALOG',
      'EXISTING_SELLER_LISTING',
      'IMPORTED_FROM_SOURCE_MARKETPLACE',
      'GENERATED_FOR_NEW_LISTING',
      'MANUAL'
    )
  ),
  CONSTRAINT marketplace_listing_identifiers_status_check CHECK (
    status IN ('ACTIVE','RESERVED','RETIRED')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listing_identifiers_barcode_idx
  ON marketplace_listing_identifiers(marketplace,seller_listing_barcode);

CREATE TABLE IF NOT EXISTS listing_barcode_pools (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL REFERENCES marketplace_registry(code) ON UPDATE CASCADE,
  barcode TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  assigned_recipe_id BIGINT REFERENCES pim_recipes(id) ON DELETE RESTRICT,
  assigned_listing_id BIGINT REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  allocation_key TEXT UNIQUE,
  identifier_source TEXT NOT NULL DEFAULT 'GENERATED_FOR_NEW_LISTING',
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listing_barcode_pools_status_check CHECK (
    status IN ('AVAILABLE','RESERVED','ASSIGNED','RETIRED')
  ),
  CONSTRAINT listing_barcode_pools_source_check CHECK (
    identifier_source IN ('GENERATED_FOR_NEW_LISTING','MANUAL')
  )
);
CREATE INDEX IF NOT EXISTS listing_barcode_pools_marketplace_status_idx
  ON listing_barcode_pools(marketplace,status,created_at);

ALTER TABLE products ADD COLUMN IF NOT EXISTS recipe_id BIGINT;
ALTER TABLE products
  ADD CONSTRAINT products_recipe_id_pim_fk
  FOREIGN KEY(recipe_id) REFERENCES pim_recipes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS products_recipe_idx ON products(recipe_id,marketplace);

INSERT INTO jobs(name,description,schedule_minutes,enabled)
VALUES('bootstrap-pim','Mevcut cost code ve mappinglerden merkezi PIM reçetelerini oluşturur',1440,FALSE)
ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,updated_at=NOW();
