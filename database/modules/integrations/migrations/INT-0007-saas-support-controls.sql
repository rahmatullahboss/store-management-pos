BEGIN;

CREATE OR REPLACE FUNCTION platform.issue_support_impersonation_grant(
  p_grant_id uuid,
  p_tenant_id uuid,
  p_support_actor_id uuid,
  p_approved_by uuid,
  p_reason text,
  p_scopes text[],
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(grant_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_existing platform.support_impersonation_grants%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_support_actor_id = p_approved_by THEN
    RAISE EXCEPTION 'support impersonation requires independent approval' USING ERRCODE = '22023';
  END IF;
  IF btrim(p_reason) = '' OR cardinality(p_scopes) IS NULL OR cardinality(p_scopes) = 0
     OR cardinality(p_scopes) <> cardinality(ARRAY(SELECT DISTINCT scope FROM unnest(p_scopes) AS scope))
     OR EXISTS (SELECT 1 FROM unnest(p_scopes) AS scope WHERE scope !~ '^[a-z][a-z0-9_.-]{2,127}$') THEN
    RAISE EXCEPTION 'support impersonation reason and scopes are invalid' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at <= p_issued_at OR p_expires_at > p_issued_at + interval '8 hours' THEN
    RAISE EXCEPTION 'support impersonation window must be positive and no longer than eight hours' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform.support_impersonation_grants
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.support_actor_id IS DISTINCT FROM p_support_actor_id
       OR v_existing.approved_by IS DISTINCT FROM p_approved_by THEN
      RAISE EXCEPTION 'support impersonation grant idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO platform.support_impersonation_grants(
    id, tenant_id, support_actor_id, approved_by, reason, scopes, issued_at,
    expires_at, idempotency_key, request_hash
  ) VALUES (
    p_grant_id, p_tenant_id, p_support_actor_id, p_approved_by, p_reason, p_scopes,
    p_issued_at, p_expires_at, p_idempotency_key, p_request_hash
  );
  INSERT INTO platform.support_impersonation_events(
    id, tenant_id, grant_id, event_type, support_actor_id, actor_id, observed_at,
    request_id, trace_id, metadata
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_grant_id, 'issued', p_support_actor_id,
    p_approved_by, p_issued_at, p_request_id, p_trace_id,
    jsonb_build_object('scopes', p_scopes, 'expiresAt', p_expires_at)
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, approver_id,
    impersonator_id, target_type, target_id, reason, request_id, trace_id,
    metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_impersonation.issued.v1',
    'saas.support_impersonation.issue', 'success', p_support_actor_id,
    p_approved_by, p_support_actor_id, 'saas.support_impersonation_grant',
    p_grant_id::text, p_reason, p_request_id, p_trace_id,
    jsonb_build_object('scopes', p_scopes, 'expiresAt', p_expires_at),
    p_issued_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_impersonation.issued.v1',
    'saas.support_impersonation_grant', p_grant_id::text, '1.0',
    jsonb_build_object('supportActorId', p_support_actor_id, 'approvedBy', p_approved_by,
      'scopes', p_scopes, 'expiresAt', p_expires_at),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_issued_at, p_business_date
  );
  RETURN QUERY SELECT p_grant_id, false;
END $$;

CREATE OR REPLACE FUNCTION platform.record_support_impersonation_use(
  p_event_id uuid,
  p_tenant_id uuid,
  p_grant_id uuid,
  p_support_actor_id uuid,
  p_scope text,
  p_target_type text,
  p_target_id text,
  p_observed_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_grant platform.support_impersonation_grants%ROWTYPE;
  v_existing platform.support_impersonation_events%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM platform.support_impersonation_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing.grant_id IS DISTINCT FROM p_grant_id
       OR v_existing.event_type IS DISTINCT FROM 'used'
       OR v_existing.support_actor_id IS DISTINCT FROM p_support_actor_id THEN
      RAISE EXCEPTION 'support impersonation use replay differs' USING ERRCODE = '23505';
    END IF;
    RETURN true;
  END IF;

  SELECT * INTO v_grant
  FROM platform.support_impersonation_grants
  WHERE tenant_id = p_tenant_id AND id = p_grant_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support impersonation grant not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_grant.support_actor_id IS DISTINCT FROM p_support_actor_id
     OR p_observed_at < v_grant.issued_at OR p_observed_at >= v_grant.expires_at
     OR (v_grant.revoked_at IS NOT NULL AND p_observed_at >= v_grant.revoked_at)
     OR NOT (p_scope = ANY(v_grant.scopes)) THEN
    RAISE EXCEPTION 'support impersonation grant is not active for requested scope' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_target_type) = '' OR btrim(p_target_id) = '' THEN
    RAISE EXCEPTION 'support impersonation target is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.support_impersonation_events(
    id, tenant_id, grant_id, event_type, support_actor_id, actor_id, observed_at,
    request_id, trace_id, metadata
  ) VALUES (
    p_event_id, p_tenant_id, p_grant_id, 'used', p_support_actor_id,
    p_support_actor_id, p_observed_at, p_request_id, p_trace_id,
    jsonb_build_object('scope', p_scope, 'targetType', p_target_type, 'targetId', p_target_id)
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, approver_id,
    impersonator_id, target_type, target_id, reason, request_id, trace_id,
    metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_impersonation.used.v1',
    'saas.support_impersonation.use', 'success', p_support_actor_id,
    v_grant.approved_by, p_support_actor_id, p_target_type, p_target_id,
    v_grant.reason, p_request_id, p_trace_id,
    jsonb_build_object('grantId', p_grant_id, 'scope', p_scope),
    p_observed_at, p_business_date, 'mod-g-v1'
  );
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION platform.revoke_support_impersonation_grant(
  p_event_id uuid,
  p_tenant_id uuid,
  p_grant_id uuid,
  p_expected_version bigint,
  p_actor_id uuid,
  p_reason text,
  p_revoked_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(version bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_grant platform.support_impersonation_grants%ROWTYPE;
  v_existing platform.support_impersonation_events%ROWTYPE;
  v_next_version bigint;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM platform.support_impersonation_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing.grant_id IS DISTINCT FROM p_grant_id
       OR v_existing.event_type IS DISTINCT FROM 'revoked' THEN
      RAISE EXCEPTION 'support impersonation revocation replay differs' USING ERRCODE = '23505';
    END IF;
    SELECT grant.version INTO v_next_version
    FROM platform.support_impersonation_grants grant
    WHERE grant.tenant_id = p_tenant_id AND grant.id = p_grant_id;
    RETURN QUERY SELECT v_next_version, true;
    RETURN;
  END IF;

  SELECT * INTO v_grant
  FROM platform.support_impersonation_grants
  WHERE tenant_id = p_tenant_id AND id = p_grant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support impersonation grant not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_grant.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'support impersonation grant version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_grant.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'support impersonation grant is already revoked' USING ERRCODE = '22023';
  END IF;
  IF p_revoked_at < v_grant.issued_at OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'support impersonation revocation is invalid' USING ERRCODE = '22023';
  END IF;

  v_next_version := v_grant.version + 1;
  UPDATE platform.support_impersonation_grants
  SET revoked_at = p_revoked_at, version = v_next_version
  WHERE tenant_id = p_tenant_id AND id = p_grant_id;
  INSERT INTO platform.support_impersonation_events(
    id, tenant_id, grant_id, event_type, support_actor_id, actor_id, observed_at,
    request_id, trace_id, metadata
  ) VALUES (
    p_event_id, p_tenant_id, p_grant_id, 'revoked', v_grant.support_actor_id,
    p_actor_id, p_revoked_at, p_request_id, p_trace_id,
    jsonb_build_object('reason', p_reason)
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, approver_id,
    impersonator_id, target_type, target_id, reason, request_id, trace_id,
    metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_impersonation.revoked.v1',
    'saas.support_impersonation.revoke', 'success', p_actor_id,
    v_grant.approved_by, v_grant.support_actor_id,
    'saas.support_impersonation_grant', p_grant_id::text, p_reason,
    p_request_id, p_trace_id, jsonb_build_object('version', v_next_version),
    p_revoked_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_impersonation.revoked.v1',
    'saas.support_impersonation_grant', p_grant_id::text, '1.0',
    jsonb_build_object('supportActorId', v_grant.support_actor_id,
      'revokedAt', p_revoked_at, 'version', v_next_version),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_revoked_at, p_business_date
  );
  RETURN QUERY SELECT v_next_version, false;
END $$;

CREATE OR REPLACE FUNCTION platform.set_feature_rollout(
  p_event_id uuid,
  p_rollout_id uuid,
  p_tenant_id uuid,
  p_feature_code text,
  p_status text,
  p_rollout_percentage smallint,
  p_reason text,
  p_expected_version bigint,
  p_actor_id uuid,
  p_observed_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(rollout_id uuid, version bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_rollout platform.feature_rollouts%ROWTYPE;
  v_existing platform.feature_rollout_events%ROWTYPE;
  v_next_version bigint;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_feature_code !~ '^[a-z][a-z0-9_.-]{2,127}$'
     OR p_status NOT IN ('planned','enabled','paused','disabled')
     OR p_rollout_percentage < 0 OR p_rollout_percentage > 100
     OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'feature rollout input is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('planned','paused','disabled') AND p_rollout_percentage <> 0 THEN
    RAISE EXCEPTION 'non-enabled feature rollout percentage must be zero' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing
  FROM platform.feature_rollout_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing.rollout_id IS DISTINCT FROM p_rollout_id
       OR v_existing.new_status IS DISTINCT FROM p_status
       OR v_existing.new_percentage IS DISTINCT FROM p_rollout_percentage THEN
      RAISE EXCEPTION 'feature rollout replay differs' USING ERRCODE = '23505';
    END IF;
    SELECT rollout.version INTO v_next_version
    FROM platform.feature_rollouts rollout
    WHERE rollout.tenant_id = p_tenant_id AND rollout.id = p_rollout_id;
    RETURN QUERY SELECT p_rollout_id, v_next_version, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_feature_code, 0));
  SELECT * INTO v_rollout
  FROM platform.feature_rollouts
  WHERE tenant_id = p_tenant_id AND feature_code = p_feature_code
  FOR UPDATE;
  IF FOUND THEN
    IF v_rollout.id IS DISTINCT FROM p_rollout_id THEN
      RAISE EXCEPTION 'feature rollout identity conflict' USING ERRCODE = '23505';
    END IF;
    IF p_expected_version IS NULL OR v_rollout.version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'feature rollout version conflict' USING ERRCODE = '40001';
    END IF;
    v_next_version := v_rollout.version + 1;
    UPDATE platform.feature_rollouts
    SET status = p_status, rollout_percentage = p_rollout_percentage,
        reason = p_reason, updated_by = p_actor_id, updated_at = p_observed_at,
        version = v_next_version
    WHERE tenant_id = p_tenant_id AND id = p_rollout_id;
  ELSE
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'new feature rollout must not specify an expected version' USING ERRCODE = '22023';
    END IF;
    v_next_version := 1;
    INSERT INTO platform.feature_rollouts(
      id, tenant_id, feature_code, status, rollout_percentage, reason,
      updated_by, updated_at
    ) VALUES (
      p_rollout_id, p_tenant_id, p_feature_code, p_status,
      p_rollout_percentage, p_reason, p_actor_id, p_observed_at
    );
  END IF;

  INSERT INTO platform.feature_rollout_events(
    id, tenant_id, rollout_id, prior_status, new_status, prior_percentage,
    new_percentage, actor_id, observed_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_rollout_id,
    CASE WHEN v_rollout.id IS NULL THEN NULL ELSE v_rollout.status END,
    p_status,
    CASE WHEN v_rollout.id IS NULL THEN NULL ELSE v_rollout.rollout_percentage END,
    p_rollout_percentage, p_actor_id, p_observed_at, p_request_id, p_trace_id
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.feature_rollout.changed.v1',
    'saas.feature_rollout.set', 'success', p_actor_id, 'saas.feature_rollout',
    p_rollout_id::text, p_reason, p_request_id, p_trace_id,
    jsonb_build_object('featureCode', p_feature_code, 'status', p_status,
      'percentage', p_rollout_percentage, 'version', v_next_version),
    p_observed_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.feature_rollout.changed.v1',
    'saas.feature_rollout', p_rollout_id::text, '1.0',
    jsonb_build_object('featureCode', p_feature_code, 'status', p_status,
      'percentage', p_rollout_percentage, 'version', v_next_version),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );
  RETURN QUERY SELECT p_rollout_id, v_next_version, false;
END $$;

CREATE OR REPLACE FUNCTION platform.open_support_incident(
  p_event_id uuid,
  p_incident_id uuid,
  p_tenant_id uuid,
  p_incident_code text,
  p_severity text,
  p_summary text,
  p_actor_id uuid,
  p_opened_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(incident_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_existing platform.support_incident_events%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_incident_code !~ '^[A-Z][A-Z0-9-]{2,63}$'
     OR p_severity NOT IN ('low','medium','high','critical')
     OR btrim(p_summary) = '' THEN
    RAISE EXCEPTION 'support incident input is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing
  FROM platform.support_incident_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing.incident_id IS DISTINCT FROM p_incident_id
       OR v_existing.new_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'support incident replay differs' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT p_incident_id, true;
    RETURN;
  END IF;

  INSERT INTO platform.support_incidents(
    id, tenant_id, incident_code, severity, status, summary, opened_by, opened_at
  ) VALUES (
    p_incident_id, p_tenant_id, p_incident_code, p_severity, 'open',
    p_summary, p_actor_id, p_opened_at
  );
  INSERT INTO platform.support_incident_events(
    id, tenant_id, incident_id, prior_status, new_status, note, actor_id,
    observed_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_incident_id, NULL, 'open', p_summary,
    p_actor_id, p_opened_at, p_request_id, p_trace_id
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_incident.opened.v1',
    'saas.support_incident.open', 'success', p_actor_id, 'saas.support_incident',
    p_incident_id::text, p_request_id, p_trace_id,
    jsonb_build_object('incidentCode', p_incident_code, 'severity', p_severity),
    p_opened_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_incident.opened.v1',
    'saas.support_incident', p_incident_id::text, '1.0',
    jsonb_build_object('incidentCode', p_incident_code, 'severity', p_severity,
      'status', 'open'),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_opened_at, p_business_date
  );
  RETURN QUERY SELECT p_incident_id, false;
END $$;

CREATE OR REPLACE FUNCTION platform.transition_support_incident(
  p_event_id uuid,
  p_tenant_id uuid,
  p_incident_id uuid,
  p_expected_version bigint,
  p_new_status text,
  p_note text,
  p_actor_id uuid,
  p_observed_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(status text, version bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_incident platform.support_incidents%ROWTYPE;
  v_existing platform.support_incident_events%ROWTYPE;
  v_allowed boolean;
  v_next_version bigint;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM platform.support_incident_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing.incident_id IS DISTINCT FROM p_incident_id
       OR v_existing.new_status IS DISTINCT FROM p_new_status THEN
      RAISE EXCEPTION 'support incident transition replay differs' USING ERRCODE = '23505';
    END IF;
    SELECT incident.version INTO v_next_version
    FROM platform.support_incidents incident
    WHERE incident.tenant_id = p_tenant_id AND incident.id = p_incident_id;
    RETURN QUERY SELECT v_existing.new_status, v_next_version, true;
    RETURN;
  END IF;

  SELECT * INTO v_incident
  FROM platform.support_incidents
  WHERE tenant_id = p_tenant_id AND id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support incident not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_incident.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'support incident version conflict' USING ERRCODE = '40001';
  END IF;
  v_allowed := CASE v_incident.status
    WHEN 'open' THEN p_new_status IN ('investigating','resolved')
    WHEN 'investigating' THEN p_new_status IN ('monitoring','resolved')
    WHEN 'monitoring' THEN p_new_status IN ('investigating','resolved')
    WHEN 'resolved' THEN p_new_status IN ('investigating','closed')
    ELSE false
  END;
  IF NOT v_allowed OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'invalid support incident transition' USING ERRCODE = '22023';
  END IF;

  v_next_version := v_incident.version + 1;
  UPDATE platform.support_incidents
  SET status = p_new_status,
      resolved_at = CASE WHEN p_new_status = 'resolved' THEN p_observed_at
                         WHEN p_new_status = 'investigating' THEN NULL ELSE resolved_at END,
      version = v_next_version
  WHERE tenant_id = p_tenant_id AND id = p_incident_id;
  INSERT INTO platform.support_incident_events(
    id, tenant_id, incident_id, prior_status, new_status, note, actor_id,
    observed_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_incident_id, v_incident.status, p_new_status,
    p_note, p_actor_id, p_observed_at, p_request_id, p_trace_id
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_incident.changed.v1',
    'saas.support_incident.transition', p_new_status, p_actor_id,
    'saas.support_incident', p_incident_id::text, p_request_id, p_trace_id,
    jsonb_build_object('priorStatus', v_incident.status, 'newStatus', p_new_status,
      'version', v_next_version),
    p_observed_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.support_incident.changed.v1',
    'saas.support_incident', p_incident_id::text, '1.0',
    jsonb_build_object('priorStatus', v_incident.status, 'newStatus', p_new_status,
      'severity', v_incident.severity, 'version', v_next_version),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );
  RETURN QUERY SELECT p_new_status, v_next_version, false;
END $$;

REVOKE ALL ON FUNCTION platform.issue_support_impersonation_grant(
  uuid,uuid,uuid,uuid,text,text[],timestamptz,timestamptz,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.record_support_impersonation_use(
  uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.revoke_support_impersonation_grant(
  uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.set_feature_rollout(
  uuid,uuid,uuid,text,text,smallint,text,bigint,uuid,timestamptz,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.open_support_incident(
  uuid,uuid,uuid,text,text,text,uuid,timestamptz,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.transition_support_incident(
  uuid,uuid,uuid,bigint,text,text,uuid,timestamptz,text,text,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.issue_support_impersonation_grant(
  uuid,uuid,uuid,uuid,text,text[],timestamptz,timestamptz,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.record_support_impersonation_use(
  uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.revoke_support_impersonation_grant(
  uuid,uuid,uuid,bigint,uuid,text,timestamptz,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.set_feature_rollout(
  uuid,uuid,uuid,text,text,smallint,text,bigint,uuid,timestamptz,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.open_support_incident(
  uuid,uuid,uuid,text,text,text,uuid,timestamptz,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.transition_support_incident(
  uuid,uuid,uuid,bigint,text,text,uuid,timestamptz,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0007','MOD-G-INTEGRATION','manifest:INT-0007-saas-support-controls.sql');

COMMIT;
