BEGIN;

CREATE OR REPLACE FUNCTION platform.custom_auth_consume_step_up(
  p_token_hash text,
  p_grant_hash text,
  p_permission_scope text
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
  WITH authorized_session AS (
    SELECT s.id
    FROM platform.auth_sessions AS s
    JOIN platform.auth_step_up_grants AS step_grant
      ON step_grant.session_id = s.id
     AND step_grant.user_id = s.user_id
     AND step_grant.tenant_id = s.tenant_id
     AND step_grant.token_hash = p_grant_hash
     AND step_grant.permission_scope = p_permission_scope
     AND step_grant.used_at IS NULL
     AND step_grant.expires_at > now()
    JOIN platform.auth_mfa_factors AS factor
      ON factor.id = step_grant.factor_id
     AND factor.user_id = s.user_id
     AND factor.status = 'active'
    JOIN platform.memberships AS membership
      ON membership.user_id = s.user_id
     AND membership.tenant_id = s.tenant_id
     AND membership.status = 'active'
    JOIN platform.membership_roles AS membership_role
      ON membership_role.membership_id = membership.id
     AND membership_role.tenant_id = membership.tenant_id
    JOIN platform.roles AS role
      ON role.id = membership_role.role_id
     AND role.tenant_id = membership.tenant_id
     AND role.code = 'staging-reservation-step-up'
    JOIN platform.role_permissions AS role_permission
      ON role_permission.role_id = role.id
     AND role_permission.permission_code = p_permission_scope
    JOIN platform.permissions AS permission
      ON permission.code = role_permission.permission_code
     AND permission.risk_level = 'sensitive'
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND p_permission_scope = 'inventory.reservation.manage'
    LIMIT 1
  ),
  consumed AS (
    UPDATE platform.auth_step_up_grants AS step_grant
    SET used_at = now()
    FROM authorized_session AS session
    WHERE step_grant.session_id = session.id
      AND step_grant.token_hash = p_grant_hash
      AND step_grant.permission_scope = p_permission_scope
      AND step_grant.used_at IS NULL
      AND step_grant.expires_at > now()
    RETURNING step_grant.id
  )
  SELECT EXISTS (SELECT 1 FROM consumed);
$$;

REVOKE ALL ON FUNCTION platform.custom_auth_consume_step_up(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_consume_step_up(text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0010','FOUNDATION','manifest:FND-0010-custom-auth-step-up-consume-hardening.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
