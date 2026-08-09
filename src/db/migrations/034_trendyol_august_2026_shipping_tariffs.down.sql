DELETE FROM shipping_tariff_imports
WHERE marketplace='TRENDYOL' AND source_version='2026-08-10';

DELETE FROM shipping_costs WHERE marketplace='TRENDYOL';
DELETE FROM shipping_barems WHERE marketplace='TRENDYOL';
