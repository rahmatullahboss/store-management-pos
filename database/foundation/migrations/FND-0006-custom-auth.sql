BEGIN;

CREATE TABLE IF NOT EXISTS platform.auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES platform.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (password_hash LIKE '$2%'),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[A-Za-z0-9_-]{43}$'),
  user_agent_hash text NULL CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS auth_sessions_active_lookup
  ON platform.auth_sessions(token_hash, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_user_active
  ON platform.auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS platform.auth_rate_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[A-Za-z0-9_-]{43}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.auth_events (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES platform.users(id) ON DELETE SET NULL,
  tenant_id uuid NULL REFERENCES platform.tenants(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('sign_up','sign_in','sign_out','session_rejected')),
  outcome text NOT NULL CHECK (outcome IN ('success','failure','blocked')),
  request_id text NOT NULL,
  ip_hash text NULL,
  user_agent_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_events_created_at ON platform.auth_events(created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_user_created_at ON platform.auth_events(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION platform.custom_auth_register(
  p_email text,
  p_display_name text,
  p_password text,
  p_tenant_code text,
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
  v_name text := btrim(p_display_name);
  v_user_id uuid := gen_random_uuid();
  v_tenant_id uuid;
  v_membership_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
BEGIN
  IF char_length(v_email) < 5 OR char_length(v_email) > 254 OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'email is invalid' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'display name is invalid' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_password) < 10 OR char_length(p_password) > 128 THEN
    RAISE EXCEPTION 'password length is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash !~ '^[A-Za-z0-9_-]{43}$' OR p_expires_at <= now() OR char_length(p_request_id) = 0 THEN
    RAISE EXCEPTION 'session input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_tenant_id
  FROM platform.tenants
  WHERE code = p_tenant_code AND status = 'active'
  FOR SHARE;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'staging tenant is unavailable' USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.users(id, identity_subject, display_name, email_normalized, status)
  VALUES (v_user_id, 'custom-auth:' || v_user_id::text, v_name, v_email, 'active');

  INSERT INTO platform.auth_credentials(user_id, password_hash)
  VALUES (v_user_id, crypt(p_password, gen_salt('bf', 12)));

  INSERT INTO platform.memberships(id, tenant_id, user_id, status)
  VALUES (v_membership_id, v_tenant_id, v_user_id, 'active');

  INSERT INTO platform.auth_sessions(
    id, user_id, tenant_id, token_hash, expires_at, ip_hash, user_agent_hash
  ) VALUES (
    v_session_id, v_user_id, v_tenant_id, p_token_hash, p_expires_at, p_ip_hash, p_user_agent_hash
  );

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id, ip_hash, user_agent_hash
  ) VALUES (
    gen_random_uuid(), v_user_id, v_tenant_id, 'sign_up', 'success', p_request_id, p_ip_hash, p_user_agent_hash
  );

  RETURN QUERY SELECT v_user_id, v_tenant_id, v_session_id, v_name, v_email, p_expires_at;
END $$;

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

  SELECT * INTO v_rate
  FROM platform.auth_rate_limits
  WHERE key_hash = p_rate_key
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
  FROM platform.users u
  JOIN platform.auth_credentials c ON c.user_id = u.id
  JOIN platform.memberships m ON m.user_id = u.id AND m.status = 'active'
  JOIN platform.tenants t ON t.id = m.tenant_id AND t.status = 'active'
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
      UPDATE platform.auth_credentials
      SET failed_attempts = failed_attempts + 1,
          locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
          updated_at = now()
      WHERE user_id = v_user_id;
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
      CASE WHEN v_locked_until IS NOT NULL AND v_locked_until > now() THEN 'blocked' ELSE 'failure' END,
      p_request_id, p_ip_hash, p_user_agent_hash
    );
    RETURN;
  END IF;

  DELETE FROM platform.auth_rate_limits WHERE key_hash = p_rate_key;
  UPDATE platform.auth_credentials
  SET failed_attempts = 0, locked_until = NULL, updated_at = now()
  WHERE user_id = v_user_id;

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

  RETURN QUERY SELECT v_user_id, v_tenant_id, v_session_id, v_display_name, v_email, p_expires_at;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_revoke_session(
  p_token_hash text,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  UPDATE platform.auth_sessions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
  RETURNING user_id, tenant_id INTO v_user_id, v_tenant_id;

  IF v_user_id IS NULL THEN RETURN false; END IF;

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(), v_user_id, v_tenant_id, 'sign_out', 'success', p_request_id
  );
  RETURN true;
END $$;

REVOKE ALL ON platform.auth_credentials, platform.auth_sessions, platform.auth_rate_limits, platform.auth_events FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_register(text,text,text,text,text,timestamptz,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_login(text,text,text,text,text,timestamptz,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_revoke_session(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_register(text,text,text,text,text,timestamptz,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_login(text,text,text,text,text,timestamptz,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_revoke_session(text,text) TO store_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.auth_sessions TO store_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.auth_rate_limits TO store_app_runtime;
GRANT SELECT, INSERT ON platform.auth_events TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0006','FOUNDATION','manifest:FND-0006-custom-auth.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
