BEGIN;

CREATE OR REPLACE FUNCTION cash.append_event_v1(
  p_id uuid,
  p_shift_id uuid,
  p_event_type text,
  p_currency char(3),
  p_scale smallint,
  p_amount_minor bigint,
  p_source_type text,
  p_source_id text,
  p_reversal_of_event_id uuid,
  p_approval_request_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_reason text,
  p_occurred_at timestamptz
) RETURNS TABLE(
  id uuid,
  event_type text,
  currency char(3),
  scale smallint,
  amount_minor bigint,
  source_type text,
  source_id text,
  reversal_of_event_id uuid,
  idempotency_key text,
  request_hash text,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, cash AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_context_store_id uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_context_register_id uuid := NULLIF(current_setting('app.register_id', true), '')::uuid;
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_shift cash.shifts%ROWTYPE;
  v_existing cash.cash_events%ROWTYPE;
  v_approval_action text;
  v_approval_target_type text;
  v_approval_target_id text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_shift_id IS NULL OR p_currency IS NULL OR p_scale < 0 OR p_scale > 12
     OR p_amount_minor <= 0 OR btrim(COALESCE(p_source_type, '')) = ''
     OR btrim(COALESCE(p_source_id, '')) = ''
     OR btrim(COALESCE(p_idempotency_key, '')) = ''
     OR btrim(COALESCE(p_request_hash, '')) = '' OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'cash event identity and exact amount are required' USING ERRCODE = '22023';
  END IF;
  IF p_event_type NOT IN (
    'cash_sale','cash_refund','paid_in','paid_out','safe_drop','adjustment_in','adjustment_out'
  ) THEN
    RAISE EXCEPTION 'unsupported cash event type' USING ERRCODE = '22023';
  END IF;

  SELECT shift.* INTO v_shift
  FROM cash.shifts AS shift
  WHERE shift.tenant_id = v_tenant_id
    AND shift.id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash shift does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_shift.status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'cash shift is not open' USING ERRCODE = 'P0001';
  END IF;
  IF v_shift.currency <> upper(p_currency) OR v_shift.scale <> p_scale THEN
    RAISE EXCEPTION 'cash event currency and scale must match the shift' USING ERRCODE = '22023';
  END IF;
  IF v_context_store_id IS NOT NULL AND v_context_store_id <> v_shift.store_id THEN
    RAISE EXCEPTION 'cash event is outside request store scope' USING ERRCODE = '42501';
  END IF;
  IF v_context_register_id IS NOT NULL AND v_context_register_id <> v_shift.register_id THEN
    RAISE EXCEPTION 'cash event is outside request register scope' USING ERRCODE = '42501';
  END IF;

  SELECT event.* INTO v_existing
  FROM cash.cash_events AS event
  WHERE event.tenant_id = v_tenant_id
    AND event.shift_id = p_shift_id
    AND event.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.event_type <> p_event_type
       OR v_existing.currency <> upper(p_currency)
       OR v_existing.scale <> p_scale
       OR v_existing.amount_minor <> p_amount_minor
       OR v_existing.source_type <> p_source_type
       OR v_existing.source_id <> p_source_id
       OR v_existing.reversal_of_event_id IS DISTINCT FROM p_reversal_of_event_id
       OR v_existing.request_hash <> p_request_hash
       OR v_existing.reason IS DISTINCT FROM p_reason
       OR v_existing.occurred_at <> p_occurred_at THEN
      RAISE EXCEPTION 'cash event was replayed with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.event_type, v_existing.currency,
      v_existing.scale, v_existing.amount_minor, v_existing.source_type,
      v_existing.source_id, v_existing.reversal_of_event_id,
      v_existing.idempotency_key, v_existing.request_hash, true;
    RETURN;
  END IF;

  IF p_event_type IN ('adjustment_in','adjustment_out') THEN
    v_approval_action := 'cash.adjustment.approve';
    v_approval_target_type := 'cash_adjustment';
    v_approval_target_id := p_id::text;
  ELSIF p_reversal_of_event_id IS NOT NULL THEN
    v_approval_action := 'cash.reversal.approve';
    v_approval_target_type := 'cash_event_reversal';
    v_approval_target_id := p_reversal_of_event_id::text;
  END IF;

  IF v_approval_action IS NOT NULL AND (
    p_approval_request_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM platform.approval_requests AS approval
      WHERE approval.tenant_id = v_tenant_id
        AND approval.id = p_approval_request_id
        AND approval.action_code = v_approval_action
        AND approval.target_type = v_approval_target_type
        AND approval.target_id = v_approval_target_id
        AND approval.status = 'approved'
        AND (approval.expires_at IS NULL OR approval.expires_at > now())
    )
  ) THEN
    RAISE EXCEPTION 'approved cash adjustment or reversal is required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO cash.cash_events(
    id, tenant_id, shift_id, event_type, currency, scale, amount_minor,
    source_type, source_id, reversal_of_event_id, idempotency_key, request_hash,
    reason, occurred_at, business_date, actor_id, request_id, trace_id
  ) VALUES (
    p_id, v_tenant_id, p_shift_id, p_event_type, upper(p_currency), p_scale,
    p_amount_minor, p_source_type, p_source_id, p_reversal_of_event_id,
    p_idempotency_key, p_request_hash, p_reason, p_occurred_at, v_business_date,
    v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.event.appended.v1', 'cash.event.append', 'success',
    v_actor_id, 'cash.event', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('shiftId', p_shift_id, 'eventType', p_event_type,
      'currency', upper(p_currency), 'scale', p_scale, 'amountMinor', p_amount_minor,
      'sourceType', p_source_type, 'sourceId', p_source_id,
      'reversalOfEventId', p_reversal_of_event_id,
      'approvalRequestId', p_approval_request_id),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.event.appended.v1', 'cash.shift',
    p_shift_id::text, '1.0',
    jsonb_build_object('cashEventId', p_id, 'shiftId', p_shift_id,
      'eventType', p_event_type, 'currency', upper(p_currency), 'scale', p_scale,
      'amountMinor', p_amount_minor, 'sourceType', p_source_type,
      'sourceId', p_source_id, 'reversalOfEventId', p_reversal_of_event_id),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_id, p_event_type, upper(p_currency)::char(3), p_scale,
    p_amount_minor, p_source_type, p_source_id, p_reversal_of_event_id,
    p_idempotency_key, p_request_hash, false;
END $$;

CREATE OR REPLACE FUNCTION cash.close_shift_v1(
  p_cash_count_id uuid,
  p_closure_id uuid,
  p_shift_id uuid,
  p_count_type text,
  p_currency char(3),
  p_scale smallint,
  p_counted_minor bigint,
  p_denomination_breakdown jsonb,
  p_approval_request_id uuid,
  p_closed_at timestamptz
) RETURNS TABLE(
  id uuid,
  shift_id uuid,
  expected_minor bigint,
  counted_minor bigint,
  variance_minor bigint,
  closed_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, cash AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_context_store_id uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_context_register_id uuid := NULLIF(current_setting('app.register_id', true), '')::uuid;
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_shift cash.shifts%ROWTYPE;
  v_existing cash.shift_closures%ROWTYPE;
  v_existing_count cash.cash_counts%ROWTYPE;
  v_expected_minor bigint;
  v_variance_minor bigint;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_cash_count_id IS NULL OR p_closure_id IS NULL OR p_shift_id IS NULL
     OR p_count_type NOT IN ('blind_close','recount','audit')
     OR p_currency IS NULL OR p_scale < 0 OR p_scale > 12
     OR p_counted_minor < 0 OR p_closed_at IS NULL THEN
    RAISE EXCEPTION 'cash closure identity and exact count are required' USING ERRCODE = '22023';
  END IF;

  SELECT shift.* INTO v_shift
  FROM cash.shifts AS shift
  WHERE shift.tenant_id = v_tenant_id
    AND shift.id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash shift does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_context_store_id IS NOT NULL AND v_context_store_id <> v_shift.store_id THEN
    RAISE EXCEPTION 'cash closure is outside request store scope' USING ERRCODE = '42501';
  END IF;
  IF v_context_register_id IS NOT NULL AND v_context_register_id <> v_shift.register_id THEN
    RAISE EXCEPTION 'cash closure is outside request register scope' USING ERRCODE = '42501';
  END IF;

  SELECT closure.* INTO v_existing
  FROM cash.shift_closures AS closure
  WHERE closure.tenant_id = v_tenant_id
    AND closure.shift_id = p_shift_id;

  IF FOUND THEN
    SELECT count.* INTO v_existing_count
    FROM cash.cash_counts AS count
    WHERE count.tenant_id = v_tenant_id
      AND count.id = v_existing.cash_count_id;

    IF v_existing.currency <> upper(p_currency)
       OR v_existing.scale <> p_scale
       OR v_existing.counted_minor <> p_counted_minor
       OR v_existing.approval_request_id IS DISTINCT FROM p_approval_request_id
       OR v_existing.closed_at <> p_closed_at
       OR v_existing_count.count_type <> p_count_type
       OR v_existing_count.denomination_breakdown
          IS DISTINCT FROM COALESCE(p_denomination_breakdown, '{}'::jsonb) THEN
      RAISE EXCEPTION 'cash closure was replayed with different content' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT v_existing.id, v_existing.shift_id,
      v_existing.expected_minor, v_existing.counted_minor,
      v_existing.variance_minor, v_existing.closed_at, true;
    RETURN;
  END IF;

  IF v_shift.status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'cash shift is not open' USING ERRCODE = 'P0001';
  END IF;
  IF v_shift.currency <> upper(p_currency) OR v_shift.scale <> p_scale THEN
    RAISE EXCEPTION 'cash count currency and scale must match the shift' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(cash.cash_event_effect(event.event_type, event.amount_minor)), 0)::bigint
  INTO v_expected_minor
  FROM cash.cash_events AS event
  WHERE event.tenant_id = v_tenant_id
    AND event.shift_id = p_shift_id;

  v_variance_minor := p_counted_minor - v_expected_minor;

  IF v_variance_minor <> 0 AND (
    p_approval_request_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM platform.approval_requests AS approval
      WHERE approval.tenant_id = v_tenant_id
        AND approval.id = p_approval_request_id
        AND approval.action_code = 'cash.variance.approve'
        AND approval.target_type = 'cash_shift_variance'
        AND approval.target_id = p_shift_id::text
        AND approval.status = 'approved'
        AND (approval.expires_at IS NULL OR approval.expires_at > now())
    )
  ) THEN
    RAISE EXCEPTION 'approved cash variance is required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO cash.cash_counts(
    id, tenant_id, shift_id, count_type, currency, scale, counted_minor,
    denomination_breakdown, counted_by, counted_at, request_id, trace_id
  ) VALUES (
    p_cash_count_id, v_tenant_id, p_shift_id, p_count_type, upper(p_currency),
    p_scale, p_counted_minor, COALESCE(p_denomination_breakdown, '{}'::jsonb),
    v_actor_id, p_closed_at, v_request_id, v_trace_id
  );

  INSERT INTO cash.shift_closures(
    id, tenant_id, shift_id, cash_count_id, currency, scale, expected_minor,
    counted_minor, variance_minor, approval_request_id, closed_by, closed_at,
    request_id, trace_id
  ) VALUES (
    p_closure_id, v_tenant_id, p_shift_id, p_cash_count_id, upper(p_currency),
    p_scale, v_expected_minor, p_counted_minor, v_variance_minor,
    p_approval_request_id, v_actor_id, p_closed_at, v_request_id, v_trace_id
  );

  UPDATE cash.shifts AS shift
  SET status = 'closed',
      closed_by = v_actor_id,
      closed_at = p_closed_at,
      approval_request_id = p_approval_request_id,
      version = shift.version + 1
  WHERE shift.tenant_id = v_tenant_id
    AND shift.id = p_shift_id;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.shift.closed.v1', 'cash.shift.close', 'success',
    v_actor_id, 'cash.shift', p_shift_id::text, v_request_id, v_trace_id,
    jsonb_build_object('cashCountId', p_cash_count_id, 'closureId', p_closure_id,
      'currency', upper(p_currency), 'scale', p_scale,
      'expectedMinor', v_expected_minor, 'countedMinor', p_counted_minor,
      'varianceMinor', v_variance_minor, 'approvalRequestId', p_approval_request_id),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.shift.closed.v1', 'cash.shift',
    p_shift_id::text, '1.0',
    jsonb_build_object('shiftId', p_shift_id, 'cashCountId', p_cash_count_id,
      'closureId', p_closure_id, 'currency', upper(p_currency), 'scale', p_scale,
      'expectedMinor', v_expected_minor, 'countedMinor', p_counted_minor,
      'varianceMinor', v_variance_minor, 'status', 'closed'),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_closure_id, p_shift_id, v_expected_minor,
    p_counted_minor, v_variance_minor, p_closed_at, false;
END $$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('cash.reversal.approve','cash','Approve an exact reversal linked to an immutable cash event','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

REVOKE ALL ON FUNCTION cash.append_event_v1(uuid,uuid,text,char(3),smallint,bigint,text,text,uuid,uuid,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.close_shift_v1(uuid,uuid,uuid,text,char(3),smallint,bigint,jsonb,uuid,timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cash.append_event_v1(uuid,uuid,text,char(3),smallint,bigint,text,text,uuid,uuid,text,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION cash.close_shift_v1(uuid,uuid,uuid,text,char(3),smallint,bigint,jsonb,uuid,timestamptz) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0005','MOD-D-CASH','manifest:CSH-0005-cash-scope-and-reversal-controls.sql');

COMMIT;
