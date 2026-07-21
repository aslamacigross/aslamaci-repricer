ALTER TABLE products
  ADD COLUMN IF NOT EXISTS manual_desi_override NUMERIC(12,3);

UPDATE products
SET manual_desi_override=3,
    desi=3,
    updated_at=NOW()
WHERE marketplace='TRENDYOL'
  AND barcode IN(
    'TYB1XX5539MLXNKT17',
    'TYBRWUR82P8BTRMK99',
    'TYBZ9N21FXAZDISQ13',
    'TRPNKST00955',
    '869GH32H326U2',
    'TYBOB8TWGS1AYV2H33',
    'CRP32112216346346',
    'GMPS',
    'pikniksepeti',
    '8698899586599',
    'TYB48DL4XQC9QXFF08',
    'TYBZFE86RO7PG77448'
  );
