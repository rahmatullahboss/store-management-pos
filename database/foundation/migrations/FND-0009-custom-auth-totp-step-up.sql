BEGIN;

CREATE TABLE IF NOT EXISTS platform.auth_mfa_factors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  factor_type text NOT NULL DEFAULT 'totp' CHECK (factor_type = 'totp'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  secret_ciphertext text NOT NULL CHECK (secret_ciphertext ~ '^[A-Za-z0-9_-]{32,256}$'),
  secret_iv text NOT NULL CHECK (secret_iv ~ '^[A-Za-z0-9_-]{16}$'),
  secret_salt text NOT NULL CHECK (secret_salt ~ '^[A-Za-z0-9_-]{22}$'),
  kdf_iterations integer NOT NULL CHECK (kdf_iterations BETWEEN 100000 AND 1000000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  last_used_counter bigint NULL CHECK (last_used_counter IS NULL OR last_used_counter >= 0),
  confirmed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_mfa_factors_user_live
  ON platform.auth_mfa_factors(user_id)
  WHERE status IN ('pending','active');
CREATE INDEX IF NOT EXISTS auth_mfa_factors_user_created
  ON platform.auth_mfa_factors(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform.auth_step_up_grants (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES platform.auth_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  factor_id uuid NOT NULL REFERENCES platform.auth_mfa_factors(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  permission_scope text NOT NULL CHECK (permission_scope = 'inventory.reservation.manage'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS auth_step_up_grants_active_lookup
  ON platform.auth_step_up_grants(token_hash, expires_at)
  WHERE used_at IS NULL;

ALTER TABLE platform.auth_events
  DROP CONSTRAINT IF EXISTS auth_events_event_type_check;
ALTER TABLE platform.auth_events
  ADD CONSTRAINT auth_events_event_type_check
  CHECK (event_type IN (
    'sign_up',
    'sign_in',
    'sign_out',
    'session_rejected',
    'mfa_enrollment_started',
    'mfa_enrollment_confirmed',
    'mfa_password_check',
    'mfa_step_up'
  ));

CREATE OR REPLACE FUNCTION platform.custom_auth_ensure_step_up_role(
  p_membership_id uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_membership platform.memberships%ROWTYPE;
  v_identity_subject text;
  v_role_id uuid;
BEGIN
  SELECT m.* INTO v_membership
  FROM platform.memberships AS m
  WHERE m.id = p_membership_id
    AND m.status = 'active'
  FOR UPDATE;

  IF v_membership.id IS NULL THEN RETURN; END IF;

  SELECT u.identity_subject INTO v_identity_subject
  FROM platform.users AS u
  WHERE u.id = v_membership.user_id
    AND u.status = 'active';

  IF v_identity_subject IS NULL OR v_identity_subject NOT LIKE 'custom-auth:%' THEN
    RETURN;
  END IF;

  INSERT INTO platform.roles(
    id, tenant_id, code, display_name, system_role
  ) VALUES (
    gen_random_uuid(),
    v_membership.tenant_id,
    'staging-reservation-step-up',
    'Staging reservation step-up operator',
    false
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT r.id INTO v_role_id
  FROM platform.roles AS r
  WHERE r.tenant_id = v_membership.tenant_id
    AND r.code = 'staging-reservation-step-up';

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'staging step-up role is unavailable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.role_permissions(role_id, permission_code)
  SELECT v_role_id, p.code
  FROM platform.permissions AS p
  WHERE p.code = 'inventory.reservation.manage'
    AND p.risk_level = 'sensitive'
  ON CONFLICT (role_id, permission_code) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.role_permissions AS rp
    WHERE rp.role_id = v_role_id
      AND rp.permission_code = 'inventory.reservation.manage'
  ) THEN
    RAISE EXCEPTION 'reservation step-up permission is unavailable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.membership_roles(
    id,
    tenant_id,
    membership_id,
    role_id,
    legal_entity_id,
    store_id,
    warehouse_id,
    register_id,
    granted_by
  )
  SELECT
    gen_random_uuid(),
    v_membership.tenant_id,
    v_membership.id,
    v_role_id,
    read_role.legal_entity_id,
    read_role.store_id,
    read_role.warehouse_id,
    read_role.register_id,
    NULL
  FROM platform.membership_roles AS read_role
  JOIN platform.roles AS r
    ON r.id = read_role.role_id
   AND r.tenant_id = read_role.tenant_id
   AND r.code = 'staging-read-only'
  WHERE read_role.membership_id = v_membership.id
    AND read_role.tenant_id = v_membership.tenant_id
  ORDER BY read_role.granted_at
  LIMIT 1
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_step_up_role_trigger()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
BEGIN
  PERFORM platform.custom_auth_ensure_step_up_role(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS custom_auth_step_up_role_after_insert
  ON platform.memberships;
CREATE TRIGGER custom_auth_step_up_role_after_insert
AFTER INSERT ON platform.memberships
FOR EACH ROW
EXECUTE FUNCTION platform.custom_auth_step_up_role_trigger();

DO $$
DECLARE
  v_membership_id uuid;
BEGIN
  FOR v_membership_id IN
    SELECT m.id
    FROM platform.memberships AS m
    JOIN platform.users AS u ON u.id = m.user_id
    WHERE m.status = 'active'
      AND u.status = 'active'
      AND u.identity_subject LIKE 'custom-auth:%'
  LOOP
    PERFORM platform.custom_auth_ensure_step_up_role(v_membership_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_store_pending_totp(
  p_token_hash text,
  p_factor_id uuid,
  p_label text,
  p_secret_ciphertext text,
  p_secret_iv text,
  p_secret_salt text,
  p_kdf_iterations integer,
  p_request_id text
) RETURNS TABLE (
  factor_id uuid,
  factor_status text,
  factor_label text,
  created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_session platform.auth_sessions%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR p_secret_ciphertext !~ '^[A-Za-z0-9_-]{32,256}$'
     OR p_secret_iv !~ '^[A-Za-z0-9_-]{16}$'
     OR p_secret_salt !~ '^[A-Za-z0-9_-]{22}$'
     OR p_kdf_iterations < 100000
     OR p_kdf_iterations > 1000000
     OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 80
     OR char_length(p_request_id) = 0 THEN
    RAISE EXCEPTION 'MFA enrollment input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO v_session
  FROM platform.auth_sessions AS s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE platform.auth_mfa_factors
  SET status = 'revoked', revoked_at = now(), updated_at = now()
  WHERE user_id = v_session.user_id
    AND status = 'pending';

  INSERT INTO platform.auth_mfa_factors(
    id,
    user_id,
    label,
    secret_ciphertext,
    secret_iv,
    secret_salt,
    kdf_iterations
  ) VALUES (
    p_factor_id,
    v_session.user_id,
    btrim(p_label),
    p_secret_ciphertext,
    p_secret_iv,
    p_secret_salt,
    p_kdf_iterations
  );

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(),
    v_session.user_id,
    v_session.tenant_id,
    'mfa_enrollment_started',
    'success',
    p_request_id
  );

  RETURN QUERY
  SELECT f.id, f.status, f.label, f.created_at
  FROM platform.auth_mfa_factors AS f
  WHERE f.id = p_factor_id;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_load_totp_factor(
  p_token_hash text,
  p_status text
) RETURNS TABLE (
  factor_id uuid,
  user_id uuid,
  tenant_id uuid,
  factor_status text,
  factor_label text,
  secret_ciphertext text,
  secret_iv text,
  secret_salt text,
  kdf_iterations integer,
  last_used_counter bigint,
  confirmed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
  SELECT
    f.id,
    s.user_id,
    s.tenant_id,
    f.status,
    f.label,
    f.secret_ciphertext,
    f.secret_iv,
    f.secret_salt,
    f.kdf_iterations,
    f.last_used_counter,
    f.confirmed_at
  FROM platform.auth_sessions AS s
  JOIN platform.auth_mfa_factors AS f
    ON f.user_id = s.user_id
   AND f.status = p_status
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND p_status IN ('pending','active')
  ORDER BY f.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION platform.custom_auth_verify_current_password(
  p_token_hash text,
  p_password text,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_session platform.auth_sessions%ROWTYPE;
  v_credential platform.auth_credentials%ROWTYPE;
  v_valid boolean := false;
BEGIN
  SELECT s.* INTO v_session
  FROM platform.auth_sessions AS s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN false;
  END IF;

  SELECT c.* INTO v_credential
  FROM platform.auth_credentials AS c
  WHERE c.user_id = v_session.user_id
  FOR UPDATE;

  v_valid :=
    v_credential.user_id IS NOT NULL
    AND (v_credential.locked_until IS NULL OR v_credential.locked_until <= now())
    AND crypt(p_password, v_credential.password_hash) = v_credential.password_hash;

  IF NOT v_valid THEN
    UPDATE platform.auth_credentials
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE
          WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE locked_until
        END,
        updated_at = now()
    WHERE user_id = v_session.user_id;

    IF COALESCE(v_credential.failed_attempts, 0) + 1 >= 5 THEN
      UPDATE platform.auth_sessions
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = v_session.id;
    END IF;
  ELSE
    UPDATE platform.auth_credentials
    SET failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE user_id = v_session.user_id;
  END IF;

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(),
    v_session.user_id,
    v_session.tenant_id,
    'mfa_password_check',
    CASE WHEN v_valid THEN 'success' ELSE 'failure' END,
    p_request_id
  );

  RETURN v_valid;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_activate_totp(
  p_token_hash text,
  p_factor_id uuid,
  p_counter bigint,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_session platform.auth_sessions%ROWTYPE;
BEGIN
  IF p_counter < 0 THEN
    RETURN false;
  END IF;

  SELECT s.* INTO v_session
  FROM platform.auth_sessions AS s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  FOR SHARE;

  IF v_session.id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE platform.auth_mfa_factors
  SET status = 'active',
      confirmed_at = now(),
      last_used_counter = p_counter,
      updated_at = now()
  WHERE id = p_factor_id
    AND user_id = v_session.user_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(),
    v_session.user_id,
    v_session.tenant_id,
    'mfa_enrollment_confirmed',
    'success',
    p_request_id
  );

  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_issue_step_up(
  p_token_hash text,
  p_factor_id uuid,
  p_grant_id uuid,
  p_grant_hash text,
  p_permission_scope text,
  p_counter bigint,
  p_expires_at timestamptz,
  p_request_id text
) RETURNS TABLE (
  grant_id uuid,
  expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_session platform.auth_sessions%ROWTYPE;
  v_factor platform.auth_mfa_factors%ROWTYPE;
BEGIN
  IF p_grant_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR p_permission_scope <> 'inventory.reservation.manage'
     OR p_counter < 0
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '5 minutes'
     OR char_length(p_request_id) = 0 THEN
    RETURN;
  END IF;

  SELECT s.* INTO v_session
  FROM platform.auth_sessions AS s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  SELECT f.* INTO v_factor
  FROM platform.auth_mfa_factors AS f
  WHERE f.id = p_factor_id
    AND f.user_id = v_session.user_id
    AND f.status = 'active'
  FOR UPDATE;

  IF v_factor.id IS NULL
     OR (v_factor.last_used_counter IS NOT NULL AND p_counter <= v_factor.last_used_counter) THEN
    INSERT INTO platform.auth_events(
      id, user_id, tenant_id, event_type, outcome, request_id
    ) VALUES (
      gen_random_uuid(),
      v_session.user_id,
      v_session.tenant_id,
      'mfa_step_up',
      'failure',
      p_request_id
    );
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.memberships AS m
    JOIN platform.membership_roles AS mr
      ON mr.membership_id = m.id
     AND mr.tenant_id = m.tenant_id
    JOIN platform.roles AS r
      ON r.id = mr.role_id
     AND r.tenant_id = m.tenant_id
     AND r.code = 'staging-reservation-step-up'
    JOIN platform.role_permissions AS rp
      ON rp.role_id = r.id
     AND rp.permission_code = p_permission_scope
    JOIN platform.permissions AS p
      ON p.code = rp.permission_code
     AND p.risk_level = 'sensitive'
    WHERE m.user_id = v_session.user_id
      AND m.tenant_id = v_session.tenant_id
      AND m.status = 'active'
  ) THEN
    RETURN;
  END IF;

  UPDATE platform.auth_mfa_factors
  SET last_used_counter = p_counter, updated_at = now()
  WHERE id = p_factor_id;

  INSERT INTO platform.auth_step_up_grants(
    id,
    session_id,
    user_id,
    tenant_id,
    factor_id,
    token_hash,
    permission_scope,
    expires_at
  ) VALUES (
    p_grant_id,
    v_session.id,
    v_session.user_id,
    v_session.tenant_id,
    p_factor_id,
    p_grant_hash,
    p_permission_scope,
    p_expires_at
  );

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(),
    v_session.user_id,
    v_session.tenant_id,
    'mfa_step_up',
    'success',
    p_request_id
  );

  RETURN QUERY SELECT p_grant_id, p_expires_at;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_consume_step_up(
  p_token_hash text,
  p_grant_hash text,
  p_permission_scope text
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
  WITH active_session AS (
    SELECT s.id
    FROM platform.auth_sessions AS s
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
  ),
  consumed AS (
    UPDATE platform.auth_step_up_grants AS g
    SET used_at = now()
    FROM active_session AS s
    WHERE g.session_id = s.id
      AND g.token_hash = p_grant_hash
      AND g.permission_scope = p_permission_scope
      AND g.used_at IS NULL
      AND g.expires_at > now()
    RETURNING g.id
  )
  SELECT EXISTS (SELECT 1 FROM consumed);
$$;

REVOKE ALL ON platform.auth_mfa_factors, platform.auth_step_up_grants FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_ensure_step_up_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_step_up_role_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_store_pending_totp(text,uuid,text,text,text,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_load_totp_factor(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_verify_current_password(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_activate_totp(text,uuid,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_issue_step_up(text,uuid,uuid,text,text,bigint,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_consume_step_up(text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.custom_auth_ensure_step_up_role(uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_store_pending_totp(text,uuid,text,text,text,text,integer,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_load_totp_factor(text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_verify_current_password(text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_activate_totp(text,uuid,bigint,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_issue_step_up(text,uuid,uuid,text,text,bigint,timestamptz,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_consume_step_up(text,text,text) TO store_app_runtime;
GRANT SELECT, INSERT, UPDATE ON platform.auth_mfa_factors TO store_app_runtime;
GRANT SELECT, INSERT, UPDATE ON platform.auth_step_up_grants TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0009','FOUNDATION','manifest:FND-0009-custom-auth-totp-step-up.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
