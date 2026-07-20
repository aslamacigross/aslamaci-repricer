CREATE TABLE IF NOT EXISTS marketplace_cargo_charges (
  id BIGSERIAL PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'TRENDYOL',
  invoice_serial_number TEXT NOT NULL,
  invoice_date TIMESTAMPTZ,
  parcel_unique_id TEXT NOT NULL,
  external_order_number TEXT,
  shipment_package_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  billed_desi NUMERIC(12,3),
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(
    marketplace,invoice_serial_number,parcel_unique_id,shipment_package_type
  )
);

CREATE INDEX IF NOT EXISTS marketplace_cargo_order_idx
  ON marketplace_cargo_charges(marketplace,external_order_number);
CREATE INDEX IF NOT EXISTS marketplace_cargo_invoice_date_idx
  ON marketplace_cargo_charges(marketplace,invoice_date DESC);

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS package_desi NUMERIC(12,3);
ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS shipping_source TEXT;

INSERT INTO jobs(
  name,description,schedule_minutes,enabled,schedule_type,daily_at,
  schedule_timezone
) VALUES (
  'sync-trendyol-cargo-invoices',
  'Trendyol kargo faturalarındaki gerçek desi ve tutarları yeniler',
  360,TRUE,'INTERVAL',NULL,'Europe/Istanbul'
)
ON CONFLICT(name) DO UPDATE SET
  description=EXCLUDED.description,
  schedule_minutes=EXCLUDED.schedule_minutes,
  enabled=EXCLUDED.enabled,
  schedule_type=EXCLUDED.schedule_type,
  schedule_timezone=EXCLUDED.schedule_timezone,
  updated_at=NOW();
