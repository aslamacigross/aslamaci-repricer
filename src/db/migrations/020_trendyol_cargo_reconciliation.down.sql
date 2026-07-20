DELETE FROM jobs WHERE name='sync-trendyol-cargo-invoices';

ALTER TABLE marketplace_orders DROP COLUMN IF EXISTS shipping_source;
ALTER TABLE marketplace_orders DROP COLUMN IF EXISTS package_desi;

DROP TABLE IF EXISTS marketplace_cargo_charges;
