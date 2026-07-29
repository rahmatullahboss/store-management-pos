BEGIN;

CREATE TABLE pos.register_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id text NOT NULL,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed','revoked')),
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);

CREATE TABLE pos.devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_key text NOT NULL,
  enrollment_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','degraded','revoked')),
  clock_drift_seconds integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_key),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);

CREATE TABLE pos.carts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  session_id uuid NOT NULL,
  customer_id uuid NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','checkout_pending','completed','cancelled')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz NULL,
  completed_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES pos.register_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);

CREATE TABLE pos.cart_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity numeric(30, 10) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  price_snapshot_id text NOT NULL,
  tax_snapshot_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cart_id, id),
  CHECK (discount_minor <= unit_price_minor * quantity),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id)
);

CREATE TABLE pos.checkout_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  device_id uuid NOT NULL,
  operation_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  payable_minor bigint NOT NULL CHECK (payable_minor >= 0),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  payment_state text NOT NULL CHECK (payment_state IN ('not_started','pending','confirmed','unknown','declined')),
  outcome text NOT NULL CHECK (outcome IN ('processing','accepted','rejected','review')),
  server_reference text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, cart_id, idempotency_key),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id)
);
CREATE INDEX pos_checkout_attempts_processing_idx ON pos.checkout_attempts(tenant_id, created_at) WHERE outcome = 'processing';

CREATE TABLE pos.receipt_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  checkout_attempt_id uuid NOT NULL,
  receipt_number text NOT NULL,
  semantic_snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  rendered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, checkout_attempt_id),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  FOREIGN KEY (tenant_id, checkout_attempt_id) REFERENCES pos.checkout_attempts(tenant_id, id)
);

CREATE TABLE pos.offline_authorizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  authorization_hash text NOT NULL,
  permission_codes text[] NOT NULL,
  max_sale_minor bigint NOT NULL CHECK (max_sale_minor >= 0),
  max_total_minor bigint NOT NULL CHECK (max_total_minor >= 0),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  receipt_range_start bigint NOT NULL,
  receipt_range_end bigint NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  CHECK (receipt_range_end >= receipt_range_start),
  CHECK (expires_at > issued_at),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, authorization_hash),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id)
);

CREATE TABLE pos.offline_operation_results (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  payload_hash text NOT NULL,
  receipt_snapshot_id uuid NULL,
  disposition text NOT NULL CHECK (disposition IN ('accepted','duplicate','rejected','review')),
  server_reference text NULL,
  rejection_code text NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_snapshot_id) REFERENCES pos.receipt_snapshots(tenant_id, id)
);
CREATE INDEX pos_offline_results_review_idx ON pos.offline_operation_results(tenant_id, received_at) WHERE disposition IN ('rejected','review');

CREATE TRIGGER pos_checkout_attempts_append_only BEFORE UPDATE OR DELETE ON pos.checkout_attempts FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER pos_receipt_snapshots_append_only BEFORE UPDATE OR DELETE ON pos.receipt_snapshots FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER pos_offline_results_append_only BEFORE UPDATE OR DELETE ON pos.offline_operation_results FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['register_sessions','devices','carts','cart_lines','checkout_attempts','receipt_snapshots','offline_authorizations','offline_operation_results'] LOOP
    EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE pos.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON pos.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('pos.read','pos','Read register sessions, carts, receipts and synchronization state','sensitive'),
  ('pos.session.open','pos','Open a register session','privileged'),
  ('pos.checkout','pos','Complete an approved POS checkout','privileged'),
  ('pos.offline.operate','pos','Operate within a signed offline authorization','privileged'),
  ('pos.offline.reconcile','pos','Resolve rejected or review-required offline operations','privileged'),
  ('pos.device.manage','pos','Enroll, revoke and inspect store-edge devices','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA pos TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA pos TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pos FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('POS-0001','MOD-D-POS','manifest:POS-0001-pos-edge.sql');

COMMIT;
