BEGIN;

ALTER TABLE pos.offline_authorizations
  ADD COLUMN legal_entity_id uuid NOT NULL,
  ADD COLUMN store_id uuid NOT NULL,
  ADD COLUMN cashier_id uuid NOT NULL REFERENCES platform.users(id),
  ADD COLUMN permission_snapshot_version text NOT NULL,
  ADD COLUMN country_capability_version text NOT NULL,
  ADD COLUMN receipt_number_allocation_id text NOT NULL,
  ADD COLUMN signature text NOT NULL,
  ADD COLUMN key_id text NOT NULL,
  ADD CONSTRAINT offline_authorizations_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  ADD CONSTRAINT offline_authorizations_store_fk
    FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  ADD CONSTRAINT offline_authorizations_receipt_allocation_unique
    UNIQUE (tenant_id, receipt_number_allocation_id),
  ADD CONSTRAINT offline_authorizations_signature_present
    CHECK (btrim(signature) <> '' AND btrim(key_id) <> ''),
  ADD CONSTRAINT offline_authorizations_versions_present
    CHECK (btrim(permission_snapshot_version) <> '' AND btrim(country_capability_version) <> '');

CREATE TABLE pos.offline_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  register_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  operation_id text NOT NULL,
  device_sequence bigint NOT NULL CHECK (device_sequence > 0),
  operation_type text NOT NULL CHECK (operation_type IN (
    'checkout','cash_event','shift_open','shift_close','receipt_delivery','device_health'
  )),
  aggregate_id text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  recorded_at timestamptz NOT NULL,
  local_schema_version text NOT NULL,
  app_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, device_id, device_sequence),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, authorization_id) REFERENCES pos.offline_authorizations(tenant_id, id),
  CHECK (btrim(operation_id) <> ''),
  CHECK (btrim(payload_hash) <> ''),
  CHECK (btrim(local_schema_version) <> '' AND btrim(app_version) <> '')
);
CREATE INDEX offline_operations_upload_idx
  ON pos.offline_operations(tenant_id, device_id, device_sequence, id);

CREATE TABLE pos.offline_operation_outcomes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  offline_operation_id uuid NOT NULL,
  outcome_sequence bigint GENERATED ALWAYS AS IDENTITY,
  status text NOT NULL CHECK (status IN ('applied','duplicate','rejected','review_required','deferred')),
  server_sequence bigint NULL CHECK (server_sequence IS NULL OR server_sequence > 0),
  business_effect_ids text[] NOT NULL DEFAULT '{}',
  reason_code text NULL,
  reason_message text NULL,
  reviewed_by uuid NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, offline_operation_id, outcome_sequence),
  FOREIGN KEY (tenant_id, offline_operation_id) REFERENCES pos.offline_operations(tenant_id, id)
);
CREATE INDEX offline_operation_outcomes_status_idx
  ON pos.offline_operation_outcomes(tenant_id, status, observed_at, id);
CREATE UNIQUE INDEX offline_operation_terminal_outcome_unique
  ON pos.offline_operation_outcomes(tenant_id, offline_operation_id)
  WHERE status IN ('applied','duplicate','rejected','review_required');

CREATE OR REPLACE FUNCTION pos.validate_offline_operation_outcome_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM pos.offline_operations
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.offline_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'offline operation does not exist' USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pos.offline_operation_outcomes
    WHERE tenant_id = NEW.tenant_id
      AND offline_operation_id = NEW.offline_operation_id
      AND status IN ('applied','duplicate','rejected','review_required')
  ) THEN
    RAISE EXCEPTION 'terminal offline outcome is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER offline_operation_outcome_insert_guard
  BEFORE INSERT ON pos.offline_operation_outcomes
  FOR EACH ROW EXECUTE FUNCTION pos.validate_offline_operation_outcome_insert();

CREATE TABLE pos.receipt_delivery_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  receipt_snapshot_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('print','email','sms')),
  destination text NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_snapshot_id, idempotency_key),
  FOREIGN KEY (tenant_id, receipt_snapshot_id) REFERENCES pos.receipt_snapshots(tenant_id, id),
  CHECK ((channel = 'print') OR (destination IS NOT NULL AND btrim(destination) <> ''))
);

CREATE TABLE pos.receipt_delivery_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  receipt_delivery_request_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','processing','delivered','failed','cancelled')),
  provider_reference text NULL,
  failure_code text NULL,
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_delivery_request_id) REFERENCES pos.receipt_delivery_requests(tenant_id, id)
);
CREATE INDEX receipt_delivery_events_request_idx
  ON pos.receipt_delivery_events(tenant_id, receipt_delivery_request_id, observed_at, id);

CREATE TRIGGER offline_operations_append_only
  BEFORE UPDATE OR DELETE ON pos.offline_operations
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER offline_operation_outcomes_append_only
  BEFORE UPDATE OR DELETE ON pos.offline_operation_outcomes
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER receipt_delivery_requests_append_only
  BEFORE UPDATE OR DELETE ON pos.receipt_delivery_requests
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER receipt_delivery_events_append_only
  BEFORE UPDATE OR DELETE ON pos.receipt_delivery_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'offline_operations','offline_operation_outcomes',
    'receipt_delivery_requests','receipt_delivery_events'
  ] LOOP
    EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE pos.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON pos.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('pos.sync.read','pos','Read durable offline operations and explicit synchronization outcomes','sensitive'),
  ('pos.sync.execute','pos','Upload signed offline operations and receive idempotent outcomes','privileged'),
  ('pos.sync.review','pos','Review rejected or conflicted offline operations without rewriting receipt evidence','privileged'),
  ('pos.receipt.deliver','pos','Request print, email or SMS delivery from an immutable receipt snapshot','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT SELECT ON pos.offline_operations, pos.offline_operation_outcomes,
  pos.receipt_delivery_requests, pos.receipt_delivery_events
  TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON pos.offline_operations, pos.offline_operation_outcomes,
  pos.receipt_delivery_requests, pos.receipt_delivery_events
  FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0003','MOD-D-POS','manifest:POS-0003-offline-sync-security.sql');

COMMIT;
