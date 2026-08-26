DELETE FROM jobs WHERE name='sync-hepsiburada-buybox';

ALTER TABLE buybox_history
  DROP COLUMN IF EXISTS buybox_source,
  DROP COLUMN IF EXISTS seller_count,
  DROP COLUMN IF EXISTS third_seller,
  DROP COLUMN IF EXISTS second_seller,
  DROP COLUMN IF EXISTS buybox_seller;

ALTER TABLE products
  DROP COLUMN IF EXISTS buybox_error_code,
  DROP COLUMN IF EXISTS buybox_source,
  DROP COLUMN IF EXISTS seller_count,
  DROP COLUMN IF EXISTS third_seller,
  DROP COLUMN IF EXISTS second_seller,
  DROP COLUMN IF EXISTS buybox_seller;
