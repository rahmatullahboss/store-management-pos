BEGIN;

CREATE OR REPLACE FUNCTION cash.open_shift_v1(
  p_id uuid,
  p_store_id uuid,
  p_register_id uuid,
  p_pos_session_id uuid,
  p_currency char(3),
  p_scale smallint,
  p_opening_float_minor bigint,
  p_opening_event_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_occurred_at timestamptz
) RETURNS TABLE(
  id uuid,
  store_id uuid,
  register_id uuid,
  pos_session_id uuid,
  business_date date,
  currency char(3),
  scale smallint,
  status text,
  version bigint,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, pos, cash AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_context_store_id uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_context_register_id uuid := NULLIF(current_setting('app.register_id', true), '')::uuid;
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_session pos.register_sessions%ROWTYPE;
  v_existing cash.shifts%ROWTYPE;
  v_opening cash.cash_events%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_store_id IS NULL OR p_register_id IS NULL OR p_pos_session_id IS NULL
     OR p_currency IS NULL OR p_scale < 0 OR p_scale > 12
     OR p_opening_float_minor < 0 OR btrim(COALESCE(p_idempotency_key, '')) = ''
     OR btrim(COALESCE(p_request_hash, '')) = '' OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'cash shift identity, exact opening float and replay keys are required' USING ERRCODE = '22023';
  END IF;
  IF p_opening_float_minor > 0 AND p_opening_event_id IS NULL THEN
    RAISE EXCEPTION 'positive opening float requires an opening event ID' USING ERRCODE = '22023';
  END IF;
  IF v_context_store_id IS NOT NULL AND v_context_store_id <> p_store_id THEN
    RAISE EXCEPTION 'cash shift is outside request store scope' USING ERRCODE = '42501';
  END IF;
  IF v_context_register_id IS NOT NULL AND v_context_register_id <> p_register_id THEN
    RAISE EXCEPTION 'cash shift is outside request register scope' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_existing
  FROM cash.shifts s
  WHERE s.tenant_id = v_tenant_id AND s.pos_session_id = p_pos_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.store_id <> p_store_id OR v_existing.register_id <> p_register_id
       OR v_existing.currency <> upper(p_currency) OR v_existing.scale <> p_scale THEN
      RAISE EXCEPTION 'cash shift session was replayed with a different scope or currency' USING ERRCODE = 'P0001';
    END IF;
    SELECT e.* INTO v_opening
    FROM cash.cash_events e
    WHERE e.tenant_id = v_tenant_id AND e.shift_id = v_existing.id
      AND e.event_type = 'opening_float'
    ORDER BY e.sequence
    LIMIT 1;
    IF p_opening_float_minor = 0 AND FOUND THEN
      RAISE EXCEPTION 'cash shift was replayed with a different opening float' USING ERRCODE = 'P0001';
    END IF;
    IF p_opening_float_minor > 0 AND (
      NOT FOUND OR v_opening.amount_minor <> p_opening_float_minor
      OR v_opening.currency <> upper(p_currency) OR v_opening.scale <> p_scale
      OR v_opening.idempotency_key <> p_idempotency_key
      OR v_opening.request_hash <> p_request_hash
    ) THEN
      RAISE EXCEPTION 'cash shift was replayed with a different opening float' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.store_id, v_existing.register_id,
      v_existing.pos_session_id, v_existing.business_date, v_existing.currency,
      v_existing.scale, v_existing.status, v_existing.version, true;
    RETURN;
  END IF;

  SELECT s.* INTO v_session
  FROM pos.register_sessions s
  WHERE s.tenant_id = v_tenant_id AND s.id = p_pos_session_id
  FOR SHARE;
  IF NOT FOUND OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'POS session must be open before opening cash' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.store_id <> p_store_id OR v_session.register_id <> p_register_id THEN
    RAISE EXCEPTION 'cash shift is outside POS session scope' USING ERRCODE = '42501';
  END IF;

  INSERT INTO cash.shifts(
    id, tenant_id, store_id, register_id, pos_session_id, business_date,
    currency, scale, opened_by
  ) VALUES (
    p_id, v_tenant_id, p_store_id, p_register_id, p_pos_session_id, v_business_date,
    upper(p_currency), p_scale, v_actor_id
  );

  IF p_opening_float_minor > 0 THEN
    INSERT INTO cash.cash_events(
      id, tenant_id, shift_id, event_type, currency, scale, amount_minor,
      source_type, source_id, idempotency_key, request_hash, reason,
      occurred_at, business_date, actor_id, request_id, trace_id
    ) VALUES (
      p_opening_event_id, v_tenant_id, p_id, 'opening_float', upper(p_currency),
      p_scale, p_opening_float_minor, 'cash_shift', p_id::text, p_idempotency_key,
      p_request_hash, 'Opening float', p_occurred_at, v_business_date,
      v_actor_id, v_request_id, v_trace_id
    );
  END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.shift.opened.v1', 'cash.shift.open', 'success',
    v_actor_id, 'cash.shift', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('storeId', p_store_id, 'registerId', p_register_id,
      'posSessionId', p_pos_session_id, 'currency', upper(p_currency),
      'scale', p_scale, 'openingFloatMinor', p_opening_float_minor),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.shift.opened.v1', 'cash.shift', p_id::text, '1.0',
    jsonb_build_object('shiftId', p_id, 'storeId', p_store_id, 'registerId', p_register_id,
      'posSessionId', p_pos_session_id, 'currency', upper(p_currency),
      'scale', p_scale, 'openingFloatMinor', p_opening_float_minor, 'status', 'open'),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_id, p_store_id, p_register_id, p_pos_session_id,
    v_business_date, upper(p_currency)::char(3), p_scale, 'open'::text, 1::bigint, false;
END $$;

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
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_existing cash.cash_events%ROWTYPE;
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

  SELECT e.* INTO v_existing
  FROM cash.cash_events e
  WHERE e.tenant_id = v_tenant_id AND e.shift_id = p_shift_id
    AND e.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.event_type <> p_event_type OR v_existing.currency <> upper(p_currency)
       OR v_existing.scale <> p_scale OR v_existing.amount_minor <> p_amount_minor
       OR v_existing.source_type <> p_source_type OR v_existing.source_id <> p_source_id
       OR v_existing.reversal_of_event_id IS DISTINCT FROM p_reversal_of_event_id
       OR v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'cash event was replayed with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.event_type, v_existing.currency,
      v_existing.scale, v_existing.amount_minor, v_existing.source_type,
      v_existing.source_id, v_existing.reversal_of_event_id,
      v_existing.idempotency_key, v_existing.request_hash, true;
    RETURN;
  END IF;

  IF p_event_type IN ('adjustment_in','adjustment_out') THEN
    IF p_approval_request_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM platform.approval_requests a
      WHERE a.tenant_id = v_tenant_id AND a.id = p_approval_request_id
        AND a.action_code = 'cash.adjustment.approve'
        AND a.target_type = 'cash_adjustment' AND a.target_id = p_id::text
        AND a.status = 'approved' AND (a.expires_at IS NULL OR a.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'approved cash adjustment is required' USING ERRCODE = 'P0001';
    END IF;
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
      'reversalOfEventId', p_reversal_of_event_id),
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
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_shift cash.shifts%ROWTYPE;
  v_existing cash.shift_closures%ROWTYPE;
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

  SELECT c.* INTO v_existing
  FROM cash.shift_closures c
  WHERE c.tenant_id = v_tenant_id AND c.shift_id = p_shift_id;
  IF FOUND THEN
    IF v_existing.currency <> upper(p_currency) OR v_existing.scale <> p_scale
       OR v_existing.counted_minor <> p_counted_minor
       OR v_existing.approval_request_id IS DISTINCT FROM p_approval_request_id THEN
      RAISE EXCEPTION 'cash closure was replayed with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.shift_id, v_existing.expected_minor,
      v_existing.counted_minor, v_existing.variance_minor, v_existing.closed_at, true;
    RETURN;
  END IF;

  SELECT s.* INTO v_shift
  FROM cash.shifts s
  WHERE s.tenant_id = v_tenant_id AND s.id = p_shift_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash shift does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_shift.status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'cash shift is not open' USING ERRCODE = 'P0001';
  END IF;
  IF v_shift.currency <> upper(p_currency) OR v_shift.scale <> p_scale THEN
    RAISE EXCEPTION 'cash count currency and scale must match the shift' USING ERRCODE = '22023';
  END IF;

  SELECT e.expected_minor INTO v_expected_minor
  FROM cash.shift_expected_cash e
  WHERE e.tenant_id = v_tenant_id AND e.shift_id = p_shift_id;
  v_expected_minor := COALESCE(v_expected_minor, 0);
  v_variance_minor := p_counted_minor - v_expected_minor;

  IF v_variance_minor <> 0 AND (
    p_approval_request_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM platform.approval_requests a
      WHERE a.tenant_id = v_tenant_id AND a.id = p_approval_request_id
        AND a.action_code = 'cash.variance.approve'
        AND a.target_type = 'cash_shift_variance' AND a.target_id = p_shift_id::text
        AND a.status = 'approved' AND (a.expires_at IS NULL OR a.expires_at > now())
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

  UPDATE cash.shifts
  SET status = 'closed', closed_by = v_actor_id, closed_at = p_closed_at,
      approval_request_id = p_approval_request_id, version = version + 1
  WHERE tenant_id = v_tenant_id AND shifts.id = p_shift_id;

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
  ('cash.adjustment.approve','cash','Approve an append-only cash adjustment','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

REVOKE ALL ON FUNCTION cash.open_shift_v1(uuid,uuid,uuid,uuid,char(3),smallint,bigint,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.append_event_v1(uuid,uuid,text,char(3),smallint,bigint,text,text,uuid,uuid,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.close_shift_v1(uuid,uuid,uuid,text,char(3),smallint,bigint,jsonb,uuid,timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cash.open_shift_v1(uuid,uuid,uuid,uuid,char(3),smallint,bigint,uuid,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION cash.append_event_v1(uuid,uuid,text,char(3),smallint,bigint,text,text,uuid,uuid,text,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION cash.close_shift_v1(uuid,uuid,uuid,text,char(3),smallint,bigint,jsonb,uuid,timestamptz) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0004','MOD-D-CASH','manifest:CSH-0003-runtime-commands.sql');

COMMIT;
