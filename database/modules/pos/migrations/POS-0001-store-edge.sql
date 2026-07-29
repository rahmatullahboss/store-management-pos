BEGIN;

CREATE TABLE pos.devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NULL,
  device_key text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','revoked')),
  clock_drift_seconds integer NOT NULL DEFAULT 0,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrolled_by uuid NOT NULL REFERENCES platform.users(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_key),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);

CREATE TABLE pos.register_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','closed','revoked')),
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid NULL REFERENCES platform.users(id),
  closed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR status <> 'closed')
);
CREATE UNIQUE INDEX register_sessions_open_unique
  ON pos.register_sessions(tenant_id, register_id)
  WHERE status IN ('open','suspended');

CREATE TABLE pos.checkout_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  session_id uuid NOT NULL,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('online','offline')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  payment_state text NOT NULL CHECK (payment_state IN ('not_required','accepted','captured','unknown','declined')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','review','unknown')),
  cart_snapshot jsonb NOT NULL,
  tender_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  sales_reference text NULL,
  rejection_code text NULL,
  occurred_at timestamptz NOT NULL,
  committed_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES pos.register_sessions(tenant_id, id),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor),
  CHECK (discount_minor <= subtotal_minor),
  CHECK (payment_state <> 'unknown' OR status IN ('pending','unknown','review')),
  CHECK (status <> 'accepted' OR payment_state IN ('not_required','accepted','captured'))
);
CREATE INDEX checkout_operations_sync_idx
  ON pos.checkout_operations(tenant_id, device_id, status, committed_at, id);
CREATE INDEX checkout_operations_business_idx
  ON pos.checkout_operations(tenant_id, register_id, occurred_at, id);

CREATE TABLE pos.receipt_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  checkout_operation_id uuid NOT NULL,
  receipt_number text NOT NULL,
  business_date date NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  semantic_payload jsonb NOT NULL,
  content_hash text NOT NULL,
  render_status text NOT NULL DEFAULT 'pending' CHECK (render_status IN ('pending','rendered','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, checkout_operation_id),
  FOREIGN KEY (tenant_id, checkout_operation_id) REFERENCES pos.checkout_operations(tenant_id, id)
);

CREATE TABLE pos.offline_authorizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  register_id uuid NOT NULL,
  permission_codes text[] NOT NULL DEFAULT '{}',
  risk_limits jsonb NOT NULL,
  receipt_range_start bigint NOT NULL,
  receipt_range_end bigint NOT NULL,
  signed_claim_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  issued_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, signed_claim_hash),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  CHECK (receipt_range_end >= receipt_range_start),
  CHECK (expires_at > issued_at)
);
CREATE INDEX offline_authorizations_active_idx
  ON pos.offline_authorizations(tenant_id, device_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE pos.sync_outcomes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  checkout_operation_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted','rejected','review')),
  server_reference text NULL,
  rejection_code text NULL,
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, checkout_operation_id),
  FOREIGN KEY (tenant_id, checkout_operation_id) REFERENCES pos.checkout_operations(tenant_id, id)
);

CREATE TABLE pos.device_health_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  device_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy','degraded','offline','revoked')),
  clock_drift_seconds integer NOT NULL,
  storage_pressure_percent smallint NULL CHECK (storage_pressure_percent BETWEEN 0 AND 100),
  capability_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id)
);
CREATE INDEX device_health_events_device_idx
  ON pos.device_health_events(tenant_id, device_id, observed_at DESC, id);

CREATE OR REPLACE FUNCTION pos.protect_checkout_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.register_id IS DISTINCT FROM NEW.register_id
     OR OLD.device_id IS DISTINCT FROM NEW.device_id
     OR OLD.session_id IS DISTINCT FROM NEW.session_id
     OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
     OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
     OR OLD.mode IS DISTINCT FROM NEW.mode
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.scale IS DISTINCT FROM NEW.scale
     OR OLD.subtotal_minor IS DISTINCT FROM NEW.subtotal_minor
     OR OLD.discount_minor IS DISTINCT FROM NEW.discount_minor
     OR OLD.tax_minor IS DISTINCT FROM NEW.tax_minor
     OR OLD.total_minor IS DISTINCT FROM NEW.total_minor
     OR OLD.cart_snapshot IS DISTINCT FROM NEW.cart_snapshot
     OR OLD.tender_snapshot IS DISTINCT FROM NEW.tender_snapshot
     OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
     OR OLD.committed_at IS DISTINCT FROM NEW.committed_at THEN
    RAISE EXCEPTION 'checkout operation identity and financial snapshot are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('accepted','rejected','review') AND
     (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.sales_reference IS DISTINCT FROM NEW.sales_reference
      OR OLD.rejection_code IS DISTINCT FROM NEW.rejection_code) THEN
    RAISE EXCEPTION 'resolved checkout outcome requires an adjustment operation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_operation_identity_immutable
  BEFORE UPDATE ON pos.checkout_operations
  FOR EACH ROW EXECUTE FUNCTION pos.protect_checkout_identity();

CREATE TRIGGER receipt_snapshots_append_only
  BEFORE UPDATE OR DELETE ON pos.receipt_snapshots
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER sync_outcomes_append_only
  BEFORE UPDATE OR DELETE ON pos.sync_outcomes
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER device_health_events_append_only
  BEFORE UPDATE OR DELETE ON pos.device_health_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'devices','register_sessions','checkout_operations','receipt_snapshots',
    'offline_authorizations','sync_outcomes','device_health_events'
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
  ('pos.checkout.read','pos','Read register sessions, checkout operations and receipt snapshots','sensitive'),
  ('pos.checkout.execute','pos','Execute online checkout operations','privileged'),
  ('pos.checkout.offline','pos','Execute approved offline checkout operations','privileged'),
  ('pos.checkout.resolve','pos','Resolve rejected or review-required checkout operations','privileged'),
  ('pos.device.manage','pos','Enroll, revoke and inspect register devices','privileged'),
  ('pos.receipt.reprint','pos','Request receipt re-rendering without changing the immutable snapshot','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA pos TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA pos TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pos FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0001','MOD-D-POS','manifest:POS-0001-store-edge.sql');

COMMIT;
