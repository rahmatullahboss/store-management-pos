BEGIN;

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

  SELECT rate_row.* INTO v_rate
  FROM platform.auth_rate_limits AS rate_row
  WHERE rate_row.key_hash = p_rate_key
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

  SELECT user_row.id, membership.tenant_id
    INTO v_user_id, v_tenant_id
  FROM platform.users AS user_row
  JOIN platform.memberships AS membership
    ON membership.user_id = user_row.id
   AND membership.status = 'active'
  JOIN platform.tenants AS tenant
    ON tenant.id = membership.tenant_id
   AND tenant.status = 'active'
  WHERE user_row.email_normalized = v_email
    AND user_row.status = 'active'
    AND tenant.code = p_tenant_code
  ORDER BY membership.created_at
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

  UPDATE platform.auth_action_tokens AS action_token
  SET revoked_at = now(), updated_at = now()
  WHERE action_token.user_id = v_user_id
    AND action_token.purpose = p_purpose
    AND action_token.used_at IS NULL
    AND action_token.revoked_at IS NULL;

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

REVOKE ALL ON FUNCTION platform.custom_auth_request_action_token(text,text,text,uuid,text,timestamptz,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_request_action_token(text,text,text,uuid,text,timestamptz,text,text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0014','FOUNDATION','manifest:FND-0014-custom-auth-action-token-alias-hardening.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
