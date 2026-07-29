BEGIN;

CREATE TABLE pos.devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  enrollment_key_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','degraded','revoked')),
  hardware_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  clock_drift_ms bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);

CREATE TABLE pos.register_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  opened_at timestamptz NOT NULL,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','closing','closed','revoked')),
  closed_by uuid NULL REFERENCES platform.users(id),
  closed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX register_sessions_one_open_idx
  ON pos.register_sessions(tenant_id, register_id)
  WHERE status IN ('open','suspended','closing');

CREATE TABLE pos.offline_authorizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  permission_snapshot_hash text NOT NULL,
  capability_scope jsonb NOT NULL,
  max_operation_minor bigint NOT NULL CHECK (max_operation_minor >= 0),
  max_total_minor bigint NOT NULL CHECK (max_total_minor >= 0),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  signature_key_id text NOT NULL,
  signature text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  CHECK (expires_at > issued_at)
);

CREATE TABLE pos.receipt_number_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  prefix text NOT NULL,
  range_start bigint NOT NULL,
  range_end bigint NOT NULL,
  next_number bigint NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','expired','revoked')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  CHECK (range_start > 0 AND range_end >= range_start),
  CHECK (next_number BETWEEN range_start AND range_end + 1),
  CHECK (expires_at > issued_at)
);

CREATE TABLE pos.checkouts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  register_session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  operation_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('online','offline')),
  status text NOT NULL CHECK (status IN ('processing','accepted','rejected','review_required','payment_unknown')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  tender_snapshot jsonb NOT NULL,
  line_snapshot jsonb NOT NULL,
  payment_intent_ids text[] NOT NULL DEFAULT '{}',
  stock_posting_ids text[] NOT NULL DEFAULT '{}',
  accounting_posting_id text NULL,
  customer_id uuid NULL,
  offline_authorization_id uuid NULL,
  receipt_number_allocation_id uuid NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, register_session_id) REFERENCES pos.register_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, offline_authorization_id) REFERENCES pos.offline_authorizations(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_number_allocation_id) REFERENCES pos.receipt_number_allocations(tenant_id, id),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor),
  CHECK (discount_minor <= subtotal_minor),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);
CREATE INDEX checkouts_register_business_idx ON pos.checkouts(tenant_id, register_id, created_at DESC);
CREATE INDEX checkouts_review_idx ON pos.checkouts(tenant_id, status, created_at) WHERE status IN ('review_required','payment_unknown');

CREATE TABLE pos.receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  checkout_id uuid NOT NULL,
  receipt_number text NOT NULL,
  sale_id text NOT NULL,
  business_date date NOT NULL,
  issued_at timestamptz NOT NULL,
  semantic_snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  source_mode text NOT NULL CHECK (source_mode IN ('online','offline')),
  source_operation_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, checkout_id),
  FOREIGN KEY (tenant_id, checkout_id) REFERENCES pos.checkouts(tenant_id, id)
);

CREATE TABLE pos.offline_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  register_id uuid NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  payload_version text NOT NULL,
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  local_sequence bigint NOT NULL CHECK (local_sequence > 0),
  local_committed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','accepted','rejected','review_required')),
  server_reference text NULL,
  rejection_code text NULL,
  receipt_id uuid NULL,
  resolved_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, device_id, local_sequence),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES pos.receipts(tenant_id, id)
);
CREATE INDEX offline_operations_upload_idx ON pos.offline_operations(tenant_id, device_id, local_sequence)
  WHERE status IN ('pending','uploading');

CREATE OR REPLACE FUNCTION pos.protect_checkout_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.register_id IS DISTINCT FROM NEW.register_id
    OR OLD.device_id IS DISTINCT FROM NEW.device_id
    OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
    OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.scale IS DISTINCT FROM NEW.scale
    OR OLD.total_minor IS DISTINCT FROM NEW.total_minor
    OR OLD.line_snapshot IS DISTINCT FROM NEW.line_snapshot
    OR OLD.tender_snapshot IS DISTINCT FROM NEW.tender_snapshot
  THEN
    RAISE EXCEPTION 'checkout identity, totals and snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_identity_immutable BEFORE UPDATE ON pos.checkouts
  FOR EACH ROW EXECUTE FUNCTION pos.protect_checkout_identity();

CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON pos.receipts
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION pos.protect_offline_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.device_id IS DISTINCT FROM NEW.device_id
    OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
    OR OLD.operation_type IS DISTINCT FROM NEW.operation_type
    OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.local_sequence IS DISTINCT FROM NEW.local_sequence
    OR OLD.local_committed_at IS DISTINCT FROM NEW.local_committed_at
  THEN
    RAISE EXCEPTION 'offline operation envelope is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('accepted','rejected','review_required') AND
    (OLD.status IS DISTINCT FROM NEW.status OR OLD.server_reference IS DISTINCT FROM NEW.server_reference OR OLD.rejection_code IS DISTINCT FROM NEW.rejection_code)
  THEN
    RAISE EXCEPTION 'resolved offline operation outcome is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offline_operation_identity_immutable BEFORE UPDATE ON pos.offline_operations
  FOR EACH ROW EXECUTE FUNCTION pos.protect_offline_operation_identity();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'devices','register_sessions','offline_authorizations','receipt_number_allocations',
    'checkouts','receipts','offline_operations'
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
  ('pos.checkout','pos','Complete POS checkout operations','privileged'),
  ('pos.checkout.offline','pos','Complete approved offline POS checkout operations','privileged'),
  ('pos.discount.override','pos','Apply controlled POS price or discount overrides','privileged'),
  ('pos.receipt.read','pos','Read immutable POS receipt snapshots','sensitive'),
  ('pos.reconciliation.read','pos','Review rejected and adjusted offline operations','sensitive'),
  ('pos.device.manage','pos','Enroll, revoke and inspect POS devices','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA pos TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA pos TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pos FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0001','MOD-D-POS','manifest:POS-0001-pos-offline-core.sql');

COMMIT;
