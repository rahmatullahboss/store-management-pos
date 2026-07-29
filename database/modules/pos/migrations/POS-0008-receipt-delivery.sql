BEGIN;

ALTER TABLE pos.receipt_delivery_requests
  ADD COLUMN reason text NOT NULL DEFAULT 'Receipt delivery requested';
ALTER TABLE pos.receipt_delivery_requests
  ALTER COLUMN reason DROP DEFAULT;
ALTER TABLE pos.receipt_delivery_requests
  ADD CONSTRAINT receipt_delivery_requests_reason_present
    CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  ADD CONSTRAINT receipt_delivery_requests_masked_destination
    CHECK (
      (channel = 'print' AND destination IS NULL)
      OR (
        channel IN ('email','sms')
        AND length(btrim(COALESCE(destination, ''))) BETWEEN 3 AND 200
      )
    ) NOT VALID;
ALTER TABLE pos.receipt_delivery_requests
  VALIDATE CONSTRAINT receipt_delivery_requests_masked_destination;

CREATE INDEX receipt_delivery_requests_receipt_time_idx
  ON pos.receipt_delivery_requests(tenant_id, receipt_snapshot_id, requested_at DESC, id);

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('pos.receipt.deliver','pos','Request immutable receipt print, email or SMS delivery','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

CREATE OR REPLACE FUNCTION pos.request_receipt_delivery_v1(
  p_id uuid,
  p_receipt_snapshot_id uuid,
  p_channel text,
  p_destination_masked text,
  p_reason text
) RETURNS TABLE(
  id uuid,
  receipt_snapshot_id uuid,
  receipt_number text,
  channel text,
  destination_masked text,
  requested_at timestamptz,
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
  v_request_hash text;
  v_receipt pos.receipt_snapshots%ROWTYPE;
  v_existing pos.receipt_delivery_requests%ROWTYPE;
  v_created pos.receipt_delivery_requests%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR btrim(v_request_id) = '' THEN
    RAISE EXCEPTION 'tenant, actor and request context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_receipt_snapshot_id IS NULL
     OR p_channel NOT IN ('print','email','sms')
     OR length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'receipt delivery request is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_channel = 'print' AND p_destination_masked IS NOT NULL)
     OR (
       p_channel IN ('email','sms')
       AND length(btrim(COALESCE(p_destination_masked, ''))) NOT BETWEEN 3 AND 200
     ) THEN
    RAISE EXCEPTION 'receipt delivery destination is invalid' USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(concat_ws(
    '|',
    p_receipt_snapshot_id::text,
    p_channel,
    COALESCE(p_destination_masked, ''),
    btrim(p_reason)
  ));

  SELECT receipt.* INTO v_receipt
  FROM pos.receipt_snapshots AS receipt
  WHERE receipt.tenant_id = v_tenant_id
    AND receipt.id = p_receipt_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt snapshot does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT request.* INTO v_existing
  FROM pos.receipt_delivery_requests AS request
  WHERE request.tenant_id = v_tenant_id
    AND request.receipt_snapshot_id = p_receipt_snapshot_id
    AND request.idempotency_key = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.id IS DISTINCT FROM p_id
       OR v_existing.channel IS DISTINCT FROM p_channel
       OR v_existing.destination IS DISTINCT FROM p_destination_masked
       OR v_existing.reason IS DISTINCT FROM btrim(p_reason)
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'receipt delivery request ID was reused with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.receipt_snapshot_id, v_receipt.receipt_number,
      v_existing.channel, v_existing.destination, v_existing.requested_at, true;
    RETURN;
  END IF;

  INSERT INTO pos.receipt_delivery_requests(
    id, tenant_id, receipt_snapshot_id, channel, destination, requested_by,
    requested_at, idempotency_key, request_hash, reason
  ) VALUES (
    p_id, v_tenant_id, p_receipt_snapshot_id, p_channel, p_destination_masked,
    v_actor_id, now(), v_request_id, v_request_hash, btrim(p_reason)
  )
  RETURNING * INTO v_created;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.receipt.delivery.requested.v1', 'pos.receipt.deliver',
    'success', v_actor_id, 'pos.receipt', p_receipt_snapshot_id::text, v_request_id, v_trace_id,
    jsonb_build_object(
      'deliveryRequestId', v_created.id,
      'receiptNumber', v_receipt.receipt_number,
      'channel', p_channel,
      'destinationMasked', p_destination_masked
    ),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.receipt.delivery.requested.v1', 'pos.receipt',
    p_receipt_snapshot_id::text, '1.0',
    jsonb_build_object(
      'deliveryRequestId', v_created.id,
      'receiptSnapshotId', p_receipt_snapshot_id,
      'receiptNumber', v_receipt.receipt_number,
      'channel', p_channel,
      'destinationMasked', p_destination_masked
    ),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT v_created.id, v_created.receipt_snapshot_id, v_receipt.receipt_number,
    v_created.channel, v_created.destination, v_created.requested_at, false;
END $$;

REVOKE ALL ON FUNCTION pos.request_receipt_delivery_v1(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pos.request_receipt_delivery_v1(uuid,uuid,text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0008','MOD-D-POS','manifest:POS-0008-receipt-delivery.sql');

COMMIT;
