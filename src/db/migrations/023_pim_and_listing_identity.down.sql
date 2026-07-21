DELETE FROM jobs WHERE name='bootstrap-pim';

DROP INDEX IF EXISTS products_recipe_idx;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_recipe_id_pim_fk;
ALTER TABLE products DROP COLUMN IF EXISTS recipe_id;

DROP TABLE IF EXISTS listing_barcode_pools;
DROP TABLE IF EXISTS marketplace_listing_identifiers;
DROP TABLE IF EXISTS marketplace_catalog_matches;
DROP TABLE IF EXISTS marketplace_listings;
DROP TABLE IF EXISTS pim_recipe_components;
DROP TABLE IF EXISTS pim_recipes;
DROP TABLE IF EXISTS pim_physical_products;
