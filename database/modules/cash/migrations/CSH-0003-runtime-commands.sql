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
  v_has_opening boolean := false;
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

  SELECT shift.* INTO v_existing
  FROM cash.shifts AS shift
  WHERE shift.tenant_id = v_tenant_id
    AND shift.pos_session_id = p_pos_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.store_id <> p_store_id OR v_existing.register_id <> p_register_id
       OR v_existing.currency <> upper(p_currency) OR v_existing.scale <> p_scale THEN
      RAISE EXCEPTION 'cash shift session was replayed with a different scope or currency' USING ERRCODE = 'P0001';
    END IF;

    SELECT event.* INTO v_opening
    FROM cash.cash_events AS event
    WHERE event.tenant_id = v_tenant_id
      AND event.shift_id = v_existing.id
      AND event.event_type = 'opening_float'
    ORDER BY event.sequence
    LIMIT 1;
    v_has_opening := FOUND;

    IF p_opening_float_minor = 0 AND v_has_opening THEN
      RAISE EXCEPTION 'cash shift was replayed with a different opening float' USING ERRCODE = 'P0001';
    END IF;
    IF p_opening_float_minor > 0 AND (
      NOT v_has_opening OR v_opening.amount_minor <> p_opening_float_minor
      OR v_opening.currency <> upper(p_currency) OR v_opening.scale <> p_scale
      OR v_opening.idempotency_key <> p_idempotency_key
      OR v_opening.request_hash <> p_request_hash
      OR v_opening.occurred_at <> p_occurred_at
    ) THEN
      RAISE EXCEPTION 'cash shift was replayed with a different opening float' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT v_existing.id, v_existing.store_id, v_existing.register_id,
      v_existing.pos_session_id, v_existing.business_date, v_existing.currency,
      v_existing.scale, v_existing.status, v_existing.version, true;
    RETURN;
  END IF;

  SELECT session.* INTO v_session
  FROM pos.register_sessions AS session
  WHERE session.tenant_id = v_tenant_id
    AND session.id = p_pos_session_id
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
    p_id, v_tenant_id, p_store_id, p_register_id, p_pos_session_id,
    v_business_date, upper(p_currency), p_scale, v_actor_id
  );

  IF p_opening_float_minor > 0 THEN
    INSERT INTO cash.cash_events(
      id, tenant_id, shift_id, event_type, currency, scale, amount_minor,
      source_type, source_id, idempotency_key, request_hash, reason,
      occurred_at, business_date, actor_id, request_id, trace_id
    ) VALUES (
      p_opening_event_id, v_tenant_id, p_id, 'opening_float', upper(p_currency),
      p_scale, p_opening_float_minor, 'cash_shift', p_id::text,
      p_idempotency_key, p_request_hash, 'Opening float', p_occurred_at,
      v_business_date, v_actor_id, v_request_id, v_trace_id
    );
  END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.shift.opened.v1', 'cash.shift.open',
    'success', v_actor_id, 'cash.shift', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object(
      'storeId', p_store_id,
      'registerId', p_register_id,
      'posSessionId', p_pos_session_id,
      'currency', upper(p_currency),
      'scale', p_scale,
      'openingFloatMinor', p_opening_float_minor
    ),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'cash.shift.opened.v1', 'cash.shift',
    p_id::text, '1.0',
    jsonb_build_object(
      'shiftId', p_id,
      'storeId', p_store_id,
      'registerId', p_register_id,
      'posSessionId', p_pos_session_id,
      'currency', upper(p_currency),
      'scale', p_scale,
      'openingFloatMinor', p_opening_float_minor,
      'status', 'open'
    ),
    jsonb_build_object('requestId', v_request_id),
    v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_id, p_store_id, p_register_id, p_pos_session_id,
    v_business_date, upper(p_currency)::char(3), p_scale, 'open'::text,
    1::bigint, false;
END $$;

REVOKE ALL ON FUNCTION cash.open_shift_v1(
  uuid,uuid,uuid,uuid,char(3),smallint,bigint,uuid,text,text,timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cash.open_shift_v1(
  uuid,uuid,uuid,uuid,char(3),smallint,bigint,uuid,text,text,timestamptz
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0003','MOD-D-CASH','manifest:CSH-0003-runtime-commands.sql');

COMMIT;
