BEGIN;

ALTER TABLE payment.payment_intents ADD COLUMN method_reference text NULL;
ALTER TABLE payment.payment_attempts ADD COLUMN command_amount_minor bigint NULL CHECK (command_amount_minor IS NULL OR command_amount_minor >= 0);
ALTER TABLE payment.refunds ADD COLUMN idempotency_key text NULL;
ALTER TABLE payment.refunds ADD COLUMN request_hash text NULL;
ALTER TABLE payment.settlements ADD COLUMN idempotency_key text NULL;
ALTER TABLE payment.settlements ADD COLUMN request_hash text NULL;
CREATE UNIQUE INDEX payment_refunds_idempotency_unique ON payment.refunds(tenant_id, payment_intent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX payment_settlements_idempotency_unique ON payment.settlements(tenant_id, provider_account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE payment.payment_attempt_results (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payment_attempt_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','declined','failed','ambiguous')),
  resulting_status text NOT NULL CHECK (resulting_status IN ('created','requires_action','authorized','captured','declined','cancelled','unknown','partially_refunded','refunded','charged_back')),
  provider_reference text NULL,
  failure_category text NULL,
  provider_code text NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, payment_attempt_id),
  FOREIGN KEY (tenant_id, payment_attempt_id) REFERENCES payment.payment_attempts(tenant_id, id)
);
ALTER TABLE payment.payment_attempt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment.payment_attempt_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment.payment_attempt_results
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE TRIGGER payment_attempt_results_append_only BEFORE UPDATE OR DELETE ON payment.payment_attempt_results
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
GRANT SELECT ON payment.payment_attempt_results TO store_app_runtime, store_app_reporting;

CREATE OR REPLACE FUNCTION payment.create_intent_v1(
  p_intent_id uuid,
  p_provider_account_id uuid,
  p_source_type text,
  p_source_id text,
  p_source_version text,
  p_currency char(3),
  p_scale smallint,
  p_amount_minor bigint,
  p_method_reference text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  intent_id uuid, provider_account_id uuid, provider_key text, status text,
  currency char(3), scale smallint, amount_minor bigint, captured_minor bigint,
  refunded_minor bigint, method_reference text, provider_reference text,
  version bigint, observed_at timestamptz, replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_store_id uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_register_id uuid := NULLIF(current_setting('app.register_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor <= 0 OR p_scale < 0 OR p_scale > 12 THEN
    RAISE EXCEPTION 'payment amount is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id AND scope = 'payments.intent.create' AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY
      SELECT pi.id, pi.provider_account_id, pa.provider_key, pi.status, pi.currency, pi.scale,
             pi.amount_minor, pi.captured_minor, pi.refunded_minor, pi.method_reference,
             pi.provider_reference, pi.version, pi.last_observed_at, true
        FROM payment.payment_intents pi
        JOIN payment.provider_accounts pa ON pa.tenant_id = pi.tenant_id AND pa.id = pi.provider_account_id
       WHERE pi.tenant_id = v_tenant_id AND pi.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'payments.intent.create', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO payment.payment_intents(
    id, tenant_id, legal_entity_id, store_id, register_id, provider_account_id,
    source_type, source_id, source_version, currency, scale, amount_minor,
    method_reference, created_by
  ) VALUES (
    p_intent_id, v_tenant_id, v_legal_entity_id, v_store_id, v_register_id,
    p_provider_account_id, p_source_type, p_source_id, p_source_version,
    p_currency, p_scale, p_amount_minor, p_method_reference, v_actor_id
  );

  INSERT INTO payment.payment_state_events(
    id, tenant_id, payment_intent_id, prior_status, new_status, amount_minor,
    event_reason, occurred_at, business_date, actor_id, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_intent_id, NULL, 'created', p_amount_minor,
    'intent_created', now(), v_business_date, v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.intent.created.v1', 'payments.intent.create', 'success',
    v_actor_id, 'payment.intent', p_intent_id::text, v_request_id, v_trace_id,
    jsonb_build_object('sourceType', p_source_type, 'sourceId', p_source_id, 'currency', p_currency, 'amountMinor', p_amount_minor),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.intent.created.v1', 'payment.intent', p_intent_id::text, '1.0',
    jsonb_build_object('intentId', p_intent_id, 'sourceType', p_source_type, 'sourceId', p_source_id,
                       'currency', p_currency, 'scale', p_scale, 'amountMinor', p_amount_minor, 'status', 'created'),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 201,
    response_json = jsonb_build_object('intentId', p_intent_id),
    resource_type = 'payment.intent', resource_id = p_intent_id::text, updated_at = now()
  WHERE tenant_id = v_tenant_id AND scope = 'payments.intent.create' AND idempotency_key = p_idempotency_key;

  RETURN QUERY
    SELECT pi.id, pi.provider_account_id, pa.provider_key, pi.status, pi.currency, pi.scale,
           pi.amount_minor, pi.captured_minor, pi.refunded_minor, pi.method_reference,
           pi.provider_reference, pi.version, pi.last_observed_at, false
      FROM payment.payment_intents pi
      JOIN payment.provider_accounts pa ON pa.tenant_id = pi.tenant_id AND pa.id = pi.provider_account_id
     WHERE pi.tenant_id = v_tenant_id AND pi.id = p_intent_id;
END $$;

CREATE OR REPLACE FUNCTION payment.begin_attempt_v1(
  p_attempt_id uuid,
  p_intent_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_hash text,
  p_amount_minor bigint DEFAULT NULL
) RETURNS TABLE(
  execute boolean, replayed boolean, attempt_id uuid, operation text, intent_id uuid,
  provider_key text, provider_reference text, method_reference text, currency char(3),
  scale smallint, command_amount_minor bigint, current_status text, attempt_outcome text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_intent payment.payment_intents%ROWTYPE;
  v_provider_key text;
  v_attempt payment.payment_attempts%ROWTYPE;
  v_result payment.payment_attempt_results%ROWTYPE;
  v_command_amount bigint;
BEGIN
  SELECT pi.* INTO v_intent
    FROM payment.payment_intents pi
   WHERE pi.tenant_id = v_tenant_id AND pi.id = p_intent_id
   FOR UPDATE;
  SELECT pa.provider_key INTO v_provider_key
    FROM payment.provider_accounts pa
   WHERE pa.tenant_id = v_tenant_id AND pa.id = v_intent.provider_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment intent not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_attempt FROM payment.payment_attempts
   WHERE tenant_id = v_tenant_id AND payment_intent_id = p_intent_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_attempt.request_hash <> p_request_hash OR v_attempt.operation <> p_operation THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_result FROM payment.payment_attempt_results
     WHERE tenant_id = v_tenant_id AND payment_attempt_id = v_attempt.id;
    RETURN QUERY SELECT false, FOUND, v_attempt.id, v_attempt.operation, v_intent.id,
      v_provider_key, COALESCE(v_result.provider_reference, v_attempt.provider_reference, v_intent.provider_reference),
      v_intent.method_reference, v_intent.currency, v_intent.scale,
      COALESCE(v_attempt.command_amount_minor, v_intent.amount_minor), v_intent.status,
      COALESCE(v_result.outcome, 'processing');
    RETURN;
  END IF;

  IF p_operation = 'authorize' AND v_intent.status NOT IN ('created','requires_action') THEN
    RAISE EXCEPTION 'invalid payment transition for authorize' USING ERRCODE = 'P0001';
  ELSIF p_operation IN ('capture','void') AND v_intent.status <> 'authorized' THEN
    IF v_intent.status = 'unknown' THEN RAISE EXCEPTION 'status recovery is required' USING ERRCODE = 'P0001'; END IF;
    RAISE EXCEPTION 'invalid payment transition' USING ERRCODE = 'P0001';
  ELSIF p_operation = 'status_query' AND v_intent.status <> 'unknown' THEN
    RAISE EXCEPTION 'status recovery requires an unknown payment' USING ERRCODE = 'P0001';
  ELSIF p_operation NOT IN ('authorize','capture','void','status_query') THEN
    RAISE EXCEPTION 'unsupported payment operation' USING ERRCODE = '22023';
  END IF;

  v_command_amount := CASE
    WHEN p_operation = 'capture' THEN COALESCE(p_amount_minor, v_intent.amount_minor - v_intent.captured_minor)
    WHEN p_operation = 'void' THEN 0
    ELSE COALESCE(p_amount_minor, v_intent.amount_minor)
  END;
  IF v_command_amount < 0 THEN RAISE EXCEPTION 'payment command amount is invalid' USING ERRCODE = '22023'; END IF;

  INSERT INTO payment.payment_attempts(
    id, tenant_id, payment_intent_id, operation, idempotency_key, request_hash,
    provider_reference, outcome, attempt_number, request_id, trace_id, command_amount_minor
  ) VALUES (
    p_attempt_id, v_tenant_id, p_intent_id, p_operation, p_idempotency_key, p_request_hash,
    v_intent.provider_reference, 'processing',
    1 + (SELECT count(*)::integer FROM payment.payment_attempts pa_count WHERE pa_count.tenant_id = v_tenant_id AND pa_count.payment_intent_id = p_intent_id AND pa_count.operation = p_operation),
    v_request_id, v_trace_id, v_command_amount
  );

  RETURN QUERY SELECT true, false, p_attempt_id, p_operation, v_intent.id,
    v_provider_key, v_intent.provider_reference, v_intent.method_reference,
    v_intent.currency, v_intent.scale, v_command_amount, v_intent.status, 'processing'::text;
END $$;

CREATE OR REPLACE FUNCTION payment.complete_attempt_v1(
  p_result_id uuid,
  p_attempt_id uuid,
  p_resulting_status text,
  p_outcome text,
  p_provider_reference text,
  p_observed_at timestamptz,
  p_failure_category text DEFAULT NULL,
  p_provider_code text DEFAULT NULL
) RETURNS TABLE(
  intent_id uuid, provider_account_id uuid, provider_key text, status text,
  currency char(3), scale smallint, amount_minor bigint, captured_minor bigint,
  refunded_minor bigint, method_reference text, provider_reference text,
  version bigint, observed_at timestamptz, replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_attempt payment.payment_attempts%ROWTYPE;
  v_existing payment.payment_attempt_results%ROWTYPE;
  v_intent payment.payment_intents%ROWTYPE;
  v_provider_key text;
  v_prior_status text;
BEGIN
  SELECT * INTO v_attempt FROM payment.payment_attempts
   WHERE tenant_id = v_tenant_id AND id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment attempt not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_existing FROM payment.payment_attempt_results
   WHERE tenant_id = v_tenant_id AND payment_attempt_id = p_attempt_id;
  IF FOUND THEN
    RETURN QUERY SELECT pi.id, pi.provider_account_id, pa.provider_key, pi.status, pi.currency, pi.scale,
      pi.amount_minor, pi.captured_minor, pi.refunded_minor, pi.method_reference, pi.provider_reference,
      pi.version, pi.last_observed_at, true
      FROM payment.payment_intents pi
      JOIN payment.provider_accounts pa ON pa.tenant_id = pi.tenant_id AND pa.id = pi.provider_account_id
      WHERE pi.tenant_id = v_tenant_id AND pi.id = v_attempt.payment_intent_id;
    RETURN;
  END IF;

  SELECT pi.* INTO v_intent
    FROM payment.payment_intents pi
   WHERE pi.tenant_id = v_tenant_id AND pi.id = v_attempt.payment_intent_id
   FOR UPDATE;
  SELECT pa.provider_key INTO v_provider_key
    FROM payment.provider_accounts pa
   WHERE pa.tenant_id = v_tenant_id AND pa.id = v_intent.provider_account_id;
  v_prior_status := v_intent.status;

  INSERT INTO payment.payment_attempt_results(
    id, tenant_id, payment_attempt_id, outcome, resulting_status, provider_reference,
    failure_category, provider_code, observed_at, request_id, trace_id
  ) VALUES (
    p_result_id, v_tenant_id, p_attempt_id, p_outcome, p_resulting_status,
    p_provider_reference, p_failure_category, p_provider_code, p_observed_at, v_request_id, v_trace_id
  );

  UPDATE payment.payment_intents AS intent SET
    status = p_resulting_status,
    provider_reference = COALESCE(p_provider_reference, intent.provider_reference),
    captured_minor = CASE WHEN v_attempt.operation IN ('capture','status_query') AND p_resulting_status = 'captured'
                          THEN LEAST(intent.amount_minor, intent.captured_minor + COALESCE(v_attempt.command_amount_minor, 0))
                          ELSE intent.captured_minor END,
    unknown_since = CASE WHEN p_resulting_status = 'unknown' THEN COALESCE(intent.unknown_since, now()) ELSE NULL END,
    last_observed_at = p_observed_at,
    version = intent.version + 1
  WHERE intent.tenant_id = v_tenant_id AND intent.id = v_intent.id
  RETURNING intent.* INTO v_intent;

  INSERT INTO payment.payment_state_events(
    id, tenant_id, payment_intent_id, payment_attempt_id, prior_status, new_status,
    amount_minor, event_reason, provider_reference, occurred_at, business_date,
    actor_id, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_intent.id, p_attempt_id, v_prior_status, p_resulting_status,
    v_attempt.command_amount_minor, v_attempt.operation || '_' || p_outcome,
    p_provider_reference, p_observed_at, v_business_date, v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.state.changed.v1', 'payments.' || v_attempt.operation,
    p_outcome, v_actor_id, 'payment.intent', v_intent.id::text, v_request_id, v_trace_id,
    jsonb_build_object('attemptId', p_attempt_id, 'priorStatus', v_prior_status, 'newStatus', p_resulting_status,
                       'providerReference', p_provider_reference, 'failureCategory', p_failure_category),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.state.changed.v1', 'payment.intent', v_intent.id::text, '1.0',
    jsonb_build_object('intentId', v_intent.id, 'attemptId', p_attempt_id, 'status', p_resulting_status,
                       'currency', v_intent.currency, 'scale', v_intent.scale,
                       'amountMinor', v_intent.amount_minor, 'capturedMinor', v_intent.captured_minor,
                       'refundedMinor', v_intent.refunded_minor),
    jsonb_build_object('requestId', v_request_id), v_request_id, p_attempt_id::text,
    p_observed_at, v_business_date
  );

  RETURN QUERY SELECT v_intent.id, v_intent.provider_account_id, v_provider_key, v_intent.status,
    v_intent.currency, v_intent.scale, v_intent.amount_minor, v_intent.captured_minor,
    v_intent.refunded_minor, v_intent.method_reference, v_intent.provider_reference,
    v_intent.version, v_intent.last_observed_at, false;
END $$;

CREATE OR REPLACE FUNCTION payment.begin_refund_v1(
  p_refund_id uuid,
  p_attempt_id uuid,
  p_intent_id uuid,
  p_currency char(3),
  p_scale smallint,
  p_amount_minor bigint,
  p_reason text,
  p_approval_request_id uuid,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  execute boolean, replayed boolean, refund_id uuid, attempt_id uuid, intent_id uuid,
  provider_key text, provider_reference text, currency char(3), scale smallint,
  command_amount_minor bigint, current_status text, final_refund boolean,
  refund_status text, observed_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_intent payment.payment_intents%ROWTYPE;
  v_provider_key text;
  v_refund payment.refunds%ROWTYPE;
  v_available bigint;
BEGIN
  SELECT pi.* INTO v_intent
    FROM payment.payment_intents pi
   WHERE pi.tenant_id = v_tenant_id AND pi.id = p_intent_id
   FOR UPDATE;
  SELECT pa.provider_key INTO v_provider_key
    FROM payment.provider_accounts pa
   WHERE pa.tenant_id = v_tenant_id AND pa.id = v_intent.provider_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment intent not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_refund FROM payment.refunds
   WHERE tenant_id = v_tenant_id AND payment_intent_id = p_intent_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_refund.request_hash <> p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001'; END IF;
    RETURN QUERY SELECT false, v_refund.status NOT IN ('processing','requested','pending_approval'),
      v_refund.id, pa.id, v_intent.id, v_provider_key, COALESCE(v_refund.provider_reference, v_intent.provider_reference),
      v_refund.currency, v_refund.scale, v_refund.amount_minor, v_intent.status,
      v_refund.amount_minor = (v_intent.captured_minor - v_intent.refunded_minor),
      v_refund.status, COALESCE(v_refund.completed_at, v_refund.requested_at)
      FROM payment.payment_attempts pa
      WHERE pa.tenant_id = v_tenant_id AND pa.payment_intent_id = v_intent.id
        AND pa.operation = 'refund' AND pa.idempotency_key = p_idempotency_key;
    RETURN;
  END IF;

  IF v_intent.status NOT IN ('captured','partially_refunded') THEN
    IF v_intent.status = 'unknown' THEN RAISE EXCEPTION 'status recovery is required' USING ERRCODE = 'P0001'; END IF;
    RAISE EXCEPTION 'payment is not refundable' USING ERRCODE = 'P0001';
  END IF;
  IF p_currency <> v_intent.currency OR p_scale <> v_intent.scale THEN
    RAISE EXCEPTION 'refund currency or scale mismatch' USING ERRCODE = '22023';
  END IF;
  v_available := v_intent.captured_minor - v_intent.refunded_minor;
  IF p_amount_minor <= 0 OR p_amount_minor > v_available THEN
    RAISE EXCEPTION 'refund amount exceeds available captured amount' USING ERRCODE = '22023';
  END IF;
  IF p_approval_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.approval_requests ar
     WHERE ar.tenant_id = v_tenant_id AND ar.id = p_approval_request_id AND ar.status = 'approved'
  ) THEN RAISE EXCEPTION 'approved refund evidence is required' USING ERRCODE = '42501'; END IF;

  INSERT INTO payment.refunds(
    id, tenant_id, payment_intent_id, provider_account_id, currency, scale, amount_minor,
    reason, status, approval_request_id, requested_by, idempotency_key, request_hash
  ) VALUES (
    p_refund_id, v_tenant_id, p_intent_id, v_intent.provider_account_id, p_currency, p_scale,
    p_amount_minor, p_reason, 'processing', p_approval_request_id, v_actor_id, p_idempotency_key, p_request_hash
  );
  INSERT INTO payment.payment_attempts(
    id, tenant_id, payment_intent_id, operation, idempotency_key, request_hash,
    provider_reference, outcome, attempt_number, request_id, trace_id, command_amount_minor
  ) VALUES (
    p_attempt_id, v_tenant_id, p_intent_id, 'refund', p_idempotency_key, p_request_hash,
    v_intent.provider_reference, 'processing',
    1 + (SELECT count(*)::integer FROM payment.payment_attempts pa_count WHERE pa_count.tenant_id = v_tenant_id AND pa_count.payment_intent_id = p_intent_id AND pa_count.operation = 'refund'),
    v_request_id, v_trace_id, p_amount_minor
  );

  RETURN QUERY SELECT true, false, p_refund_id, p_attempt_id, v_intent.id,
    v_provider_key, v_intent.provider_reference, p_currency, p_scale, p_amount_minor,
    v_intent.status, p_amount_minor = v_available, 'processing'::text, now();
END $$;

CREATE OR REPLACE FUNCTION payment.complete_refund_v1(
  p_result_id uuid,
  p_refund_id uuid,
  p_attempt_id uuid,
  p_status text,
  p_provider_reference text,
  p_observed_at timestamptz,
  p_failure_category text DEFAULT NULL,
  p_provider_code text DEFAULT NULL
) RETURNS TABLE(
  refund_id uuid, intent_id uuid, status text, currency char(3), scale smallint,
  amount_minor bigint, provider_reference text, observed_at timestamptz, replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_refund payment.refunds%ROWTYPE;
  v_intent payment.payment_intents%ROWTYPE;
  v_outcome text;
  v_new_intent_status text;
  v_prior_status text;
BEGIN
  SELECT refund.* INTO v_refund FROM payment.refunds refund
   WHERE refund.tenant_id = v_tenant_id AND refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund not found' USING ERRCODE = 'P0002'; END IF;
  IF v_refund.status NOT IN ('processing','requested','pending_approval') THEN
    RETURN QUERY SELECT v_refund.id, v_refund.payment_intent_id, v_refund.status,
      v_refund.currency, v_refund.scale, v_refund.amount_minor, v_refund.provider_reference,
      COALESCE(v_refund.completed_at, v_refund.requested_at), true;
    RETURN;
  END IF;
  SELECT intent.* INTO v_intent FROM payment.payment_intents intent
   WHERE intent.tenant_id = v_tenant_id AND intent.id = v_refund.payment_intent_id FOR UPDATE;
  v_prior_status := v_intent.status;
  v_outcome := CASE p_status WHEN 'succeeded' THEN 'succeeded' WHEN 'declined' THEN 'declined' WHEN 'failed' THEN 'failed' ELSE 'ambiguous' END;

  INSERT INTO payment.payment_attempt_results(
    id, tenant_id, payment_attempt_id, outcome, resulting_status, provider_reference,
    failure_category, provider_code, observed_at, request_id, trace_id
  ) VALUES (
    p_result_id, v_tenant_id, p_attempt_id, v_outcome,
    CASE WHEN p_status = 'succeeded' AND v_intent.refunded_minor + v_refund.amount_minor = v_intent.captured_minor THEN 'refunded'
         WHEN p_status = 'succeeded' THEN 'partially_refunded'
         WHEN p_status = 'unknown' THEN 'unknown' ELSE v_intent.status END,
    p_provider_reference, p_failure_category, p_provider_code, p_observed_at, v_request_id, v_trace_id
  );

  UPDATE payment.refunds AS refund SET
    status = p_status, provider_reference = COALESCE(p_provider_reference, refund.provider_reference),
    completed_at = CASE WHEN p_status IN ('succeeded','declined','failed','cancelled') THEN p_observed_at ELSE NULL END,
    version = refund.version + 1
  WHERE refund.tenant_id = v_tenant_id AND refund.id = p_refund_id
  RETURNING refund.* INTO v_refund;

  v_new_intent_status := CASE
    WHEN p_status = 'succeeded' AND v_intent.refunded_minor + v_refund.amount_minor = v_intent.captured_minor THEN 'refunded'
    WHEN p_status = 'succeeded' THEN 'partially_refunded'
    WHEN p_status = 'unknown' THEN 'unknown'
    ELSE v_intent.status
  END;
  UPDATE payment.payment_intents AS intent SET
    status = v_new_intent_status,
    refunded_minor = CASE WHEN p_status = 'succeeded' THEN intent.refunded_minor + v_refund.amount_minor ELSE intent.refunded_minor END,
    provider_reference = COALESCE(p_provider_reference, intent.provider_reference),
    unknown_since = CASE WHEN p_status = 'unknown' THEN COALESCE(intent.unknown_since, now()) ELSE intent.unknown_since END,
    last_observed_at = p_observed_at,
    version = intent.version + 1
  WHERE intent.tenant_id = v_tenant_id AND intent.id = v_intent.id
  RETURNING intent.* INTO v_intent;

  INSERT INTO payment.payment_state_events(
    id, tenant_id, payment_intent_id, payment_attempt_id, prior_status, new_status,
    amount_minor, event_reason, provider_reference, occurred_at, business_date,
    actor_id, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_intent.id, p_attempt_id,
    v_prior_status, v_new_intent_status, v_refund.amount_minor, 'refund_' || p_status,
    p_provider_reference, p_observed_at, v_business_date, v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, approver_id,
    target_type, target_id, reason, request_id, trace_id, metadata,
    business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.refund.completed.v1', 'payments.refund', p_status,
    v_actor_id, NULL, 'payment.refund', v_refund.id::text, v_refund.reason,
    v_request_id, v_trace_id,
    jsonb_build_object('intentId', v_intent.id, 'currency', v_refund.currency, 'scale', v_refund.scale,
                       'amountMinor', v_refund.amount_minor, 'failureCategory', p_failure_category),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.refund.completed.v1', 'payment.refund', v_refund.id::text, '1.0',
    jsonb_build_object('refundId', v_refund.id, 'intentId', v_intent.id, 'status', p_status,
                       'currency', v_refund.currency, 'scale', v_refund.scale, 'amountMinor', v_refund.amount_minor),
    jsonb_build_object('requestId', v_request_id), v_request_id, p_attempt_id::text,
    p_observed_at, v_business_date
  );

  RETURN QUERY SELECT v_refund.id, v_refund.payment_intent_id, v_refund.status,
    v_refund.currency, v_refund.scale, v_refund.amount_minor, v_refund.provider_reference,
    COALESCE(v_refund.completed_at, p_observed_at), false;
END $$;

CREATE OR REPLACE FUNCTION payment.import_settlement_v1(
  p_settlement_id uuid,
  p_provider_account_id uuid,
  p_provider_settlement_id text,
  p_currency char(3),
  p_scale smallint,
  p_gross_minor bigint,
  p_fee_minor bigint,
  p_adjustment_minor bigint,
  p_net_minor bigint,
  p_settled_at timestamptz,
  p_source_hash text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  settlement_id uuid, provider_account_id uuid, provider_settlement_id text,
  currency char(3), scale smallint, gross_minor bigint, fee_minor bigint,
  adjustment_minor bigint, net_minor bigint, settled_at timestamptz,
  source_hash text, status text, replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing payment.settlements%ROWTYPE;
BEGIN
  IF p_net_minor <> p_gross_minor - p_fee_minor - p_adjustment_minor THEN
    RAISE EXCEPTION 'settlement does not reconcile' USING ERRCODE = '22023';
  END IF;
  SELECT settlement.* INTO v_existing FROM payment.settlements settlement
   WHERE settlement.tenant_id = v_tenant_id AND settlement.provider_account_id = p_provider_account_id
     AND (settlement.provider_settlement_id = p_provider_settlement_id OR settlement.idempotency_key = p_idempotency_key)
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.source_hash <> p_source_hash OR v_existing.request_hash <> p_request_hash
       OR v_existing.gross_minor <> p_gross_minor OR v_existing.fee_minor <> p_fee_minor
       OR v_existing.adjustment_minor <> p_adjustment_minor OR v_existing.net_minor <> p_net_minor THEN
      RAISE EXCEPTION 'settlement replay payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.provider_account_id, v_existing.provider_settlement_id,
      v_existing.currency, v_existing.scale, v_existing.gross_minor, v_existing.fee_minor,
      v_existing.adjustment_minor, v_existing.net_minor, v_existing.settled_at,
      v_existing.source_hash, v_existing.status, true;
    RETURN;
  END IF;

  INSERT INTO payment.settlements(
    id, tenant_id, legal_entity_id, provider_account_id, provider_settlement_id,
    currency, scale, gross_minor, fee_minor, adjustment_minor, net_minor,
    status, settled_at, source_hash, idempotency_key, request_hash
  ) VALUES (
    p_settlement_id, v_tenant_id, v_legal_entity_id, p_provider_account_id,
    p_provider_settlement_id, p_currency, p_scale, p_gross_minor, p_fee_minor,
    p_adjustment_minor, p_net_minor, 'imported', p_settled_at, p_source_hash,
    p_idempotency_key, p_request_hash
  ) RETURNING * INTO v_existing;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.settlement.imported.v1', 'payments.settlement.import', 'success',
    v_actor_id, 'payment.settlement', v_existing.id::text, v_request_id, v_trace_id,
    jsonb_build_object('providerSettlementId', p_provider_settlement_id, 'currency', p_currency,
                       'grossMinor', p_gross_minor, 'feeMinor', p_fee_minor,
                       'adjustmentMinor', p_adjustment_minor, 'netMinor', p_net_minor),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'payment.settlement.imported.v1', 'payment.settlement', v_existing.id::text, '1.0',
    jsonb_build_object('settlementId', v_existing.id, 'providerAccountId', p_provider_account_id,
                       'providerSettlementId', p_provider_settlement_id, 'currency', p_currency,
                       'scale', p_scale, 'grossMinor', p_gross_minor, 'feeMinor', p_fee_minor,
                       'adjustmentMinor', p_adjustment_minor, 'netMinor', p_net_minor, 'status', 'imported'),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT v_existing.id, v_existing.provider_account_id, v_existing.provider_settlement_id,
    v_existing.currency, v_existing.scale, v_existing.gross_minor, v_existing.fee_minor,
    v_existing.adjustment_minor, v_existing.net_minor, v_existing.settled_at,
    v_existing.source_hash, v_existing.status, false;
END $$;

REVOKE ALL ON FUNCTION payment.create_intent_v1(uuid,uuid,text,text,text,char,smallint,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment.begin_attempt_v1(uuid,uuid,text,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment.complete_attempt_v1(uuid,uuid,text,text,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment.begin_refund_v1(uuid,uuid,uuid,char,smallint,bigint,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment.complete_refund_v1(uuid,uuid,uuid,text,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION payment.import_settlement_v1(uuid,uuid,text,char,smallint,bigint,bigint,bigint,bigint,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment.create_intent_v1(uuid,uuid,text,text,text,char,smallint,bigint,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION payment.begin_attempt_v1(uuid,uuid,text,text,text,bigint) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION payment.complete_attempt_v1(uuid,uuid,text,text,text,timestamptz,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION payment.begin_refund_v1(uuid,uuid,uuid,char,smallint,bigint,text,uuid,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION payment.complete_refund_v1(uuid,uuid,uuid,text,text,timestamptz,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION payment.import_settlement_v1(uuid,uuid,text,char,smallint,bigint,bigint,bigint,bigint,timestamptz,text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('PAY-0002','MOD-E-PAYMENT','manifest:PAY-0002-payment-commands.sql');

COMMIT;
