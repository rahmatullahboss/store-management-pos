BEGIN;

CREATE OR REPLACE FUNCTION pos.contains_sensitive_payment_key(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pos AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_normalized text;
BEGIN
  IF jsonb_typeof(p_payload) = 'object' THEN
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_payload) LOOP
      v_normalized := regexp_replace(lower(v_key), '[^a-z0-9]', '', 'g');
      IF v_normalized = ANY (ARRAY[
        'pan','primaryaccountnumber','cardnumber','cvv','cvv2','cvc','cvc2',
        'securitycode','track1','track2','fulltrackdata','magstripe',
        'paymenttoken','providertoken','clientsecret','secret'
      ]) THEN
        RETURN true;
      END IF;
      IF jsonb_typeof(v_value) IN ('object','array') AND pos.contains_sensitive_payment_key(v_value) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_payload) = 'array' THEN
    FOR v_value IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
      IF jsonb_typeof(v_value) IN ('object','array') AND pos.contains_sensitive_payment_key(v_value) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END $$;

ALTER TABLE pos.checkout_operations
  ADD CONSTRAINT checkout_tender_snapshot_no_sensitive_keys
  CHECK (NOT pos.contains_sensitive_payment_key(tender_snapshot));

CREATE OR REPLACE FUNCTION pos.enroll_device_v1(
  p_id uuid,
  p_store_id uuid,
  p_register_id uuid,
  p_device_key text,
  p_display_name text,
  p_capabilities jsonb
) RETURNS TABLE(
  id uuid,
  store_id uuid,
  register_id uuid,
  device_key text,
  status text,
  version bigint,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, pos AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_context_store_id uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_context_register_id uuid := NULLIF(current_setting('app.register_id', true), '')::uuid;
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_existing pos.devices%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_store_id IS NULL OR btrim(COALESCE(p_device_key, '')) = '' OR btrim(COALESCE(p_display_name, '')) = '' THEN
    RAISE EXCEPTION 'device identity, store, key and display name are required' USING ERRCODE = '22023';
  END IF;
  IF v_context_store_id IS NOT NULL AND v_context_store_id <> p_store_id THEN
    RAISE EXCEPTION 'device enrollment is outside request store scope' USING ERRCODE = '42501';
  END IF;
  IF v_context_register_id IS NOT NULL AND v_context_register_id IS DISTINCT FROM p_register_id THEN
    RAISE EXCEPTION 'device enrollment is outside request register scope' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.stores s
    WHERE s.tenant_id = v_tenant_id AND s.id = p_store_id AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active store does not exist' USING ERRCODE = '23503';
  END IF;
  IF p_register_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.registers r
    WHERE r.tenant_id = v_tenant_id AND r.id = p_register_id
      AND r.store_id = p_store_id AND r.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active register does not belong to the store' USING ERRCODE = '23503';
  END IF;

  SELECT d.* INTO v_existing
  FROM pos.devices d
  WHERE d.tenant_id = v_tenant_id AND d.device_key = p_device_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.store_id IS DISTINCT FROM p_store_id
       OR v_existing.register_id IS DISTINCT FROM p_register_id THEN
      RAISE EXCEPTION 'device key is already enrolled in another register scope' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.store_id, v_existing.register_id,
      v_existing.device_key, v_existing.status, v_existing.version, true;
    RETURN;
  END IF;

  INSERT INTO pos.devices(
    id, tenant_id, store_id, register_id, device_key, display_name,
    capabilities, enrolled_by
  ) VALUES (
    p_id, v_tenant_id, p_store_id, p_register_id, p_device_key, p_display_name,
    COALESCE(p_capabilities, '{}'::jsonb), v_actor_id
  )
  RETURNING devices.id, devices.store_id, devices.register_id, devices.device_key,
    devices.status, devices.version
  INTO id, store_id, register_id, device_key, status, version;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.device.enrolled.v1', 'pos.device.manage', 'success',
    v_actor_id, 'pos.device', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('storeId', p_store_id, 'registerId', p_register_id, 'deviceKey', p_device_key),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.device.enrolled.v1', 'pos.device', p_id::text, '1.0',
    jsonb_build_object('deviceId', p_id, 'storeId', p_store_id, 'registerId', p_register_id, 'status', status),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  replayed := false;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION pos.open_session_v1(
  p_id uuid,
  p_store_id uuid,
  p_register_id uuid,
  p_device_id uuid
) RETURNS TABLE(
  id uuid,
  store_id uuid,
  register_id uuid,
  device_id uuid,
  status text,
  business_date date,
  version bigint,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, pos AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_context_store_id uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_context_register_id uuid := NULLIF(current_setting('app.register_id', true), '')::uuid;
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_device pos.devices%ROWTYPE;
  v_existing pos.register_sessions%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_store_id IS NULL OR p_register_id IS NULL OR p_device_id IS NULL THEN
    RAISE EXCEPTION 'session, store, register and device IDs are required' USING ERRCODE = '22023';
  END IF;
  IF v_context_store_id IS NOT NULL AND v_context_store_id <> p_store_id THEN
    RAISE EXCEPTION 'session is outside request store scope' USING ERRCODE = '42501';
  END IF;
  IF v_context_register_id IS NOT NULL AND v_context_register_id <> p_register_id THEN
    RAISE EXCEPTION 'session is outside request register scope' USING ERRCODE = '42501';
  END IF;

  SELECT d.* INTO v_device
  FROM pos.devices d
  WHERE d.tenant_id = v_tenant_id AND d.id = p_device_id
  FOR UPDATE;

  IF NOT FOUND OR v_device.status <> 'active' THEN
    RAISE EXCEPTION 'POS device is not active' USING ERRCODE = 'P0001';
  END IF;
  IF v_device.store_id <> p_store_id OR v_device.register_id IS DISTINCT FROM p_register_id THEN
    RAISE EXCEPTION 'POS device is outside requested register scope' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_existing
  FROM pos.register_sessions s
  WHERE s.tenant_id = v_tenant_id AND s.register_id = p_register_id
    AND s.status IN ('open','suspended')
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.device_id <> p_device_id THEN
      RAISE EXCEPTION 'register already has an open session on another device' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.store_id, v_existing.register_id,
      v_existing.device_id, v_existing.status, v_existing.business_date,
      v_existing.version, true;
    RETURN;
  END IF;

  INSERT INTO pos.register_sessions(
    id, tenant_id, store_id, register_id, device_id, business_date, opened_by
  ) VALUES (
    p_id, v_tenant_id, p_store_id, p_register_id, p_device_id, v_business_date, v_actor_id
  )
  RETURNING register_sessions.id, register_sessions.store_id, register_sessions.register_id,
    register_sessions.device_id, register_sessions.status, register_sessions.business_date,
    register_sessions.version
  INTO id, store_id, register_id, device_id, status, business_date, version;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.session.opened.v1', 'pos.checkout.execute', 'success',
    v_actor_id, 'pos.register_session', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('storeId', p_store_id, 'registerId', p_register_id, 'deviceId', p_device_id),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.session.opened.v1', 'pos.register_session', p_id::text, '1.0',
    jsonb_build_object('sessionId', p_id, 'storeId', p_store_id, 'registerId', p_register_id,
      'deviceId', p_device_id, 'businessDate', v_business_date, 'status', status),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  replayed := false;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION pos.create_cart_v1(
  p_id uuid,
  p_session_id uuid,
  p_customer_reference text,
  p_currency char(3),
  p_scale smallint,
  p_lines jsonb
) RETURNS TABLE(
  id uuid,
  status text,
  version bigint,
  line_count integer,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, pos AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_session pos.register_sessions%ROWTYPE;
  v_existing pos.carts%ROWTYPE;
  v_line jsonb;
  v_line_id uuid;
  v_line_number integer;
  v_quantity numeric(30,12);
  v_unit_price_minor bigint;
  v_discount_minor bigint;
  v_tax_minor bigint;
  v_count integer := 0;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_session_id IS NULL OR p_currency IS NULL OR p_scale < 0 OR p_scale > 12 THEN
    RAISE EXCEPTION 'cart identity, session, currency and scale are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 1 OR jsonb_array_length(p_lines) > 1000 THEN
    RAISE EXCEPTION 'cart requires 1 to 1000 lines' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO v_existing
  FROM pos.carts c
  WHERE c.tenant_id = v_tenant_id AND c.id = p_id
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.status, v_existing.version,
      (SELECT count(*)::integer FROM pos.cart_lines l WHERE l.tenant_id = v_tenant_id AND l.cart_id = v_existing.id),
      true;
    RETURN;
  END IF;

  SELECT s.* INTO v_session
  FROM pos.register_sessions s
  WHERE s.tenant_id = v_tenant_id AND s.id = p_session_id
  FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'POS session must be open' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO pos.carts(
    id, tenant_id, session_id, customer_reference, currency, scale, created_by
  ) VALUES (
    p_id, v_tenant_id, p_session_id, p_customer_reference, upper(p_currency), p_scale, v_actor_id
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := COALESCE(NULLIF(v_line->>'id', '')::uuid, gen_random_uuid());
    v_line_number := (v_line->>'lineNumber')::integer;
    v_quantity := (v_line->>'quantity')::numeric(30,12);
    v_unit_price_minor := (v_line->>'unitPriceMinor')::bigint;
    v_discount_minor := (v_line->>'discountMinor')::bigint;
    v_tax_minor := (v_line->>'taxMinor')::bigint;

    IF v_line_number <= 0 OR v_quantity <= 0 OR v_unit_price_minor < 0
       OR v_discount_minor < 0 OR v_tax_minor < 0
       OR v_discount_minor > (v_unit_price_minor * v_quantity) THEN
      RAISE EXCEPTION 'cart line exact values are invalid' USING ERRCODE = '22023';
    END IF;
    IF btrim(COALESCE(v_line->>'variantReference', '')) = '' THEN
      RAISE EXCEPTION 'cart line variant reference is required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO pos.cart_lines(
      id, tenant_id, cart_id, line_number, variant_reference, quantity,
      unit_price_minor, discount_minor, tax_minor, price_snapshot, tax_snapshot
    ) VALUES (
      v_line_id, v_tenant_id, p_id, v_line_number, v_line->>'variantReference', v_quantity,
      v_unit_price_minor, v_discount_minor, v_tax_minor,
      COALESCE(v_line->'priceSnapshot', '{}'::jsonb),
      COALESCE(v_line->'taxSnapshot', '{}'::jsonb)
    );
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.cart.created.v1', 'pos.checkout.execute', 'success',
    v_actor_id, 'pos.cart', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('sessionId', p_session_id, 'lineCount', v_count, 'currency', upper(p_currency)),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.cart.created.v1', 'pos.cart', p_id::text, '1.0',
    jsonb_build_object('cartId', p_id, 'sessionId', p_session_id, 'lineCount', v_count,
      'currency', upper(p_currency), 'scale', p_scale, 'status', 'open'),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_id, 'open'::text, 1::bigint, v_count, false;
END $$;

CREATE OR REPLACE FUNCTION pos.record_checkout_v1(
  p_id uuid,
  p_store_id uuid,
  p_register_id uuid,
  p_device_id uuid,
  p_session_id uuid,
  p_cart_id uuid,
  p_operation_id text,
  p_request_hash text,
  p_mode text,
  p_currency char(3),
  p_scale smallint,
  p_subtotal_minor bigint,
  p_discount_minor bigint,
  p_tax_minor bigint,
  p_total_minor bigint,
  p_payment_state text,
  p_cart_snapshot jsonb,
  p_tender_snapshot jsonb,
  p_occurred_at timestamptz,
  p_committed_at timestamptz
) RETURNS TABLE(
  id uuid,
  operation_id text,
  request_hash text,
  payment_state text,
  status text,
  version bigint,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, pos AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_session pos.register_sessions%ROWTYPE;
  v_cart pos.carts%ROWTYPE;
  v_existing pos.checkout_operations%ROWTYPE;
  v_status text;
  v_rejection_code text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_store_id IS NULL OR p_register_id IS NULL OR p_device_id IS NULL
     OR p_session_id IS NULL OR p_cart_id IS NULL
     OR btrim(COALESCE(p_operation_id, '')) = ''
     OR btrim(COALESCE(p_request_hash, '')) = '' THEN
    RAISE EXCEPTION 'checkout identity and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('online','offline') OR p_payment_state NOT IN ('not_required','accepted','captured','unknown','declined') THEN
    RAISE EXCEPTION 'checkout mode or payment state is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_scale < 0 OR p_scale > 12 OR p_subtotal_minor < 0 OR p_discount_minor < 0
     OR p_tax_minor < 0 OR p_total_minor < 0
     OR p_discount_minor > p_subtotal_minor
     OR p_total_minor <> p_subtotal_minor - p_discount_minor + p_tax_minor THEN
    RAISE EXCEPTION 'checkout exact totals are inconsistent' USING ERRCODE = '22023';
  END IF;
  IF p_total_minor > 0 AND p_payment_state = 'not_required' THEN
    RAISE EXCEPTION 'positive checkout total requires an explicit confirmed or unresolved payment state' USING ERRCODE = '22023';
  END IF;
  IF pos.contains_sensitive_payment_key(COALESCE(p_tender_snapshot, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'tender snapshot contains forbidden payment secret fields' USING ERRCODE = '22023';
  END IF;
  IF p_committed_at < p_occurred_at THEN
    RAISE EXCEPTION 'durable commit time cannot precede operation time' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO v_existing
  FROM pos.checkout_operations c
  WHERE c.tenant_id = v_tenant_id AND c.device_id = p_device_id
    AND c.operation_id = p_operation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'checkout operation was replayed with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.operation_id, v_existing.request_hash,
      v_existing.payment_state, v_existing.status, v_existing.version, true;
    RETURN;
  END IF;

  SELECT s.* INTO v_session
  FROM pos.register_sessions s
  WHERE s.tenant_id = v_tenant_id AND s.id = p_session_id
  FOR UPDATE;
  IF NOT FOUND OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'POS session must be open' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.store_id <> p_store_id OR v_session.register_id <> p_register_id
     OR v_session.device_id <> p_device_id THEN
    RAISE EXCEPTION 'checkout is outside the active POS session scope' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_cart
  FROM pos.carts c
  WHERE c.tenant_id = v_tenant_id AND c.id = p_cart_id
    AND c.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND OR v_cart.status NOT IN ('open','checkout_pending') THEN
    RAISE EXCEPTION 'POS cart cannot be submitted' USING ERRCODE = 'P0001';
  END IF;
  IF v_cart.currency <> upper(p_currency) OR v_cart.scale <> p_scale THEN
    RAISE EXCEPTION 'checkout currency and scale must match the cart' USING ERRCODE = '22023';
  END IF;

  v_status := CASE
    WHEN p_payment_state = 'unknown' THEN 'unknown'
    WHEN p_payment_state = 'declined' THEN 'rejected'
    ELSE 'pending'
  END;
  v_rejection_code := CASE WHEN p_payment_state = 'declined' THEN 'PAYMENT_DECLINED' ELSE NULL END;

  INSERT INTO pos.checkout_operations(
    id, tenant_id, store_id, register_id, device_id, session_id, cart_id,
    operation_id, request_hash, mode, currency, scale, subtotal_minor, discount_minor,
    tax_minor, total_minor, payment_state, status, cart_snapshot, tender_snapshot,
    rejection_code, occurred_at, committed_at
  ) VALUES (
    p_id, v_tenant_id, p_store_id, p_register_id, p_device_id, p_session_id, p_cart_id,
    p_operation_id, p_request_hash, p_mode, upper(p_currency), p_scale,
    p_subtotal_minor, p_discount_minor, p_tax_minor, p_total_minor,
    p_payment_state, v_status, COALESCE(p_cart_snapshot, '{}'::jsonb),
    COALESCE(p_tender_snapshot, '[]'::jsonb), v_rejection_code, p_occurred_at, p_committed_at
  );

  UPDATE pos.carts
  SET status = 'checkout_pending', updated_at = now(), version = version + 1
  WHERE tenant_id = v_tenant_id AND carts.id = p_cart_id;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.checkout.recorded.v1',
    CASE WHEN p_mode = 'offline' THEN 'pos.checkout.offline' ELSE 'pos.checkout.execute' END,
    CASE WHEN v_status = 'rejected' THEN 'rejected' WHEN v_status = 'unknown' THEN 'unknown' ELSE 'success' END,
    v_actor_id, 'pos.checkout', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('operationId', p_operation_id, 'deviceId', p_device_id,
      'cartId', p_cart_id, 'mode', p_mode, 'currency', upper(p_currency),
      'scale', p_scale, 'totalMinor', p_total_minor, 'paymentState', p_payment_state,
      'status', v_status),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.checkout.recorded.v1', 'pos.checkout', p_id::text, '1.0',
    jsonb_build_object('checkoutId', p_id, 'operationId', p_operation_id,
      'deviceId', p_device_id, 'registerId', p_register_id, 'cartId', p_cart_id,
      'mode', p_mode, 'currency', upper(p_currency), 'scale', p_scale,
      'totalMinor', p_total_minor, 'paymentState', p_payment_state, 'status', v_status),
    jsonb_build_object('requestId', v_request_id), v_request_id, p_committed_at, v_business_date
  );

  RETURN QUERY SELECT p_id, p_operation_id, p_request_hash, p_payment_state,
    v_status, 1::bigint, false;
END $$;

CREATE OR REPLACE FUNCTION pos.register_offline_operation_v1(
  p_id uuid,
  p_device_id uuid,
  p_register_id uuid,
  p_authorization_id uuid,
  p_operation_id text,
  p_device_sequence bigint,
  p_operation_type text,
  p_aggregate_id text,
  p_aggregate_version bigint,
  p_payload jsonb,
  p_payload_hash text,
  p_recorded_at timestamptz,
  p_local_schema_version text,
  p_app_version text
) RETURNS TABLE(
  status text,
  offline_operation_id uuid,
  reason_code text,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, pos AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_existing pos.offline_operations%ROWTYPE;
  v_authorization pos.offline_authorizations%ROWTYPE;
  v_required_permission text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_device_id IS NULL OR p_register_id IS NULL OR p_authorization_id IS NULL
     OR btrim(COALESCE(p_operation_id, '')) = '' OR p_device_sequence <= 0
     OR btrim(COALESCE(p_aggregate_id, '')) = '' OR p_aggregate_version < 0
     OR btrim(COALESCE(p_payload_hash, '')) = ''
     OR btrim(COALESCE(p_local_schema_version, '')) = ''
     OR btrim(COALESCE(p_app_version, '')) = '' THEN
    RAISE EXCEPTION 'offline operation identity and versions are required' USING ERRCODE = '22023';
  END IF;
  IF p_operation_type NOT IN ('checkout','cash_event','shift_open','shift_close','receipt_delivery','device_health') THEN
    RAISE EXCEPTION 'unsupported offline operation type' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_existing
  FROM pos.offline_operations o
  WHERE o.tenant_id = v_tenant_id AND o.device_id = p_device_id
    AND o.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.payload_hash <> p_payload_hash
       OR v_existing.operation_type <> p_operation_type
       OR v_existing.device_sequence <> p_device_sequence THEN
      RAISE EXCEPTION 'offline operation was replayed with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT 'duplicate'::text, v_existing.id, NULL::text, true;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pos.offline_operations o
    WHERE o.tenant_id = v_tenant_id AND o.device_id = p_device_id
      AND o.device_sequence = p_device_sequence
  ) THEN
    RAISE EXCEPTION 'device sequence is already assigned to another operation' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.* INTO v_authorization
  FROM pos.offline_authorizations a
  WHERE a.tenant_id = v_tenant_id AND a.id = p_authorization_id
    AND a.device_id = p_device_id AND a.register_id = p_register_id
  FOR SHARE;

  v_required_permission := CASE p_operation_type
    WHEN 'checkout' THEN 'pos.checkout.offline'
    WHEN 'cash_event' THEN 'cash.event.append'
    WHEN 'shift_open' THEN 'cash.shift.open'
    WHEN 'shift_close' THEN 'cash.shift.close'
    WHEN 'receipt_delivery' THEN 'pos.receipt.deliver'
    ELSE 'pos.sync.execute'
  END;

  IF NOT FOUND
     OR v_authorization.cashier_id <> v_actor_id
     OR p_recorded_at < v_authorization.issued_at
     OR p_recorded_at >= v_authorization.expires_at
     OR (v_authorization.revoked_at IS NOT NULL AND p_recorded_at >= v_authorization.revoked_at)
     OR NOT (v_required_permission = ANY(v_authorization.permission_codes)) THEN
    INSERT INTO platform.audit_events(
      id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
      request_id, trace_id, reason, metadata, business_date, source_version
    ) VALUES (
      gen_random_uuid(), v_tenant_id, 'pos.offline_operation.rejected.v1', 'pos.sync.execute', 'rejected',
      v_actor_id, 'pos.offline_operation', p_operation_id, v_request_id, v_trace_id,
      'OFFLINE_AUTHORIZATION_INVALID',
      jsonb_build_object('deviceId', p_device_id, 'registerId', p_register_id,
        'authorizationId', p_authorization_id, 'operationType', p_operation_type),
      v_business_date, 'mod-d-v1'
    );
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, 'OFFLINE_AUTHORIZATION_INVALID'::text, false;
    RETURN;
  END IF;

  INSERT INTO pos.offline_operations(
    id, tenant_id, device_id, register_id, authorization_id, operation_id,
    device_sequence, operation_type, aggregate_id, aggregate_version, payload,
    payload_hash, recorded_at, local_schema_version, app_version
  ) VALUES (
    p_id, v_tenant_id, p_device_id, p_register_id, p_authorization_id, p_operation_id,
    p_device_sequence, p_operation_type, p_aggregate_id, p_aggregate_version,
    COALESCE(p_payload, '{}'::jsonb), p_payload_hash, p_recorded_at,
    p_local_schema_version, p_app_version
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.offline_operation.received.v1', 'pos.sync.execute', 'success',
    v_actor_id, 'pos.offline_operation', p_id::text, v_request_id, v_trace_id,
    jsonb_build_object('operationId', p_operation_id, 'deviceId', p_device_id,
      'registerId', p_register_id, 'deviceSequence', p_device_sequence,
      'operationType', p_operation_type, 'aggregateId', p_aggregate_id),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.offline_operation.received.v1',
    'pos.offline_operation', p_id::text, '1.0',
    jsonb_build_object('offlineOperationId', p_id, 'operationId', p_operation_id,
      'deviceId', p_device_id, 'registerId', p_register_id,
      'deviceSequence', p_device_sequence, 'operationType', p_operation_type,
      'aggregateId', p_aggregate_id, 'aggregateVersion', p_aggregate_version,
      'status', 'deferred'),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT 'deferred'::text, p_id, NULL::text, false;
END $$;

REVOKE ALL ON FUNCTION pos.contains_sensitive_payment_key(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION pos.enroll_device_v1(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION pos.open_session_v1(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pos.create_cart_v1(uuid,uuid,text,char(3),smallint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION pos.record_checkout_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,char(3),smallint,bigint,bigint,bigint,bigint,text,jsonb,jsonb,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION pos.register_offline_operation_v1(uuid,uuid,uuid,uuid,text,bigint,text,text,bigint,jsonb,text,timestamptz,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION pos.contains_sensitive_payment_key(jsonb) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pos.enroll_device_v1(uuid,uuid,uuid,text,text,jsonb) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pos.open_session_v1(uuid,uuid,uuid,uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pos.create_cart_v1(uuid,uuid,text,char(3),smallint,jsonb) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pos.record_checkout_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,char(3),smallint,bigint,bigint,bigint,bigint,text,jsonb,jsonb,timestamptz,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pos.register_offline_operation_v1(uuid,uuid,uuid,uuid,text,bigint,text,text,bigint,jsonb,text,timestamptz,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0006','MOD-D-POS','manifest:POS-0006-runtime-commands.sql');

COMMIT;
