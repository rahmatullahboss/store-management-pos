BEGIN;

CREATE OR REPLACE FUNCTION platform.custom_auth_resolve_context(
  p_token_hash text
) RETURNS TABLE (
  session_id uuid,
  expires_at timestamptz,
  user_id uuid,
  display_name text,
  email_normalized text,
  tenant_id uuid,
  tenant_name text,
  membership_id uuid,
  role_code text,
  legal_entity_id uuid,
  store_id uuid,
  warehouse_id uuid,
  register_id uuid,
  permissions text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
  WITH eligible_context AS (
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.id AS user_id,
      u.display_name,
      u.email_normalized,
      t.id AS tenant_id,
      t.display_name AS tenant_name,
      m.id AS membership_id
    FROM platform.auth_sessions AS s
    JOIN platform.users AS u
      ON u.id = s.user_id
     AND u.status = 'active'
    JOIN platform.tenants AS t
      ON t.id = s.tenant_id
     AND t.status = 'active'
    JOIN platform.memberships AS m
      ON m.user_id = u.id
     AND m.tenant_id = t.id
     AND m.status = 'active'
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
  ),
  single_assignment AS (
    SELECT
      ec.*,
      mr.id AS membership_role_id,
      mr.role_id,
      mr.legal_entity_id,
      mr.store_id,
      mr.warehouse_id,
      mr.register_id,
      r.code AS role_code
    FROM eligible_context AS ec
    JOIN platform.membership_roles AS mr
      ON mr.membership_id = ec.membership_id
     AND mr.tenant_id = ec.tenant_id
    JOIN platform.roles AS r
      ON r.id = mr.role_id
     AND r.tenant_id = ec.tenant_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM platform.membership_roles AS other
      WHERE other.tenant_id = mr.tenant_id
        AND other.membership_id = mr.membership_id
        AND other.id <> mr.id
    )
  )
  SELECT
    sa.session_id,
    sa.expires_at,
    sa.user_id,
    sa.display_name,
    sa.email_normalized,
    sa.tenant_id,
    sa.tenant_name,
    sa.membership_id,
    sa.role_code,
    sa.legal_entity_id,
    sa.store_id,
    sa.warehouse_id,
    sa.register_id,
    array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code)
  FROM single_assignment AS sa
  JOIN platform.role_permissions AS rp
    ON rp.role_id = sa.role_id
  JOIN platform.permissions AS p
    ON p.code = rp.permission_code
  GROUP BY
    sa.session_id,
    sa.expires_at,
    sa.user_id,
    sa.display_name,
    sa.email_normalized,
    sa.tenant_id,
    sa.tenant_name,
    sa.membership_id,
    sa.role_code,
    sa.legal_entity_id,
    sa.store_id,
    sa.warehouse_id,
    sa.register_id;
$$;

REVOKE ALL ON FUNCTION platform.custom_auth_resolve_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_resolve_context(text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0023','FOUNDATION','manifest:FND-0023-custom-auth-generic-rbac-context.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
