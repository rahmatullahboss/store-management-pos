BEGIN;

ALTER TABLE platform.auth_credentials
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS platform.auth_action_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('password_recovery','email_verification')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  ip_hash text NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[A-Za-z0-9_-]{43}$'),
  user_agent_hash text NULL CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (
    (purpose = 'password_recovery' AND expires_at <= created_at + interval '15 minutes')
    OR
    (purpose = 'email_verification' AND expires_at <= created_at + interval '24 hours')
  ),
  CHECK (used_at IS NULL OR used_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS auth_action_tokens_active_lookup
  ON platform.auth_action_tokens(token_hash, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_action_tokens_user_purpose
  ON platform.auth_action_tokens(user_id, purpose, created_at DESC);

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
    'mfa_step_up',
    'password_recovery_requested',
    'password_reset_completed',
    'email_verification_requested',
    'email_verified'
  ));

CREATE OR REPLACE FUNCTION platform.custom_auth_request_action_token(
  p_email text,
  p_tenant_code text,
  p_purpose text,
  p_token_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_rate_key text,
  p_request_id text,
  p_ip_hash text,
  p_user_agent_hash text
) RETURNS TABLE (
  issued boolean,
  user_id uuid,
  tenant_id uuid,
  email_normalized text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_user_id uuid;
  v_tenant_id uuid;
  v_event_type text;
  v_rate platform.auth_rate_limits%ROWTYPE;
  v_max_expiry timestamptz;
BEGIN
  IF p_purpose NOT IN ('password_recovery','email_verification')
     OR p_token_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR p_rate_key !~ '^[A-Za-z0-9_-]{43}$'
     OR p_ip_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR p_user_agent_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR char_length(p_request_id) NOT BETWEEN 1 AND 200
     OR char_length(v_email) NOT BETWEEN 5 AND 254
     OR position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION 'authentication action token input is invalid' USING ERRCODE = '22023';
  END IF;

  v_max_expiry := CASE
    WHEN p_purpose = 'password_recovery' THEN now() + interval '15 minutes'
    ELSE now() + interval '24 hours'
  END;
  IF p_expires_at <= now() OR p_expires_at > v_max_expiry THEN
    RAISE EXCEPTION 'authentication action token expiry is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rate
  FROM platform.auth_rate_limits
  WHERE key_hash = p_rate_key
  FOR UPDATE;

  IF FOUND AND v_rate.blocked_until IS NOT NULL AND v_rate.blocked_until > now() THEN
    v_event_type := CASE
      WHEN p_purpose = 'password_recovery' THEN 'password_recovery_requested'
      ELSE 'email_verification_requested'
    END;
    INSERT INTO platform.auth_events(
      id, event_type, outcome, request_id, ip_hash, user_agent_hash
    ) VALUES (
      gen_random_uuid(), v_event_type, 'blocked', p_request_id, p_ip_hash, p_user_agent_hash
    );
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
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
      ) >= 5 THEN now() + interval '15 minutes'
      ELSE platform.auth_rate_limits.blocked_until
    END,
    updated_at = now();

  SELECT u.id, m.tenant_id
    INTO v_user_id, v_tenant_id
  FROM platform.users AS u
  JOIN platform.memberships AS m
    ON m.user_id = u.id
   AND m.status = 'active'
  JOIN platform.tenants AS t
    ON t.id = m.tenant_id
   AND t.status = 'active'
  WHERE u.email_normalized = v_email
    AND u.status = 'active'
    AND t.code = p_tenant_code
  ORDER BY m.created_at
  LIMIT 1;

  v_event_type := CASE
    WHEN p_purpose = 'password_recovery' THEN 'password_recovery_requested'
    ELSE 'email_verification_requested'
  END;

  IF v_user_id IS NULL THEN
    INSERT INTO platform.auth_events(
      id, event_type, outcome, request_id, ip_hash, user_agent_hash
    ) VALUES (
      gen_random_uuid(), v_event_type, 'success', p_request_id, p_ip_hash, p_user_agent_hash
    );
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  UPDATE platform.auth_action_tokens
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = v_user_id
    AND purpose = p_purpose
    AND used_at IS NULL
    AND revoked_at IS NULL;

  INSERT INTO platform.auth_action_tokens(
    id, user_id, tenant_id, purpose, token_hash, expires_at,
    request_id, ip_hash, user_agent_hash
  ) VALUES (
    p_token_id, v_user_id, v_tenant_id, p_purpose, p_token_hash, p_expires_at,
    p_request_id, p_ip_hash, p_user_agent_hash
  );

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id, ip_hash, user_agent_hash
  ) VALUES (
    gen_random_uuid(), v_user_id, v_tenant_id, v_event_type, 'success',
    p_request_id, p_ip_hash, p_user_agent_hash
  );

  RETURN QUERY SELECT true, v_user_id, v_tenant_id, v_email;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_complete_password_reset(
  p_token_hash text,
  p_new_password text,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, public AS $$
DECLARE
  v_token platform.auth_action_tokens%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR char_length(p_new_password) NOT BETWEEN 10 AND 128
     OR char_length(p_request_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'password reset input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT token_row.* INTO v_token
  FROM platform.auth_action_tokens AS token_row
  WHERE token_row.token_hash = p_token_hash
    AND token_row.purpose = 'password_recovery'
    AND token_row.used_at IS NULL
    AND token_row.revoked_at IS NULL
    AND token_row.expires_at > now()
  FOR UPDATE;

  IF v_token.id IS NULL THEN RETURN false; END IF;

  UPDATE platform.auth_credentials
  SET password_hash = crypt(p_new_password, gen_salt('bf', 12)),
      failed_attempts = 0,
      locked_until = NULL,
      password_changed_at = now(),
      updated_at = now()
  WHERE user_id = v_token.user_id;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE platform.auth_action_tokens
  SET used_at = now(), updated_at = now()
  WHERE id = v_token.id;

  UPDATE platform.auth_action_tokens
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = v_token.user_id
    AND id <> v_token.id
    AND used_at IS NULL
    AND revoked_at IS NULL;

  UPDATE platform.auth_sessions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE user_id = v_token.user_id
    AND revoked_at IS NULL;

  UPDATE platform.auth_step_up_grants
  SET used_at = COALESCE(used_at, now())
  WHERE user_id = v_token.user_id
    AND used_at IS NULL;

  UPDATE platform.auth_mfa_factors
  SET status = 'revoked',
      revoked_at = COALESCE(revoked_at, now()),
      updated_at = now()
  WHERE user_id = v_token.user_id
    AND status IN ('pending','active');

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(), v_token.user_id, v_token.tenant_id,
    'password_reset_completed', 'success', p_request_id
  );

  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_complete_email_verification(
  p_token_hash text,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_token platform.auth_action_tokens%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[A-Za-z0-9_-]{43}$'
     OR char_length(p_request_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'email verification input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT token_row.* INTO v_token
  FROM platform.auth_action_tokens AS token_row
  WHERE token_row.token_hash = p_token_hash
    AND token_row.purpose = 'email_verification'
    AND token_row.used_at IS NULL
    AND token_row.revoked_at IS NULL
    AND token_row.expires_at > now()
  FOR UPDATE;

  IF v_token.id IS NULL THEN RETURN false; END IF;

  UPDATE platform.auth_credentials
  SET email_verified_at = COALESCE(email_verified_at, now()),
      updated_at = now()
  WHERE user_id = v_token.user_id;

  UPDATE platform.auth_action_tokens
  SET used_at = now(), updated_at = now()
  WHERE id = v_token.id;

  INSERT INTO platform.auth_events(
    id, user_id, tenant_id, event_type, outcome, request_id
  ) VALUES (
    gen_random_uuid(), v_token.user_id, v_token.tenant_id,
    'email_verified', 'success', p_request_id
  );

  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION platform.custom_auth_cleanup_action_tokens(
  p_before timestamptz,
  p_limit integer
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_before > now() - interval '24 hours'
     OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'action token cleanup input is invalid' USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT id
    FROM platform.auth_action_tokens
    WHERE (
      expires_at < p_before
      OR used_at < p_before
      OR revoked_at < p_before
    )
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM platform.auth_action_tokens AS token_row
  USING candidates
  WHERE token_row.id = candidates.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

REVOKE ALL ON platform.auth_action_tokens FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_request_action_token(text,text,text,uuid,text,timestamptz,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_complete_password_reset(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_complete_email_verification(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.custom_auth_cleanup_action_tokens(timestamptz,integer) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.auth_action_tokens TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_request_action_token(text,text,text,uuid,text,timestamptz,text,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_complete_password_reset(text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_complete_email_verification(text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.custom_auth_cleanup_action_tokens(timestamptz,integer) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0013','FOUNDATION','manifest:FND-0013-custom-auth-action-tokens.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
