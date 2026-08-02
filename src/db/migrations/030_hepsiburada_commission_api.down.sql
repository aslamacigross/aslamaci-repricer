UPDATE marketplace_registry
SET capabilities=JSONB_SET(
      COALESCE(capabilities,'{}'::jsonb),
      '{supportsCommissionApi}',
      'false'::jsonb,
      TRUE
    ),
    updated_at=NOW()
WHERE code='HEPSIBURADA';
