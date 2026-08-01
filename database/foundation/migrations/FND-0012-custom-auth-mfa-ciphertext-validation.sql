BEGIN;

ALTER TABLE platform.auth_mfa_factors
  DROP CONSTRAINT IF EXISTS auth_mfa_factors_secret_ciphertext_check;
ALTER TABLE platform.auth_mfa_factors
  ADD CONSTRAINT auth_mfa_factors_secret_ciphertext_check
  CHECK (
    char_length(secret_ciphertext) BETWEEN 32 AND 256
    AND secret_ciphertext ~ '^[A-Za-z0-9_-]+$'
  ) NOT VALID;
ALTER TABLE platform.auth_mfa_factors
  VALIDATE CONSTRAINT auth_mfa_factors_secret_ciphertext_check;

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
     OR char_length(p_secret_ciphertext) NOT BETWEEN 32 AND 256
     OR p_secret_ciphertext !~ '^[A-Za-z0-9_-]+$'
     OR p_secret_iv !~ '^[A-Za-z0-9_-]{16}$'
     OR p_secret_salt !~ '^[A-Za-z0-9_-]{22}$'
     OR p_kdf_iterations < 100000
     OR p_kdf_iterations > 1000000
     OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 80
     OR char_length(p_request_id) = 0 THEN
    RAISE EXCEPTION 'MFA enrollment input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT session_row.* INTO v_session
  FROM platform.auth_sessions AS session_row
  WHERE session_row.token_hash = p_token_hash
    AND session_row.revoked_at IS NULL
    AND session_row.expires_at > now()
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
  SELECT factor.id, factor.status, factor.label, factor.created_at
  FROM platform.auth_mfa_factors AS factor
  WHERE factor.id = p_factor_id;
END $$;

REVOKE ALL ON FUNCTION platform.custom_auth_store_pending_totp(text,uuid,text,text,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.custom_auth_store_pending_totp(text,uuid,text,text,text,text,integer,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0012','FOUNDATION','manifest:FND-0012-custom-auth-mfa-ciphertext-validation.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
