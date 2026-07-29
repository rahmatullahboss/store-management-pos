BEGIN;

ALTER TABLE integration.api_clients
  ADD COLUMN service_user_id uuid NULL REFERENCES platform.users(id);

UPDATE integration.api_clients
SET service_user_id = created_by
WHERE service_user_id IS NULL;

ALTER TABLE integration.api_clients
  ALTER COLUMN service_user_id SET NOT NULL;

CREATE OR REPLACE FUNCTION integration.resolve_api_client_authentication(
  p_tenant_id uuid,
  p_client_id uuid,
  p_authentication text
) RETURNS TABLE(
  client_id uuid,
  tenant_id uuid,
  service_user_id uuid,
  display_name text,
  authentication text,
  scopes text[],
  status text,
  rate_limit_per_minute integer,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  credential_reference text,
  credential_version bigint,
  credential_valid_from timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_client_id IS NULL THEN
    RETURN;
  END IF;
  IF p_authentication NOT IN ('api_key','oauth2_client_credentials') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    client.id,
    client.tenant_id,
    client.service_user_id,
    client.display_name,
    client.authentication,
    client.scopes,
    client.status,
    client.rate_limit_per_minute,
    client.created_at,
    client.expires_at,
    client.revoked_at,
    client.credential_reference,
    client.credential_version,
    COALESCE(client.last_rotated_at, client.created_at)
  FROM integration.api_clients AS client
  WHERE client.tenant_id = p_tenant_id
    AND client.id = p_client_id
    AND client.authentication = p_authentication
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION integration.resolve_api_client_authentication(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration.resolve_api_client_authentication(uuid,uuid,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0004','MOD-G-INTEGRATION','manifest:INT-0004-public-api-directory.sql');

COMMIT;
