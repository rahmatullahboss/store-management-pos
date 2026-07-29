BEGIN;

ALTER TABLE integration.webhook_subscriptions
  ADD COLUMN idempotency_key text NOT NULL,
  ADD COLUMN request_hash text NOT NULL,
  ADD CONSTRAINT webhook_subscriptions_idempotency_unique UNIQUE (tenant_id, idempotency_key);

ALTER TABLE integration.connector_connections
  ADD COLUMN idempotency_key text NOT NULL,
  ADD COLUMN request_hash text NOT NULL,
  ADD CONSTRAINT connector_connections_idempotency_unique UNIQUE (tenant_id, idempotency_key);

CREATE OR REPLACE FUNCTION integration.create_webhook_subscription(
  p_id uuid,
  p_tenant_id uuid,
  p_endpoint_url text,
  p_event_types text[],
  p_signing_key_reference text,
  p_signature_version text,
  p_max_attempts integer,
  p_created_by uuid,
  p_created_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(subscription_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_existing integration.webhook_subscriptions%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.webhook_subscriptions
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'webhook subscription idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO integration.webhook_subscriptions(
    id, tenant_id, endpoint_url, event_types, signing_key_reference,
    signature_version, max_attempts, created_by, created_at,
    idempotency_key, request_hash
  ) VALUES (
    p_id, p_tenant_id, p_endpoint_url, p_event_types, p_signing_key_reference,
    p_signature_version, p_max_attempts, p_created_by, p_created_at,
    p_idempotency_key, p_request_hash
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.subscription_created.v1',
    'integration.webhook.subscription.create', 'success', p_created_by,
    'integration.webhook_subscription', p_id::text, p_request_id, p_trace_id,
    jsonb_build_object('eventTypes', p_event_types, 'signatureVersion', p_signature_version, 'maxAttempts', p_max_attempts),
    p_created_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.subscription_created.v1',
    'integration.webhook_subscription', p_id::text, '1.0',
    jsonb_build_object('eventTypes', p_event_types, 'signatureVersion', p_signature_version, 'maxAttempts', p_max_attempts),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_created_at, p_business_date
  );

  RETURN QUERY SELECT p_id, false;
END $$;

CREATE OR REPLACE FUNCTION integration.enqueue_webhook_delivery(
  p_delivery_id uuid,
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_source_event_id text,
  p_source_event_type text,
  p_payload jsonb,
  p_payload_hash text,
  p_created_at timestamptz,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(delivery_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_subscription integration.webhook_subscriptions%ROWTYPE;
  v_existing integration.webhook_deliveries%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.webhook_deliveries
  WHERE tenant_id = p_tenant_id
    AND subscription_id = p_subscription_id
    AND source_event_id = p_source_event_id;
  IF FOUND THEN
    IF v_existing.payload_hash IS DISTINCT FROM p_payload_hash
       OR v_existing.source_event_type IS DISTINCT FROM p_source_event_type THEN
      RAISE EXCEPTION 'webhook delivery replay payload differs' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  SELECT * INTO v_subscription
  FROM integration.webhook_subscriptions
  WHERE tenant_id = p_tenant_id AND id = p_subscription_id
  FOR SHARE;
  IF NOT FOUND OR v_subscription.status <> 'active' THEN
    RAISE EXCEPTION 'active webhook subscription not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (p_source_event_type = ANY(v_subscription.event_types)) THEN
    RAISE EXCEPTION 'webhook subscription does not accept event type' USING ERRCODE = '22023';
  END IF;

  INSERT INTO integration.webhook_deliveries(
    id, tenant_id, subscription_id, source_event_id, source_event_type,
    payload, payload_hash, signature_version, status, created_at
  ) VALUES (
    p_delivery_id, p_tenant_id, p_subscription_id, p_source_event_id, p_source_event_type,
    p_payload, p_payload_hash, v_subscription.signature_version, 'queued', p_created_at
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.delivery_queued.v1',
    'integration.webhook.enqueue', 'success', p_actor_id,
    'integration.webhook_delivery', p_delivery_id::text, p_request_id, p_trace_id,
    jsonb_build_object('subscriptionId', p_subscription_id, 'sourceEventId', p_source_event_id, 'sourceEventType', p_source_event_type),
    p_created_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.delivery_queued.v1',
    'integration.webhook_delivery', p_delivery_id::text, '1.0',
    jsonb_build_object('subscriptionId', p_subscription_id, 'sourceEventId', p_source_event_id, 'sourceEventType', p_source_event_type),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_source_event_id, p_created_at, p_business_date
  );

  RETURN QUERY SELECT p_delivery_id, false;
END $$;

CREATE OR REPLACE FUNCTION integration.record_webhook_attempt(
  p_attempt_id uuid,
  p_tenant_id uuid,
  p_delivery_id uuid,
  p_request_hash text,
  p_response_code integer,
  p_outcome text,
  p_error_category text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_next_attempt_at timestamptz,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(status text, attempt_number integer, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_delivery integration.webhook_deliveries%ROWTYPE;
  v_subscription integration.webhook_subscriptions%ROWTYPE;
  v_existing integration.webhook_delivery_attempts%ROWTYPE;
  v_attempt_number integer;
  v_status text;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.webhook_delivery_attempts
  WHERE tenant_id = p_tenant_id AND id = p_attempt_id;
  IF FOUND THEN
    IF v_existing.delivery_id IS DISTINCT FROM p_delivery_id
       OR v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.outcome IS DISTINCT FROM p_outcome THEN
      RAISE EXCEPTION 'webhook attempt replay payload differs' USING ERRCODE = '23505';
    END IF;
    SELECT d.status INTO v_status
    FROM integration.webhook_deliveries d
    WHERE d.tenant_id = p_tenant_id AND d.id = p_delivery_id;
    RETURN QUERY SELECT v_status, v_existing.attempt_number, true;
    RETURN;
  END IF;

  SELECT * INTO v_delivery
  FROM integration.webhook_deliveries
  WHERE tenant_id = p_tenant_id AND id = p_delivery_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webhook delivery not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_delivery.status NOT IN ('queued','retry_wait','delivering') THEN
    RAISE EXCEPTION 'webhook delivery is terminal' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_subscription
  FROM integration.webhook_subscriptions
  WHERE tenant_id = p_tenant_id AND id = v_delivery.subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'P0002';
  END IF;

  v_attempt_number := v_delivery.attempt_count + 1;
  v_status := CASE p_outcome
    WHEN 'delivered' THEN 'delivered'
    WHEN 'dead_letter' THEN 'dead_letter'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'retry' THEN CASE WHEN v_attempt_number >= v_subscription.max_attempts THEN 'dead_letter' ELSE 'retry_wait' END
    WHEN 'network_error' THEN CASE WHEN v_attempt_number >= v_subscription.max_attempts THEN 'dead_letter' ELSE 'retry_wait' END
    WHEN 'timeout' THEN CASE WHEN v_attempt_number >= v_subscription.max_attempts THEN 'dead_letter' ELSE 'retry_wait' END
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'unsupported webhook attempt outcome' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'retry_wait' AND p_next_attempt_at IS NULL THEN
    RAISE EXCEPTION 'retrying webhook requires next attempt time' USING ERRCODE = '22023';
  END IF;

  INSERT INTO integration.webhook_delivery_attempts(
    id, tenant_id, delivery_id, attempt_number, request_hash, response_code,
    outcome, error_category, started_at, completed_at, request_id, trace_id
  ) VALUES (
    p_attempt_id, p_tenant_id, p_delivery_id, v_attempt_number, p_request_hash, p_response_code,
    p_outcome, p_error_category, p_started_at, p_completed_at, p_request_id, p_trace_id
  );

  UPDATE integration.webhook_deliveries
  SET status = v_status,
      attempt_count = v_attempt_number,
      next_attempt_at = CASE WHEN v_status = 'retry_wait' THEN p_next_attempt_at ELSE NULL END,
      delivered_at = CASE WHEN v_status = 'delivered' THEN p_completed_at ELSE delivered_at END,
      last_response_code = p_response_code,
      last_error_category = p_error_category,
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_delivery_id;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.attempt_recorded.v1',
    'integration.webhook.attempt', v_status, p_actor_id,
    'integration.webhook_delivery', p_delivery_id::text, p_request_id, p_trace_id,
    jsonb_build_object('attemptNumber', v_attempt_number, 'outcome', p_outcome, 'status', v_status, 'responseCode', p_response_code),
    p_completed_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.attempt_recorded.v1',
    'integration.webhook_delivery', p_delivery_id::text, '1.0',
    jsonb_build_object('attemptNumber', v_attempt_number, 'outcome', p_outcome, 'status', v_status),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_completed_at, p_business_date
  );

  RETURN QUERY SELECT v_status, v_attempt_number, false;
END $$;

CREATE OR REPLACE FUNCTION integration.request_webhook_replay(
  p_replay_id uuid,
  p_tenant_id uuid,
  p_delivery_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_reason text,
  p_requested_by uuid,
  p_requested_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(replay_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_delivery integration.webhook_deliveries%ROWTYPE;
  v_existing integration.webhook_replay_requests%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.webhook_replay_requests
  WHERE tenant_id = p_tenant_id
    AND delivery_id = p_delivery_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'webhook replay idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  SELECT * INTO v_delivery
  FROM integration.webhook_deliveries
  WHERE tenant_id = p_tenant_id AND id = p_delivery_id
  FOR SHARE;
  IF NOT FOUND OR v_delivery.status <> 'dead_letter' THEN
    RAISE EXCEPTION 'only dead-letter webhook deliveries can be replayed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO integration.webhook_replay_requests(
    id, tenant_id, delivery_id, idempotency_key, request_hash,
    reason, requested_by, requested_at, request_id, trace_id
  ) VALUES (
    p_replay_id, p_tenant_id, p_delivery_id, p_idempotency_key, p_request_hash,
    p_reason, p_requested_by, p_requested_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.replay_requested.v1',
    'integration.webhook.replay', 'success', p_requested_by,
    'integration.webhook_delivery', p_delivery_id::text, p_reason,
    p_request_id, p_trace_id, jsonb_build_object('replayId', p_replay_id),
    p_requested_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.webhook.replay_requested.v1',
    'integration.webhook_delivery', p_delivery_id::text, '1.0',
    jsonb_build_object('replayId', p_replay_id),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_requested_at, p_business_date
  );

  RETURN QUERY SELECT p_replay_id, false;
END $$;

CREATE OR REPLACE FUNCTION integration.register_connector_connection(
  p_id uuid,
  p_tenant_id uuid,
  p_connector_type text,
  p_provider_key text,
  p_display_name text,
  p_credential_reference text,
  p_configuration jsonb,
  p_created_by uuid,
  p_created_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(connection_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_existing integration.connector_connections%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.connector_connections
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'connector registration idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO integration.connector_connections(
    id, tenant_id, connector_type, provider_key, display_name, credential_reference,
    configuration, status, created_by, created_at, idempotency_key, request_hash
  ) VALUES (
    p_id, p_tenant_id, p_connector_type, p_provider_key, p_display_name, p_credential_reference,
    p_configuration, 'active', p_created_by, p_created_at, p_idempotency_key, p_request_hash
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.connector.registered.v1',
    'integration.connector.register', 'success', p_created_by,
    'integration.connector_connection', p_id::text, p_request_id, p_trace_id,
    jsonb_build_object('connectorType', p_connector_type, 'providerKey', p_provider_key),
    p_created_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.connector.registered.v1',
    'integration.connector_connection', p_id::text, '1.0',
    jsonb_build_object('connectorType', p_connector_type, 'providerKey', p_provider_key),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_created_at, p_business_date
  );

  RETURN QUERY SELECT p_id, false;
END $$;

CREATE OR REPLACE FUNCTION integration.add_connector_mapping(
  p_id uuid,
  p_tenant_id uuid,
  p_connection_id uuid,
  p_resource_type text,
  p_platform_field text,
  p_external_field text,
  p_ownership text,
  p_direction text,
  p_transform_version text,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(mapping_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_existing integration.connector_field_mappings%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.connector_field_mappings
  WHERE tenant_id = p_tenant_id AND id = p_id;
  IF FOUND THEN
    IF v_existing.connection_id IS DISTINCT FROM p_connection_id
       OR v_existing.resource_type IS DISTINCT FROM p_resource_type
       OR v_existing.platform_field IS DISTINCT FROM p_platform_field
       OR v_existing.external_field IS DISTINCT FROM p_external_field
       OR v_existing.ownership IS DISTINCT FROM p_ownership
       OR v_existing.direction IS DISTINCT FROM p_direction
       OR v_existing.transform_version IS DISTINCT FROM p_transform_version THEN
      RAISE EXCEPTION 'connector mapping replay payload differs' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM integration.connector_connections
    WHERE tenant_id = p_tenant_id AND id = p_connection_id AND status IN ('active','degraded','paused')
  ) THEN
    RAISE EXCEPTION 'connector connection not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO integration.connector_field_mappings(
    id, tenant_id, connection_id, resource_type, platform_field, external_field,
    ownership, direction, transform_version
  ) VALUES (
    p_id, p_tenant_id, p_connection_id, p_resource_type, p_platform_field, p_external_field,
    p_ownership, p_direction, p_transform_version
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.connector.mapping_added.v1',
    'integration.connector.mapping.add', 'success', p_actor_id,
    'integration.connector_connection', p_connection_id::text, p_request_id, p_trace_id,
    jsonb_build_object(
      'mappingId', p_id,
      'resourceType', p_resource_type,
      'platformField', p_platform_field,
      'externalField', p_external_field,
      'ownership', p_ownership,
      'direction', p_direction,
      'transformVersion', p_transform_version
    ),
    now(), p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.connector.mapping_added.v1',
    'integration.connector_connection', p_connection_id::text, '1.0',
    jsonb_build_object(
      'mappingId', p_id,
      'resourceType', p_resource_type,
      'platformField', p_platform_field,
      'externalField', p_external_field,
      'ownership', p_ownership,
      'direction', p_direction,
      'transformVersion', p_transform_version
    ),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, now(), p_business_date
  );

  RETURN QUERY SELECT p_id, false;
END $$;

CREATE OR REPLACE FUNCTION integration.record_connector_sync_outcome(
  p_outcome_id uuid,
  p_cursor_id uuid,
  p_tenant_id uuid,
  p_connection_id uuid,
  p_resource_type text,
  p_direction text,
  p_operation_id text,
  p_request_hash text,
  p_status text,
  p_platform_reference text,
  p_external_reference text,
  p_reason_code text,
  p_cursor text,
  p_last_external_id text,
  p_last_event_id text,
  p_observed_at timestamptz,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(sync_outcome_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_connection integration.connector_connections%ROWTYPE;
  v_existing integration.connector_sync_outcomes%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM integration.connector_sync_outcomes
  WHERE tenant_id = p_tenant_id
    AND connection_id = p_connection_id
    AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.status IS DISTINCT FROM p_status THEN
      RAISE EXCEPTION 'connector sync replay payload differs' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  SELECT * INTO v_connection
  FROM integration.connector_connections
  WHERE tenant_id = p_tenant_id AND id = p_connection_id
  FOR UPDATE;
  IF NOT FOUND OR v_connection.status NOT IN ('active','degraded') THEN
    RAISE EXCEPTION 'active connector connection not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO integration.connector_sync_outcomes(
    id, tenant_id, connection_id, resource_type, operation_id, request_hash,
    status, platform_reference, external_reference, reason_code,
    observed_at, request_id, trace_id
  ) VALUES (
    p_outcome_id, p_tenant_id, p_connection_id, p_resource_type, p_operation_id, p_request_hash,
    p_status, p_platform_reference, p_external_reference, p_reason_code,
    p_observed_at, p_request_id, p_trace_id
  );

  IF p_status = 'applied' AND p_cursor IS NOT NULL THEN
    INSERT INTO integration.connector_cursors(
      id, tenant_id, connection_id, resource_type, direction, cursor,
      last_external_id, last_event_id, updated_at
    ) VALUES (
      p_cursor_id, p_tenant_id, p_connection_id, p_resource_type, p_direction, p_cursor,
      p_last_external_id, p_last_event_id, p_observed_at
    )
    ON CONFLICT (tenant_id, connection_id, resource_type, direction)
    DO UPDATE SET
      cursor = EXCLUDED.cursor,
      last_external_id = EXCLUDED.last_external_id,
      last_event_id = EXCLUDED.last_event_id,
      updated_at = EXCLUDED.updated_at,
      version = integration.connector_cursors.version + 1;
  END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.connector.sync_outcome_recorded.v1',
    'integration.connector.sync', p_status, p_actor_id,
    'integration.connector_connection', p_connection_id::text, p_request_id, p_trace_id,
    jsonb_build_object(
      'resourceType', p_resource_type,
      'direction', p_direction,
      'operationId', p_operation_id,
      'status', p_status,
      'reasonCode', p_reason_code
    ),
    p_observed_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.connector.sync_outcome_recorded.v1',
    'integration.connector_connection', p_connection_id::text, '1.0',
    jsonb_build_object(
      'resourceType', p_resource_type,
      'direction', p_direction,
      'operationId', p_operation_id,
      'status', p_status,
      'reasonCode', p_reason_code
    ),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );

  RETURN QUERY SELECT p_outcome_id, false;
END $$;

REVOKE ALL ON FUNCTION integration.create_webhook_subscription(
  uuid,uuid,text,text[],text,text,integer,uuid,timestamptz,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.enqueue_webhook_delivery(
  uuid,uuid,uuid,text,text,jsonb,text,timestamptz,uuid,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.record_webhook_attempt(
  uuid,uuid,uuid,text,integer,text,text,timestamptz,timestamptz,timestamptz,
  uuid,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.request_webhook_replay(
  uuid,uuid,uuid,text,text,text,uuid,timestamptz,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.register_connector_connection(
  uuid,uuid,text,text,text,text,jsonb,uuid,timestamptz,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.add_connector_mapping(
  uuid,uuid,uuid,text,text,text,text,text,text,uuid,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.record_connector_sync_outcome(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,uuid,text,text,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION integration.create_webhook_subscription(
  uuid,uuid,text,text[],text,text,integer,uuid,timestamptz,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.enqueue_webhook_delivery(
  uuid,uuid,uuid,text,text,jsonb,text,timestamptz,uuid,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.record_webhook_attempt(
  uuid,uuid,uuid,text,integer,text,text,timestamptz,timestamptz,timestamptz,
  uuid,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.request_webhook_replay(
  uuid,uuid,uuid,text,text,text,uuid,timestamptz,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.register_connector_connection(
  uuid,uuid,text,text,text,text,jsonb,uuid,timestamptz,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.add_connector_mapping(
  uuid,uuid,uuid,text,text,text,text,text,text,uuid,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.record_connector_sync_outcome(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,
  timestamptz,uuid,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0002','MOD-G-INTEGRATION','manifest:INT-0002-integration-commands.sql');

COMMIT;
