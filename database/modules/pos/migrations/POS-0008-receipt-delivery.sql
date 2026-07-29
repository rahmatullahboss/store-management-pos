BEGIN;

CREATE TABLE pos.receipt_delivery_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  receipt_snapshot_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('print','email','sms')),
  destination_masked text NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_snapshot_id, request_id),
  FOREIGN KEY (tenant_id, receipt_snapshot_id) REFERENCES pos.receipt_snapshots(tenant_id, id),
  CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CHECK (
    (channel = 'print' AND destination_masked IS NULL)
    OR (channel IN ('email','sms') AND length(btrim(COALESCE(destination_masked, ''))) BETWEEN 3 AND 200)
  )
);
CREATE INDEX receipt_delivery_requests_receipt_idx
  ON pos.receipt_delivery_requests(tenant_id, receipt_snapshot_id, requested_at DESC, id);

CREATE TRIGGER receipt_delivery_requests_append_only
  BEFORE UPDATE OR DELETE ON pos.receipt_delivery_requests
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

ALTER TABLE pos.receipt_delivery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.receipt_delivery_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos.receipt_delivery_requests
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

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
  v_receipt pos.receipt_snapshots%ROWTYPE;
  v_existing pos.receipt_delivery_requests%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_receipt_snapshot_id IS NULL
     OR p_channel NOT IN ('print','email','sms')
     OR length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'receipt delivery request is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_channel = 'print' AND p_destination_masked IS NOT NULL)
     OR (p_channel IN ('email','sms') AND length(btrim(COALESCE(p_destination_masked, ''))) NOT BETWEEN 3 AND 200) THEN
    RAISE EXCEPTION 'receipt delivery destination is invalid' USING ERRCODE = '22023';
  END IF;

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
    AND request.request_id = v_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.channel IS DISTINCT FROM p_channel
       OR v_existing.destination_masked IS DISTINCT FROM p_destination_masked
       OR v_existing.reason IS DISTINCT FROM btrim(p_reason) THEN
      RAISE EXCEPTION 'receipt delivery request ID was reused with different content' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.receipt_snapshot_id, v_receipt.receipt_number,
      v_existing.channel, v_existing.destination_masked, v_existing.requested_at, true;
    RETURN;
  END IF;

  INSERT INTO pos.receipt_delivery_requests(
    id, tenant_id, receipt_snapshot_id, channel, destination_masked, reason,
    requested_by, request_id, trace_id
  ) VALUES (
    p_id, v_tenant_id, p_receipt_snapshot_id, p_channel, p_destination_masked,
    btrim(p_reason), v_actor_id, v_request_id, v_trace_id
  )
  RETURNING receipt_delivery_requests.id, receipt_delivery_requests.receipt_snapshot_id,
    receipt_delivery_requests.channel, receipt_delivery_requests.destination_masked,
    receipt_delivery_requests.requested_at
  INTO id, receipt_snapshot_id, channel, destination_masked, requested_at;

  receipt_number := v_receipt.receipt_number;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.receipt.delivery.requested.v1', 'pos.receipt.deliver',
    'success', v_actor_id, 'pos.receipt', p_receipt_snapshot_id::text, v_request_id, v_trace_id,
    jsonb_build_object('receiptNumber', v_receipt.receipt_number, 'channel', p_channel, 'destinationMasked', p_destination_masked),
    v_business_date, 'mod-d-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'pos.receipt.delivery.requested.v1', 'pos.receipt',
    p_receipt_snapshot_id::text, '1.0',
    jsonb_build_object(
      'deliveryRequestId', id,
      'receiptSnapshotId', p_receipt_snapshot_id,
      'receiptNumber', v_receipt.receipt_number,
      'channel', p_channel,
      'destinationMasked', p_destination_masked
    ),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  replayed := false;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION pos.request_receipt_delivery_v1(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pos.request_receipt_delivery_v1(uuid,uuid,text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0008','MOD-D-POS','manifest:POS-0008-receipt-delivery.sql');

COMMIT;
