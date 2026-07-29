BEGIN;

CREATE TABLE pos.carts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  session_id uuid NOT NULL,
  customer_id uuid NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','checkout_pending','completed','cancelled')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz NULL,
  completed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES pos.register_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE TABLE pos.cart_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  cart_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity numeric(30, 10) NOT NULL CHECK (quantity > 0),
  quantity_unit text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  price_snapshot_id text NOT NULL,
  tax_snapshot_id text NOT NULL,
  promotion_snapshot_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cart_id, id),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  CHECK (discount_minor <= unit_price_minor * quantity),
  CHECK (line_total_minor = unit_price_minor * quantity - discount_minor + tax_minor)
);

CREATE TABLE pos.receipt_number_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  prefix text NOT NULL,
  range_start bigint NOT NULL CHECK (range_start > 0),
  range_end bigint NOT NULL,
  next_number bigint NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','expired','revoked')),
  issued_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  CHECK (range_end >= range_start),
  CHECK (next_number BETWEEN range_start AND range_end + 1),
  CHECK (expires_at > issued_at)
);
CREATE INDEX receipt_number_allocations_active_idx
  ON pos.receipt_number_allocations(tenant_id, device_id, expires_at)
  WHERE status = 'active';

ALTER TABLE pos.offline_authorizations
  ADD COLUMN receipt_number_allocation_id uuid NULL,
  ADD CONSTRAINT offline_authorizations_receipt_allocation_fk
    FOREIGN KEY (tenant_id, receipt_number_allocation_id)
    REFERENCES pos.receipt_number_allocations(tenant_id, id);

ALTER TABLE pos.checkout_operations
  ADD COLUMN cart_id uuid NULL,
  ADD COLUMN receipt_number_allocation_id uuid NULL,
  ADD CONSTRAINT checkout_operations_cart_fk
    FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  ADD CONSTRAINT checkout_operations_receipt_allocation_fk
    FOREIGN KEY (tenant_id, receipt_number_allocation_id)
    REFERENCES pos.receipt_number_allocations(tenant_id, id);

CREATE TABLE pos.offline_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  operation_id text NOT NULL,
  local_sequence bigint NOT NULL CHECK (local_sequence > 0),
  operation_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version text NOT NULL,
  payload_version text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  authorization_id uuid NOT NULL,
  local_schema_version text NOT NULL,
  app_version text NOT NULL,
  local_committed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','accepted','duplicate','rejected','review_required','deferred')),
  checkout_operation_id uuid NULL,
  receipt_snapshot_id uuid NULL,
  server_sequence bigint NULL CHECK (server_sequence IS NULL OR server_sequence > 0),
  server_reference text NULL,
  rejection_code text NULL,
  rejection_message text NULL,
  resolved_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, device_id, local_sequence),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  FOREIGN KEY (tenant_id, authorization_id) REFERENCES pos.offline_authorizations(tenant_id, id),
  FOREIGN KEY (tenant_id, checkout_operation_id) REFERENCES pos.checkout_operations(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_snapshot_id) REFERENCES pos.receipt_snapshots(tenant_id, id)
);
CREATE INDEX offline_operations_upload_idx
  ON pos.offline_operations(tenant_id, device_id, local_sequence)
  WHERE status IN ('pending','uploading','deferred');
CREATE INDEX offline_operations_review_idx
  ON pos.offline_operations(tenant_id, status, local_committed_at, id)
  WHERE status IN ('rejected','review_required');

CREATE TABLE pos.device_sync_cursors (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  upload_cursor bigint NOT NULL DEFAULT 0 CHECK (upload_cursor >= 0),
  download_cursor bigint NOT NULL DEFAULT 0 CHECK (download_cursor >= 0),
  projection_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_started_at timestamptz NULL,
  last_sync_completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, device_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id)
);

CREATE TABLE pos.projection_changes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  projection text NOT NULL CHECK (projection IN ('catalog','barcode','price','tax','permission','country_capability')),
  entity_id text NOT NULL,
  entity_version text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','delete')),
  payload jsonb NULL,
  content_hash text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sequence)
);
CREATE INDEX projection_changes_download_idx
  ON pos.projection_changes(tenant_id, sequence);

CREATE TABLE pos.receipt_delivery_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  receipt_snapshot_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('print','email','sms')),
  destination text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  last_error_code text NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_snapshot_id) REFERENCES pos.receipt_snapshots(tenant_id, id)
);
CREATE INDEX receipt_delivery_pending_idx
  ON pos.receipt_delivery_requests(tenant_id, requested_at, id)
  WHERE status IN ('pending','processing');

CREATE TABLE pos.hardware_commands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id uuid NOT NULL,
  command_id text NOT NULL,
  capability text NOT NULL CHECK (capability IN ('receipt_printer','cash_drawer','barcode_scanner','scale','customer_display','payment_terminal','fiscal_device')),
  action text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','succeeded','failed','timed_out','unsupported','revoked')),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_code text NULL,
  error_message text NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, command_id),
  UNIQUE (tenant_id, device_id, idempotency_key),
  FOREIGN KEY (tenant_id, device_id) REFERENCES pos.devices(tenant_id, id),
  CHECK (expires_at > requested_at)
);
CREATE INDEX hardware_commands_dispatch_idx
  ON pos.hardware_commands(tenant_id, device_id, requested_at, id)
  WHERE status IN ('pending','dispatched');

CREATE OR REPLACE FUNCTION pos.protect_offline_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.register_id IS DISTINCT FROM NEW.register_id
     OR OLD.device_id IS DISTINCT FROM NEW.device_id
     OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
     OR OLD.local_sequence IS DISTINCT FROM NEW.local_sequence
     OR OLD.operation_type IS DISTINCT FROM NEW.operation_type
     OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
     OR OLD.aggregate_version IS DISTINCT FROM NEW.aggregate_version
     OR OLD.payload_version IS DISTINCT FROM NEW.payload_version
     OR OLD.payload IS DISTINCT FROM NEW.payload
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.authorization_id IS DISTINCT FROM NEW.authorization_id
     OR OLD.local_schema_version IS DISTINCT FROM NEW.local_schema_version
     OR OLD.app_version IS DISTINCT FROM NEW.app_version
     OR OLD.local_committed_at IS DISTINCT FROM NEW.local_committed_at THEN
    RAISE EXCEPTION 'offline operation envelope is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('accepted','duplicate','rejected','review_required') AND
     (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.server_sequence IS DISTINCT FROM NEW.server_sequence
      OR OLD.server_reference IS DISTINCT FROM NEW.server_reference
      OR OLD.rejection_code IS DISTINCT FROM NEW.rejection_code
      OR OLD.rejection_message IS DISTINCT FROM NEW.rejection_message) THEN
    RAISE EXCEPTION 'resolved offline operation requires an explicit adjustment operation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offline_operation_identity_immutable
  BEFORE UPDATE ON pos.offline_operations
  FOR EACH ROW EXECUTE FUNCTION pos.protect_offline_operation_identity();

CREATE TRIGGER projection_changes_append_only
  BEFORE UPDATE OR DELETE ON pos.projection_changes
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'carts','cart_lines','receipt_number_allocations','offline_operations',
    'device_sync_cursors','projection_changes','receipt_delivery_requests','hardware_commands'
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
  ('pos.cart.manage','pos','Create, suspend and resume register carts','sensitive'),
  ('pos.sync.execute','pos','Upload local operations and download projection changes','privileged'),
  ('pos.sync.review','pos','Review rejected, deferred and conflict outcomes','privileged'),
  ('pos.hardware.execute','pos','Dispatch bounded commands through an enrolled hardware agent','privileged'),
  ('pos.receipt.deliver','pos','Request print, email or SMS delivery for an immutable receipt','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT SELECT ON pos.carts, pos.cart_lines, pos.receipt_number_allocations,
  pos.offline_operations, pos.device_sync_cursors, pos.projection_changes,
  pos.receipt_delivery_requests, pos.hardware_commands
TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON pos.carts, pos.cart_lines, pos.receipt_number_allocations,
  pos.offline_operations, pos.device_sync_cursors, pos.projection_changes,
  pos.receipt_delivery_requests, pos.hardware_commands
FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0002','MOD-D-POS','manifest:POS-0002-cart-sync-hardware.sql');

COMMIT;
