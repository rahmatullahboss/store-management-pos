BEGIN;

CREATE OR REPLACE FUNCTION platform.custom_auth_login(
  p_email text,
  p_password text,
  p_tenant_code text,
  p_rate_key text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_ip_hash text,
  p_user_agent_hash text,
  p_request_id text
) RETURNS TABLE (
  user_id uuid,
  tenant_id uuid,
  session_id uuid,
  display_name text,
  email_normalized text,
  expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, public AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_user_id uuid;
  v_tenant_id uuid;
  v_display_name text;
  v_password_hash text;
  v_locked_until timestamptz;
  v_session_id uuid := gen_random_uuid();
  v_rate platform.auth_rate_limits%ROWTYPE;
BEGIN
  IF p_rate_key !~ '^[A-Za-z0-9_-]{43}$' OR p_token_hash !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'authentication key is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT rl.* INTO v_rate
  FROM platform.auth_rate_limits AS rl
  WHERE rl.key_hash = p_rate_key
  FOR UPDATE;

  IF FOUND AND v_rate.blocked_until IS NOT NULL AND v_rate.blocked_until > now() THEN
    INSERT INTO platform.auth_events(
      id, event_type, outcome, request_id, ip_hash, user_agent_hash
    ) VALUES (
      gen_random_uuid(), 'sign_in', 'blocked', p_request_id, p_ip_hash, p_user_agent_hash
    );
    RETURN;
  END IF;

  SELECT u.id, m.tenant_id, u.display_name, c.password_hash, c.locked_until
    INTO v_user_id, v_tenant_id, v_display_name, v_password_hash, v_locked_until
  FROM platform.users AS u
  JOIN platform.auth_credentials AS c ON c.user_id = u.id
  JOIN platform.memberships AS m ON m.user_id = u.id AND m.status = 'active'
  JOIN platform.tenants AS t ON t.id = m.tenant_id AND t.status = 'active'
  WHERE u.email_normalized = v_email
    AND u.status = 'active'
    AND t.code = p_tenant_code
  ORDER BY m.created_at
  LIMIT 1
  FOR UPDATE OF c;

  IF v_user_id IS NULL
     OR (v_locked_until IS NOT NULL AND v_locked_until > now())
     OR crypt(p_password, v_password_hash) <> v_password_hash THEN
    IF v_user_id IS NOT NULL THEN
      UPDATE platform.auth_credentials AS c
      SET failed_attempts = c.failed_attempts + 1,
          locked_until = CASE
            WHEN c.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
            ELSE c.locked_until
          END,
          updated_at = now()
      WHERE c.user_id = v_user_id;
    END IF;

    INSERT INTO platform.auth_rate_limits(
      key_hash, attempt_count, window_started_at, blocked_until, updated_at
    ) VALUES (
      p_rate_key, 1, now(), NULL, now()
    )
    ON CONFLICT (key_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN platform.auth_rate_limits.window_started_at < now() - interval '15 minutes' THEN 1
        ELSE platform.auth_rate_limits.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN platform.auth_rate_limits.window_started_at < now() - interval '15 minutes' THEN now()
        ELSE platform.auth_rate_limits.window_started_at
      END,
      blocked_until = CASE
        WHEN (
          CASE
            WHEN platform.auth_rate_limits.window_started_at < now() - interval '15 minutes' THEN 1
            ELSE platform.auth_rate_limits.attempt_count + 1
          END
        ) >= 8 THEN now() + interval '15 minutes'
        ELSE platform.auth_rate_limits.blocked_until
      END,
      updated_at = now();

    INSERT INTO platform.auth_events(
      id, user_id, tenant_id, event_type, outcome, request_id, ip_hash, user_agent_hash
    ) VALUES (
      gen_random_uuid(), v_user_id, v_tenant_id, 'sign_in',
      CASE
        WHEN v_locked_until IS NOT NULL AND v_locked_until > now() THEN 'blocked'
        ELSE 'failure'
      END,
      p_request_id, p_ip_hash, p_user_agent_hash
    );
    RETURN;
  END IF;

  DELETE FROM platform.auth_rate_limits AS rl
  WHERE rl.key_hash = p_rate_key;

  UPDATE platform.auth_credentials AS c
  SET failed_attempts = 0,
      locked_until = NULL,
      updated_at = now()
  WHERE c.user_id = v_user_id;

  INSERT INTO platform.auth_sessions(
    id, user_id, tenant_id, token_hash, expires_at, ip_hash, user_agent_hash
  ) VALUES (
    v_session_id, v_user_id, v_tenant_id, p_token_hash, p_expires_at, p_ip_hash, p_user_agent_hash
  );

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id, ip_hash, user_agent_hash
  ) VALUES (
    gen_random_uuid(), v_user_id, v_tenant_id, 'sign_in', 'success', p_request_id, p_ip_hash, p_user_agent_hash
  );

  RETURN QUERY
  SELECT v_user_id, v_tenant_id, v_session_id, v_display_name, v_email, p_expires_at;
END $$;

REVOKE ALL ON FUNCTION platform.custom_auth_login(text,text,text,text,text,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_login(text,text,text,text,text,timestamptz,text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0007','FOUNDATION','manifest:FND-0007-custom-auth-login-fix.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
