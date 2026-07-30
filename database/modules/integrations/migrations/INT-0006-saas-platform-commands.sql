BEGIN;

CREATE OR REPLACE FUNCTION platform.publish_saas_plan(
  p_plan_definition_id uuid,
  p_audit_tenant_id uuid,
  p_plan_id text,
  p_version text,
  p_display_name text,
  p_status text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_entitlements jsonb,
  p_published_by uuid,
  p_published_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(plan_definition_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_existing platform.saas_plan_definitions%ROWTYPE;
BEGIN
  IF p_audit_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_plan_id !~ '^[a-z][a-z0-9_.-]{2,127}$'
     OR btrim(p_version) = '' OR btrim(p_display_name) = '' THEN
    RAISE EXCEPTION 'SaaS plan identity is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('draft','active','retired') THEN
    RAISE EXCEPTION 'SaaS plan status is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_effective_to IS NOT NULL AND p_effective_to <= p_effective_from THEN
    RAISE EXCEPTION 'SaaS plan effective end must follow start' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_entitlements) <> 'array' OR jsonb_array_length(p_entitlements) = 0 THEN
    RAISE EXCEPTION 'SaaS plan requires a non-empty entitlement array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_entitlements) AS entitlement(
      entitlement_code text, value_type text, entitlement_value text,
      enforcement text, reset_period text
    )
    WHERE entitlement_code !~ '^[a-z][a-z0-9_.-]{2,127}$'
       OR value_type NOT IN ('boolean','integer','string')
       OR enforcement NOT IN ('hard','soft','observe')
       OR (reset_period IS NOT NULL AND reset_period NOT IN ('day','month','year'))
       OR btrim(entitlement_value) = ''
       OR (value_type = 'boolean' AND entitlement_value NOT IN ('true','false'))
       OR (value_type = 'integer' AND entitlement_value !~ '^[0-9]+$')
  ) THEN
    RAISE EXCEPTION 'SaaS plan entitlement is invalid' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT entitlement_code)
    FROM jsonb_to_recordset(p_entitlements) AS entitlement(entitlement_code text)
  ) THEN
    RAISE EXCEPTION 'SaaS plan entitlement codes must be unique' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform.saas_plan_definitions
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.plan_id IS DISTINCT FROM p_plan_id
       OR v_existing.version IS DISTINCT FROM p_version THEN
      RAISE EXCEPTION 'SaaS plan idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO platform.saas_plan_definitions(
    id, plan_id, version, display_name, status, effective_from, effective_to,
    published_by, published_at, idempotency_key, request_hash
  ) VALUES (
    p_plan_definition_id, p_plan_id, p_version, p_display_name, p_status,
    p_effective_from, p_effective_to, p_published_by, p_published_at,
    p_idempotency_key, p_request_hash
  );

  INSERT INTO platform.saas_plan_entitlements(
    id, plan_definition_id, entitlement_code, value_type, entitlement_value,
    enforcement, reset_period
  )
  SELECT gen_random_uuid(), p_plan_definition_id, entitlement_code, value_type,
         entitlement_value, enforcement, reset_period
  FROM jsonb_to_recordset(p_entitlements) AS entitlement(
    entitlement_code text, value_type text, entitlement_value text,
    enforcement text, reset_period text
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_audit_tenant_id, 'saas.plan.published.v1',
    'saas.plan.publish', 'success', p_published_by, 'saas.plan_definition',
    p_plan_definition_id::text, p_request_id, p_trace_id,
    jsonb_build_object('planId', p_plan_id, 'version', p_version, 'status', p_status,
      'entitlementCount', jsonb_array_length(p_entitlements)),
    p_published_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_audit_tenant_id, 'saas.plan.published.v1',
    'saas.plan_definition', p_plan_definition_id::text, '1.0',
    jsonb_build_object('planId', p_plan_id, 'version', p_version, 'status', p_status),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_published_at, p_business_date
  );

  RETURN QUERY SELECT p_plan_definition_id, false;
END $$;

CREATE OR REPLACE FUNCTION platform.assign_tenant_subscription(
  p_subscription_id uuid,
  p_tenant_id uuid,
  p_plan_definition_id uuid,
  p_status text,
  p_started_at timestamptz,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(subscription_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_existing platform.tenant_subscriptions%ROWTYPE;
  v_plan platform.saas_plan_definitions%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('trial','active') THEN
    RAISE EXCEPTION 'new subscription status must be trial or active' USING ERRCODE = '22023';
  END IF;
  IF p_period_end <= p_period_start OR p_started_at > p_period_start THEN
    RAISE EXCEPTION 'subscription period is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform.tenant_subscriptions
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.plan_definition_id IS DISTINCT FROM p_plan_definition_id THEN
      RAISE EXCEPTION 'subscription assignment idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  IF EXISTS (SELECT 1 FROM platform.tenant_subscriptions WHERE tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'tenant already has a subscription' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_plan
  FROM platform.saas_plan_definitions
  WHERE id = p_plan_definition_id;
  IF NOT FOUND OR v_plan.status <> 'active'
     OR p_period_start < v_plan.effective_from
     OR (v_plan.effective_to IS NOT NULL AND p_period_start >= v_plan.effective_to) THEN
    RAISE EXCEPTION 'active SaaS plan is not available for subscription period' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.tenant_subscriptions(
    id, tenant_id, plan_definition_id, status, started_at, current_period_start,
    current_period_end, idempotency_key, request_hash
  ) VALUES (
    p_subscription_id, p_tenant_id, p_plan_definition_id, p_status, p_started_at,
    p_period_start, p_period_end, p_idempotency_key, p_request_hash
  );

  INSERT INTO platform.tenant_subscription_events(
    id, tenant_id, subscription_id, command, prior_status, new_status,
    prior_plan_definition_id, new_plan_definition_id, idempotency_key,
    request_hash, actor_id, observed_at, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_subscription_id, 'assign', NULL, p_status,
    NULL, p_plan_definition_id, p_idempotency_key, p_request_hash, p_actor_id,
    p_started_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.subscription.assigned.v1',
    'saas.subscription.assign', 'success', p_actor_id, 'saas.subscription',
    p_subscription_id::text, p_request_id, p_trace_id,
    jsonb_build_object('planDefinitionId', p_plan_definition_id, 'status', p_status,
      'periodStart', p_period_start, 'periodEnd', p_period_end),
    p_started_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.subscription.assigned.v1',
    'saas.subscription', p_subscription_id::text, '1.0',
    jsonb_build_object('planDefinitionId', p_plan_definition_id, 'status', p_status,
      'periodStart', p_period_start, 'periodEnd', p_period_end),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_started_at, p_business_date
  );

  RETURN QUERY SELECT p_subscription_id, false;
END $$;

CREATE OR REPLACE FUNCTION platform.transition_tenant_subscription(
  p_event_id uuid,
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_expected_version bigint,
  p_command text,
  p_new_plan_definition_id uuid,
  p_new_period_start timestamptz,
  p_new_period_end timestamptz,
  p_actor_id uuid,
  p_observed_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(status text, version bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_subscription platform.tenant_subscriptions%ROWTYPE;
  v_existing platform.tenant_subscription_events%ROWTYPE;
  v_next_status text;
  v_plan_id uuid;
  v_next_version bigint;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM platform.tenant_subscription_events
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.subscription_id IS DISTINCT FROM p_subscription_id
       OR v_existing.command IS DISTINCT FROM p_command THEN
      RAISE EXCEPTION 'subscription transition idempotency conflict' USING ERRCODE = '23505';
    END IF;
    SELECT s.version INTO v_next_version
    FROM platform.tenant_subscriptions s
    WHERE s.tenant_id = p_tenant_id AND s.id = p_subscription_id;
    RETURN QUERY SELECT v_existing.new_status, v_next_version, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_subscription_id::text, 0));
  SELECT * INTO v_subscription
  FROM platform.tenant_subscriptions
  WHERE tenant_id = p_tenant_id AND id = p_subscription_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant subscription not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_subscription.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'tenant subscription version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_subscription.status = 'cancelled' THEN
    RAISE EXCEPTION 'cancelled tenant subscription is terminal' USING ERRCODE = '22023';
  END IF;

  v_next_status := CASE v_subscription.status
    WHEN 'trial' THEN CASE p_command WHEN 'activate' THEN 'active' WHEN 'suspend' THEN 'suspended' WHEN 'cancel' THEN 'cancelled' END
    WHEN 'active' THEN CASE p_command WHEN 'mark_past_due' THEN 'past_due' WHEN 'suspend' THEN 'suspended' WHEN 'cancel' THEN 'cancelled' WHEN 'change_plan' THEN 'active' END
    WHEN 'past_due' THEN CASE p_command WHEN 'activate' THEN 'active' WHEN 'suspend' THEN 'suspended' WHEN 'cancel' THEN 'cancelled' WHEN 'change_plan' THEN 'past_due' END
    WHEN 'suspended' THEN CASE p_command WHEN 'resume' THEN 'active' WHEN 'cancel' THEN 'cancelled' WHEN 'change_plan' THEN 'suspended' END
    ELSE NULL
  END;
  IF v_next_status IS NULL THEN
    RAISE EXCEPTION 'invalid tenant subscription transition' USING ERRCODE = '22023';
  END IF;

  v_plan_id := COALESCE(p_new_plan_definition_id, v_subscription.plan_definition_id);
  IF p_command = 'change_plan' THEN
    IF p_new_plan_definition_id IS NULL THEN
      RAISE EXCEPTION 'change_plan requires a new plan definition' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM platform.saas_plan_definitions plan
      WHERE plan.id = p_new_plan_definition_id AND plan.status = 'active'
        AND p_observed_at >= plan.effective_from
        AND (plan.effective_to IS NULL OR p_observed_at < plan.effective_to)
    ) THEN
      RAISE EXCEPTION 'new SaaS plan is not active' USING ERRCODE = '22023';
    END IF;
  ELSIF p_new_plan_definition_id IS NOT NULL THEN
    RAISE EXCEPTION 'new plan definition is only valid for change_plan' USING ERRCODE = '22023';
  END IF;

  IF (p_new_period_start IS NULL) <> (p_new_period_end IS NULL) THEN
    RAISE EXCEPTION 'subscription period boundaries must be supplied together' USING ERRCODE = '22023';
  END IF;
  IF p_new_period_start IS NOT NULL AND p_new_period_end <= p_new_period_start THEN
    RAISE EXCEPTION 'subscription period is invalid' USING ERRCODE = '22023';
  END IF;

  v_next_version := v_subscription.version + 1;
  UPDATE platform.tenant_subscriptions
  SET plan_definition_id = v_plan_id,
      status = v_next_status,
      current_period_start = COALESCE(p_new_period_start, current_period_start),
      current_period_end = COALESCE(p_new_period_end, current_period_end),
      suspended_at = CASE WHEN v_next_status = 'suspended' THEN p_observed_at
                          WHEN p_command = 'resume' THEN NULL ELSE suspended_at END,
      cancelled_at = CASE WHEN v_next_status = 'cancelled' THEN p_observed_at ELSE cancelled_at END,
      version = v_next_version
  WHERE tenant_id = p_tenant_id AND id = p_subscription_id;

  INSERT INTO platform.tenant_subscription_events(
    id, tenant_id, subscription_id, command, prior_status, new_status,
    prior_plan_definition_id, new_plan_definition_id, idempotency_key,
    request_hash, actor_id, observed_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_subscription_id, p_command, v_subscription.status,
    v_next_status, v_subscription.plan_definition_id, v_plan_id,
    p_idempotency_key, p_request_hash, p_actor_id, p_observed_at,
    p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.subscription.changed.v1',
    'saas.subscription.' || p_command, 'success', p_actor_id, 'saas.subscription',
    p_subscription_id::text, p_request_id, p_trace_id,
    jsonb_build_object('priorStatus', v_subscription.status, 'newStatus', v_next_status,
      'priorPlanDefinitionId', v_subscription.plan_definition_id,
      'newPlanDefinitionId', v_plan_id, 'version', v_next_version),
    p_observed_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.subscription.changed.v1',
    'saas.subscription', p_subscription_id::text, '1.0',
    jsonb_build_object('command', p_command, 'priorStatus', v_subscription.status,
      'newStatus', v_next_status, 'planDefinitionId', v_plan_id, 'version', v_next_version),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );

  RETURN QUERY SELECT v_next_status, v_next_version, false;
END $$;

CREATE OR REPLACE FUNCTION platform.record_usage_event(
  p_usage_event_id uuid,
  p_counter_id uuid,
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_meter_code text,
  p_quantity numeric,
  p_source_type text,
  p_source_id text,
  p_source_version text,
  p_occurred_at timestamptz,
  p_business_date date,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text
) RETURNS TABLE(quantity numeric, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_subscription platform.tenant_subscriptions%ROWTYPE;
  v_existing platform.usage_events%ROWTYPE;
  v_quantity numeric;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_meter_code !~ '^[a-z][a-z0-9_.-]{2,127}$'
     OR p_quantity < 0 OR trunc(p_quantity) <> p_quantity THEN
    RAISE EXCEPTION 'usage meter or quantity is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_period_end <= p_period_start
     OR p_occurred_at < p_period_start OR p_occurred_at >= p_period_end THEN
    RAISE EXCEPTION 'usage period is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform.usage_events
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.subscription_id IS DISTINCT FROM p_subscription_id
       OR v_existing.meter_code IS DISTINCT FROM p_meter_code
       OR v_existing.quantity IS DISTINCT FROM p_quantity THEN
      RAISE EXCEPTION 'usage event idempotency conflict' USING ERRCODE = '23505';
    END IF;
    SELECT counter.quantity INTO v_quantity
    FROM platform.usage_counters counter
    WHERE counter.tenant_id = p_tenant_id
      AND counter.subscription_id = p_subscription_id
      AND counter.meter_code = p_meter_code
      AND counter.period_start = p_period_start
      AND counter.period_end = p_period_end;
    RETURN QUERY SELECT COALESCE(v_quantity, 0), true;
    RETURN;
  END IF;

  SELECT * INTO v_subscription
  FROM platform.tenant_subscriptions
  WHERE tenant_id = p_tenant_id AND id = p_subscription_id
  FOR SHARE;
  IF NOT FOUND OR v_subscription.status = 'cancelled'
     OR (v_subscription.status = 'suspended'
         AND v_subscription.suspended_at IS NOT NULL
         AND p_occurred_at >= v_subscription.suspended_at) THEN
    RAISE EXCEPTION 'subscription cannot accept this usage event' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_subscription_id::text || ':' || p_meter_code || ':' || p_period_start::text, 0
  ));

  INSERT INTO platform.usage_events(
    id, tenant_id, subscription_id, meter_code, quantity, source_type, source_id,
    source_version, occurred_at, business_date, period_start, period_end,
    idempotency_key, request_hash, request_id, trace_id
  ) VALUES (
    p_usage_event_id, p_tenant_id, p_subscription_id, p_meter_code, p_quantity,
    p_source_type, p_source_id, p_source_version, p_occurred_at, p_business_date,
    p_period_start, p_period_end, p_idempotency_key, p_request_hash,
    p_request_id, p_trace_id
  );

  INSERT INTO platform.usage_counters(
    id, tenant_id, subscription_id, meter_code, period_start, period_end,
    quantity, last_usage_event_id, updated_at
  ) VALUES (
    p_counter_id, p_tenant_id, p_subscription_id, p_meter_code, p_period_start,
    p_period_end, p_quantity, p_usage_event_id, p_occurred_at
  )
  ON CONFLICT (tenant_id, subscription_id, meter_code, period_start, period_end)
  DO UPDATE SET
    quantity = platform.usage_counters.quantity + EXCLUDED.quantity,
    last_usage_event_id = EXCLUDED.last_usage_event_id,
    updated_at = EXCLUDED.updated_at,
    version = platform.usage_counters.version + 1
  RETURNING platform.usage_counters.quantity INTO v_quantity;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.usage.recorded.v1',
    'saas.usage.record', 'success', 'saas.usage_event', p_usage_event_id::text,
    p_request_id, p_trace_id,
    jsonb_build_object('subscriptionId', p_subscription_id, 'meterCode', p_meter_code,
      'quantity', p_quantity::text, 'counterQuantity', v_quantity::text,
      'sourceType', p_source_type, 'sourceId', p_source_id, 'sourceVersion', p_source_version),
    p_occurred_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.usage.recorded.v1',
    'saas.usage_counter', p_counter_id::text, '1.0',
    jsonb_build_object('subscriptionId', p_subscription_id, 'meterCode', p_meter_code,
      'quantity', p_quantity::text, 'counterQuantity', v_quantity::text,
      'periodStart', p_period_start, 'periodEnd', p_period_end),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_source_id, p_occurred_at, p_business_date
  );

  RETURN QUERY SELECT v_quantity, false;
END $$;

CREATE OR REPLACE FUNCTION platform.request_tenant_lifecycle_job(
  p_job_id uuid,
  p_tenant_id uuid,
  p_operation text,
  p_reason text,
  p_requested_by uuid,
  p_requested_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(job_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_existing platform.tenant_lifecycle_jobs%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_operation NOT IN ('provision','suspend','resume','offboard','export')
     OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'tenant lifecycle request is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing
  FROM platform.tenant_lifecycle_jobs
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.operation IS DISTINCT FROM p_operation THEN
      RAISE EXCEPTION 'tenant lifecycle idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO platform.tenant_lifecycle_jobs(
    id, tenant_id, operation, status, reason, requested_by, requested_at,
    idempotency_key, request_hash
  ) VALUES (
    p_job_id, p_tenant_id, p_operation, 'queued', p_reason, p_requested_by,
    p_requested_at, p_idempotency_key, p_request_hash
  );
  INSERT INTO platform.tenant_lifecycle_job_events(
    id, tenant_id, job_id, prior_status, new_status, actor_id, observed_at,
    request_id, trace_id
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_job_id, NULL, 'queued', p_requested_by,
    p_requested_at, p_request_id, p_trace_id
  );
  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.tenant_lifecycle.requested.v1',
    'saas.tenant_lifecycle.request', 'success', p_requested_by,
    'saas.tenant_lifecycle_job', p_job_id::text, p_reason, p_request_id, p_trace_id,
    jsonb_build_object('operation', p_operation, 'status', 'queued'),
    p_requested_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.tenant_lifecycle.requested.v1',
    'saas.tenant_lifecycle_job', p_job_id::text, '1.0',
    jsonb_build_object('operation', p_operation, 'status', 'queued'),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_requested_at, p_business_date
  );
  RETURN QUERY SELECT p_job_id, false;
END $$;

CREATE OR REPLACE FUNCTION platform.transition_tenant_lifecycle_job(
  p_event_id uuid,
  p_tenant_id uuid,
  p_job_id uuid,
  p_expected_version bigint,
  p_new_status text,
  p_reason_code text,
  p_actor_id uuid,
  p_observed_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, platform AS $$
DECLARE
  v_job platform.tenant_lifecycle_jobs%ROWTYPE;
  v_existing platform.tenant_lifecycle_job_events%ROWTYPE;
  v_allowed boolean;
  v_next_version bigint;
  v_tenant_status text;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM platform.tenant_lifecycle_job_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing.job_id IS DISTINCT FROM p_job_id
       OR v_existing.new_status IS DISTINCT FROM p_new_status THEN
      RAISE EXCEPTION 'tenant lifecycle transition replay differs' USING ERRCODE = '23505';
    END IF;
    SELECT job.version INTO v_next_version
    FROM platform.tenant_lifecycle_jobs job
    WHERE job.tenant_id = p_tenant_id AND job.id = p_job_id;
    RETURN QUERY SELECT v_existing.new_status, v_next_version;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_job_id::text, 0));
  SELECT * INTO v_job
  FROM platform.tenant_lifecycle_jobs
  WHERE tenant_id = p_tenant_id AND id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant lifecycle job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'tenant lifecycle job version conflict' USING ERRCODE = '40001';
  END IF;

  v_allowed := CASE v_job.status
    WHEN 'queued' THEN p_new_status IN ('running','cancelled')
    WHEN 'running' THEN p_new_status IN ('review','completed','failed','cancelled')
    WHEN 'review' THEN p_new_status IN ('running','completed','failed','cancelled')
    WHEN 'failed' THEN p_new_status = 'queued'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid tenant lifecycle transition' USING ERRCODE = '22023';
  END IF;

  v_next_version := v_job.version + 1;
  UPDATE platform.tenant_lifecycle_jobs
  SET status = p_new_status,
      started_at = CASE WHEN p_new_status = 'running' AND started_at IS NULL THEN p_observed_at ELSE started_at END,
      completed_at = CASE WHEN p_new_status IN ('completed','cancelled') THEN p_observed_at ELSE completed_at END,
      version = v_next_version
  WHERE tenant_id = p_tenant_id AND id = p_job_id;

  INSERT INTO platform.tenant_lifecycle_job_events(
    id, tenant_id, job_id, prior_status, new_status, reason_code, actor_id,
    observed_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_job_id, v_job.status, p_new_status,
    p_reason_code, p_actor_id, p_observed_at, p_request_id, p_trace_id
  );

  IF p_new_status = 'completed' THEN
    v_tenant_status := CASE v_job.operation
      WHEN 'provision' THEN 'active'
      WHEN 'suspend' THEN 'suspended'
      WHEN 'resume' THEN 'active'
      WHEN 'offboard' THEN 'offboarding'
      ELSE NULL
    END;
    IF v_tenant_status IS NOT NULL THEN
      UPDATE platform.tenants
      SET status = v_tenant_status, updated_at = p_observed_at, version = version + 1
      WHERE id = p_tenant_id;
    END IF;
  END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.tenant_lifecycle.changed.v1',
    'saas.tenant_lifecycle.transition', p_new_status, p_actor_id,
    'saas.tenant_lifecycle_job', p_job_id::text, p_reason_code,
    p_request_id, p_trace_id,
    jsonb_build_object('operation', v_job.operation, 'priorStatus', v_job.status,
      'newStatus', p_new_status, 'tenantStatus', v_tenant_status, 'version', v_next_version),
    p_observed_at, p_business_date, 'mod-g-v1'
  );
  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'saas.tenant_lifecycle.changed.v1',
    'saas.tenant_lifecycle_job', p_job_id::text, '1.0',
    jsonb_build_object('operation', v_job.operation, 'priorStatus', v_job.status,
      'newStatus', p_new_status, 'tenantStatus', v_tenant_status, 'version', v_next_version),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );

  RETURN QUERY SELECT p_new_status, v_next_version;
END $$;

REVOKE ALL ON FUNCTION platform.publish_saas_plan(
  uuid,uuid,text,text,text,text,timestamptz,timestamptz,jsonb,uuid,timestamptz,
  text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.assign_tenant_subscription(
  uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.transition_tenant_subscription(
  uuid,uuid,uuid,bigint,text,uuid,timestamptz,timestamptz,uuid,timestamptz,
  text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.record_usage_event(
  uuid,uuid,uuid,uuid,text,numeric,text,text,text,timestamptz,date,timestamptz,
  timestamptz,text,text,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.request_tenant_lifecycle_job(
  uuid,uuid,text,text,uuid,timestamptz,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.transition_tenant_lifecycle_job(
  uuid,uuid,uuid,bigint,text,text,uuid,timestamptz,text,text,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.publish_saas_plan(
  uuid,uuid,text,text,text,text,timestamptz,timestamptz,jsonb,uuid,timestamptz,
  text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.assign_tenant_subscription(
  uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,uuid,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.transition_tenant_subscription(
  uuid,uuid,uuid,bigint,text,uuid,timestamptz,timestamptz,uuid,timestamptz,
  text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.record_usage_event(
  uuid,uuid,uuid,uuid,text,numeric,text,text,text,timestamptz,date,timestamptz,
  timestamptz,text,text,text,text
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.request_tenant_lifecycle_job(
  uuid,uuid,text,text,uuid,timestamptz,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.transition_tenant_lifecycle_job(
  uuid,uuid,uuid,bigint,text,text,uuid,timestamptz,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0006','MOD-G-INTEGRATION','manifest:INT-0006-saas-platform-commands.sql');

COMMIT;
