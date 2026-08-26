-- Deployment-safe no-op in the Hepsiburada parity branch.
-- The original August 2026 Trendyol tariff refresh deleted and reloaded
-- TRENDYOL shipping_costs/shipping_barems. That is outside this branch scope
-- and would violate the Trendyol freeze during HB deployment.
SELECT 1;
