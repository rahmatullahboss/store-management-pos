BEGIN;

CREATE TABLE pos.register_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  business_date date NOT NULL,
  operating_mode text NOT NULL DEFAULT 'online' CHECK (operating_mode IN ('online','offline_authorized','offline_blocked')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','closing','closed','revoked')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  device_id text NOT NULL,
  projection_version text NOT NULL,
  last_sync_cursor text NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR status <> 'closed')
);
CREATE INDEX pos_register_sessions_open_idx ON pos.register_sessions(tenant_id, register_id, opened_at DESC) WHERE status <> 'closed';

CREATE TABLE pos.device_enrollments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id text NOT NULL,
  public_key_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','degraded','revoked')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by uuid NOT NULL REFERENCES platform.users(id),
  last_seen_at timestamptz NULL,
  last_clock_drift_ms bigint NULL,
  last_storage_pressure text NULL CHECK (last_storage_pressure IS NULL OR last_storage_pressure IN ('normal','warning','critical')),
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES platform.users(id),
  revoke_reason text NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL) OR status <> 'revoked')
);

CREATE TABLE pos.offline_authorizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  register_id uuid NOT NULL,
  device_enrollment_id uuid NOT NULL,
  issued_to_user_id uuid NOT NULL REFERENCES platform.users(id),
  token_fingerprint text NOT NULL,
  capability_snapshot jsonb NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  per_sale_limit_minor bigint NOT NULL CHECK (per_sale_limit_minor >= 0),
  cumulative_limit_minor bigint NOT NULL CHECK (cumulative_limit_minor >= 0),
  consumed_minor bigint NOT NULL DEFAULT 0 CHECK (consumed_minor >= 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  revoke_reason text NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, token_fingerprint),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_enrollment_id) REFERENCES pos.device_enrollments(tenant_id, id),
  CHECK (expires_at > issued_at),
  CHECK (consumed_minor <= cumulative_limit_minor)
);
CREATE INDEX pos_offline_authorizations_active_idx ON pos.offline_authorizations(tenant_id, register_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE pos.receipt_number_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  register_id uuid NOT NULL,
  device_enrollment_id uuid NOT NULL,
  prefix text NOT NULL,
  range_start bigint NOT NULL,
  range_end bigint NOT NULL,
  next_number bigint NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  exhausted_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_id, prefix, range_start, range_end),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_enrollment_id) REFERENCES pos.device_enrollments(tenant_id, id),
  CHECK (range_start > 0 AND range_end >= range_start),
  CHECK (next_number BETWEEN range_start AND range_end + 1),
  CHECK (expires_at > issued_at)
);

CREATE TABLE pos.carts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  register_session_id uuid NOT NULL,
  register_id uuid NOT NULL,
  customer_id uuid NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','checkout_pending','completed','cancelled')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  gross_minor bigint NOT NULL DEFAULT 0,
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  payable_minor bigint NOT NULL DEFAULT 0,
  price_snapshot_version text NOT NULL,
  tax_snapshot_version text NOT NULL,
  permission_snapshot_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_session_id) REFERENCES pos.register_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id),
  CHECK (payable_minor = gross_minor - discount_minor + tax_minor),
  CHECK (discount_minor <= gross_minor),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);
CREATE INDEX pos_carts_active_idx ON pos.carts(tenant_id, register_id, updated_at DESC)
  WHERE status IN ('active','suspended','checkout_pending');

CREATE TABLE pos.cart_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  variant_id uuid NOT NULL,
  barcode text NULL,
  quantity numeric(30,12) NOT NULL CHECK (quantity > 0),
  unit_code text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  unit_price_minor bigint NOT NULL,
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  line_payable_minor bigint NOT NULL,
  price_snapshot jsonb NOT NULL,
  tax_snapshot jsonb NOT NULL,
  approval_request_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cart_id, line_number),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variants(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);

CREATE TABLE pos.checkout_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  operation_id text NOT NULL,
  device_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('online','offline')),
  state text NOT NULL CHECK (state IN ('received','processing','payment_unknown','accepted','rejected','review_required')),
  payment_intent_ids uuid[] NOT NULL DEFAULT '{}',
  sale_id uuid NULL,
  receipt_snapshot_id uuid NULL,
  rejection_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES sales.orders(tenant_id, id)
);
CREATE INDEX pos_checkout_attempts_unresolved_idx ON pos.checkout_attempts(tenant_id, created_at)
  WHERE state IN ('received','processing','payment_unknown','review_required');

CREATE TABLE pos.receipt_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  register_id uuid NOT NULL,
  checkout_attempt_id uuid NOT NULL,
  receipt_number text NOT NULL,
  business_date date NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  payable_minor bigint NOT NULL,
  semantic_snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  local_created_at timestamptz NOT NULL,
  canonical_created_at timestamptz NULL,
  delivery_requests jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_id, receipt_number),
  UNIQUE (tenant_id, checkout_attempt_id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, checkout_attempt_id) REFERENCES pos.checkout_attempts(tenant_id, id)
);

CREATE TABLE pos.offline_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_enrollment_id uuid NOT NULL,
  register_id uuid NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  payload_version text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  local_committed_at timestamptz NOT NULL,
  authorization_id uuid NULL,
  receipt_snapshot_id uuid NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','uploading','accepted','rejected','review_required')),
  server_reference text NULL,
  rejection_code text NULL,
  resolved_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_enrollment_id, operation_id),
  UNIQUE (tenant_id, device_enrollment_id, sequence),
  FOREIGN KEY (tenant_id, device_enrollment_id) REFERENCES pos.device_enrollments(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, authorization_id) REFERENCES pos.offline_authorizations(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_snapshot_id) REFERENCES pos.receipt_snapshots(tenant_id, id),
  CHECK ((state IN ('accepted','rejected','review_required') AND resolved_at IS NOT NULL) OR state IN ('pending','uploading'))
);
CREATE INDEX pos_offline_operations_upload_idx ON pos.offline_operations(tenant_id, device_enrollment_id, sequence)
  WHERE state IN ('pending','uploading');

CREATE TABLE pos.sync_cursors (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_enrollment_id uuid NOT NULL,
  projection_name text NOT NULL,
  cursor_value text NOT NULL,
  projection_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_enrollment_id, projection_name),
  FOREIGN KEY (tenant_id, device_enrollment_id) REFERENCES pos.device_enrollments(tenant_id, id)
);

CREATE OR REPLACE FUNCTION pos.protect_receipt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'receipt snapshots are immutable' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER pos_receipt_snapshots_immutable
BEFORE UPDATE OR DELETE ON pos.receipt_snapshots
FOR EACH ROW EXECUTE FUNCTION pos.protect_receipt_snapshot();

CREATE OR REPLACE FUNCTION pos.protect_offline_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.device_enrollment_id IS DISTINCT FROM NEW.device_enrollment_id
    OR OLD.register_id IS DISTINCT FROM NEW.register_id
    OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
    OR OLD.operation_type IS DISTINCT FROM NEW.operation_type
    OR OLD.sequence IS DISTINCT FROM NEW.sequence
    OR OLD.payload_version IS DISTINCT FROM NEW.payload_version
    OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.local_committed_at IS DISTINCT FROM NEW.local_committed_at
    OR OLD.authorization_id IS DISTINCT FROM NEW.authorization_id
    OR OLD.receipt_snapshot_id IS DISTINCT FROM NEW.receipt_snapshot_id THEN
    RAISE EXCEPTION 'offline operation identity and durable payload are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.state IN ('accepted','rejected','review_required') AND ROW(OLD.state, OLD.server_reference, OLD.rejection_code, OLD.resolved_at)
    IS DISTINCT FROM ROW(NEW.state, NEW.server_reference, NEW.rejection_code, NEW.resolved_at) THEN
    RAISE EXCEPTION 'resolved offline operation outcome is immutable; append an adjustment operation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_offline_operation_identity_immutable
BEFORE UPDATE ON pos.offline_operations
FOR EACH ROW EXECUTE FUNCTION pos.protect_offline_operation_identity();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'register_sessions','device_enrollments','offline_authorizations','receipt_number_allocations',
    'carts','cart_lines','checkout_attempts','receipt_snapshots','offline_operations','sync_cursors'
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
  ('pos.read','pos','Read POS sessions, carts, receipts and synchronization state','sensitive'),
  ('pos.session.open','pos','Open a register session','sensitive'),
  ('pos.checkout','pos','Complete online POS checkout','privileged'),
  ('pos.checkout.offline','pos','Accept a checkout under a valid offline authorization','privileged'),
  ('pos.discount.override','pos','Apply controlled discount or price override','privileged'),
  ('pos.return','pos','Process POS return, refund or exchange','privileged'),
  ('pos.reconcile','pos','Resolve rejected or review-required offline operations','privileged'),
  ('pos.device.manage','pos','Enroll, revoke and inspect register devices','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA pos TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA pos TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pos FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0001','MOD-D-POS','manifest:POS-0001-pos-offline-core.sql');

COMMIT;
