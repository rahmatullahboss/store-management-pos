BEGIN;

CREATE TABLE IF NOT EXISTS platform.reference_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
ALTER TABLE platform.reference_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.reference_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.reference_records;
CREATE POLICY tenant_isolation ON platform.reference_records USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON platform.reference_records TO store_app_runtime;
REVOKE DELETE ON platform.reference_records FROM store_app_runtime;
GRANT SELECT ON platform.reference_records TO store_app_reporting;

CREATE OR REPLACE FUNCTION platform.create_reference_record(
  p_idempotency_key text,
  p_request_hash text,
  p_name text,
  p_request_id text
) RETURNS TABLE(id uuid, name text, version bigint, created_at timestamptz, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(), p_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_id uuid;
  v_name text;
  v_version bigint;
  v_created_at timestamptz;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE = '42501'; END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 THEN RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_existing FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id AND scope = 'platform.reference.create' AND idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001'; END IF;
    IF v_existing.status = 'completed' THEN
      v_id := (v_existing.response_json->>'id')::uuid;
      SELECT r.name, r.version, r.created_at INTO v_name, v_version, v_created_at
        FROM platform.reference_records r WHERE r.tenant_id = v_tenant_id AND r.id = v_id;
      RETURN QUERY SELECT v_id, v_name, v_version, v_created_at, true;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'platform.reference.create', p_idempotency_key, p_request_hash, 'processing');

  v_id := gen_random_uuid();
  INSERT INTO platform.reference_records(id, tenant_id, name, created_by)
  VALUES (v_id, v_tenant_id, p_name, v_actor_id)
  RETURNING platform.reference_records.name, platform.reference_records.version, platform.reference_records.created_at
    INTO v_name, v_version, v_created_at;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'platform.reference.created.v1', 'platform.reference.create', 'success', v_actor_id,
    'platform.reference_record', v_id::text, p_request_id, v_trace_id, jsonb_build_object('name', p_name), v_business_date, 'foundation-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version, payload, metadata,
    correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'platform.reference.created.v1', 'platform.reference_record', v_id::text, '1.0',
    jsonb_build_object('id', v_id, 'name', p_name, 'version', v_version), jsonb_build_object('requestId', p_request_id),
    p_request_id, v_created_at, v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 201,
    response_json = jsonb_build_object('id', v_id, 'name', p_name, 'version', v_version, 'createdAt', v_created_at),
    resource_type = 'platform.reference_record', resource_id = v_id::text, updated_at = now()
  WHERE tenant_id = v_tenant_id AND scope = 'platform.reference.create' AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_id, v_name, v_version, v_created_at, false;
END $$;

CREATE OR REPLACE FUNCTION platform.claim_inbox_event(p_consumer_name text, p_event_id uuid, p_payload_hash text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform AS $$
DECLARE v_tenant_id uuid := platform.current_tenant_id(); v_existing_hash text;
BEGIN
  INSERT INTO platform.inbox_receipts(tenant_id, consumer_name, event_id, payload_hash, status)
  VALUES (v_tenant_id, p_consumer_name, p_event_id, p_payload_hash, 'processing')
  ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN true; END IF;
  SELECT payload_hash INTO v_existing_hash FROM platform.inbox_receipts
    WHERE tenant_id = v_tenant_id AND consumer_name = p_consumer_name AND event_id = p_event_id;
  IF v_existing_hash <> p_payload_hash THEN RAISE EXCEPTION 'inbox payload hash mismatch' USING ERRCODE = 'P0001'; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION platform.complete_inbox_event(p_consumer_name text, p_event_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, platform AS $$
  UPDATE platform.inbox_receipts SET status = 'completed', completed_at = now()
  WHERE tenant_id = platform.current_tenant_id() AND consumer_name = p_consumer_name AND event_id = p_event_id
$$;

GRANT EXECUTE ON FUNCTION platform.create_reference_record(text,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION platform.claim_inbox_event(text,uuid,text), platform.complete_inbox_event(text,uuid) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('FND-0003','FOUNDATION','manifest:FND-0003-reference-slice.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
