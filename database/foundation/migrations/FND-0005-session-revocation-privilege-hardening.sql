BEGIN;

CREATE OR REPLACE FUNCTION platform.revoke_identity_session(
  p_session_id text,
  p_user_id uuid,
  p_reason text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, platform AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), gen_random_uuid()::text);
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_revocation_id uuid := gen_random_uuid();
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'request context is required' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL OR char_length(p_session_id) = 0 OR p_user_id IS NULL OR p_reason IS NULL OR char_length(p_reason) = 0 THEN
    RAISE EXCEPTION 'session, user and reason are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform.memberships
    WHERE tenant_id = v_tenant_id
      AND user_id = v_actor_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active actor membership is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform.memberships
    WHERE tenant_id = v_tenant_id
      AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'target user is not a tenant member' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.session_revocations(
    id, tenant_id, session_id, user_id, revoked_by, reason, request_id, trace_id
  ) VALUES (
    v_revocation_id, v_tenant_id, p_session_id, p_user_id, v_actor_id, p_reason, v_request_id, v_trace_id
  ) ON CONFLICT (tenant_id, session_id) DO NOTHING;

  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'platform.identity.session_revoked.v1', 'platform.identity.session.revoke',
    'success', v_actor_id, 'identity_session', p_session_id, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('userId', p_user_id), v_business_date, 'foundation-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version, payload,
    metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'platform.identity.session_revoked.v1', 'identity_session', p_session_id,
    '1.0', jsonb_build_object('sessionId', p_session_id, 'userId', p_user_id, 'revokedAt', now()),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION platform.revoke_identity_session(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.revoke_identity_session(text,uuid,text) TO store_app_runtime;
REVOKE INSERT, UPDATE, DELETE ON platform.session_revocations FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0005','FOUNDATION','manifest:FND-0005-session-revocation-privilege-hardening.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
