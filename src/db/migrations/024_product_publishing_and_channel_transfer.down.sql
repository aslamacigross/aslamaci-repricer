DELETE FROM jobs WHERE name IN(
  'marketplace-category-sync','marketplace-attribute-sync','marketplace-brand-sync',
  'catalog-matching','publish-batch-verification','listing-content-verification'
);

DROP TABLE IF EXISTS channel_transfer_items;
DROP TABLE IF EXISTS channel_transfer_batches;
DROP TABLE IF EXISTS product_publication_drafts;
DROP TABLE IF EXISTS brand_mappings;
DROP TABLE IF EXISTS attribute_mappings;
DROP TABLE IF EXISTS internal_category_mappings;
DROP TABLE IF EXISTS marketplace_brands;
DROP TABLE IF EXISTS marketplace_category_attributes;
DROP TABLE IF EXISTS marketplace_categories;
