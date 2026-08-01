BEGIN;

CREATE OR REPLACE FUNCTION platform.custom_auth_verify_current_password(
  p_token_hash text,
  p_password text,
  p_request_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, public AS $$
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

REVOKE ALL ON FUNCTION platform.custom_auth_verify_current_password(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_verify_current_password(text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0011','FOUNDATION','manifest:FND-0011-custom-auth-mfa-password-search-path.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
