BEGIN;

CREATE OR REPLACE FUNCTION platform.jsonb_object_length(
  p_value jsonb
) RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, platform
AS $$
  SELECT count(*)::integer
  FROM jsonb_object_keys(p_value)
$$;

REVOKE ALL ON FUNCTION platform.jsonb_object_length(jsonb) FROM PUBLIC;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0021',
  'FOUNDATION',
  'manifest:FND-0021-internal-token-production-attestation-receipt-jsonb-shape-fix.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
