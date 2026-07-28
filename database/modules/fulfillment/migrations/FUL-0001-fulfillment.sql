BEGIN;

CREATE SCHEMA IF NOT EXISTS fulfillment;
COMMENT ON SCHEMA fulfillment IS 'MOD-C reservation-backed fulfillment, delivery proof, returns and refund/exchange orchestration';

CREATE TABLE IF NOT EXISTS fulfillment.plans (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_number text NOT NULL,
  reservation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('allocated','in_progress','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id),
  UNIQUE (tenant_id, reservation_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales.orders(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_work_queue_idx
  ON fulfillment.plans(tenant_id, store_id, status, updated_at, id)
  WHERE status IN ('allocated','in_progress');

CREATE TABLE IF NOT EXISTS fulfillment.allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  item_snapshot jsonb NOT NULL,
  method text NOT NULL CHECK (method IN ('pickup','local_delivery','ship_from_store')),
  warehouse_id uuid NOT NULL,
  quantity_snapshot jsonb NOT NULL,
  picked_quantity_snapshot jsonb NULL,
  packed_quantity_snapshot jsonb NULL,
  package_reference text NULL,
  pickup_code_hash text NULL,
  status text NOT NULL CHECK (status IN ('allocated','picking','picked','packed','ready_for_pickup','shipped','delivered','picked_up','cancelled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, plan_id, order_line_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES fulfillment.plans(tenant_id, id),
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES sales.order_lines(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_allocation_pick_queue_idx
  ON fulfillment.allocations(tenant_id, warehouse_id, status, updated_at, id)
  WHERE status IN ('allocated','picking','picked','packed','ready_for_pickup');
CREATE INDEX IF NOT EXISTS fulfillment_allocation_order_line_idx
  ON fulfillment.allocations(tenant_id, order_line_id, status, id);

CREATE TABLE IF NOT EXISTS fulfillment.packages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  package_reference text NOT NULL,
  quantity_snapshot jsonb NOT NULL,
  weight_snapshot jsonb NULL,
  dimensions_snapshot jsonb NULL,
  packed_at timestamptz NOT NULL DEFAULT now(),
  packed_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, package_reference),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES fulfillment.plans(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES fulfillment.allocations(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS fulfillment.shipments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  carrier text NOT NULL,
  service text NOT NULL,
  tracking_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('label_created','shipped','in_transit','delivered','exception','cancelled')),
  shipped_at timestamptz NULL,
  delivered_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, carrier, tracking_number),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES fulfillment.plans(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES fulfillment.allocations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_shipment_tracking_idx
  ON fulfillment.shipments(tenant_id, status, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS fulfillment.delivery_proofs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  shipment_id uuid NULL,
  proof_type text NOT NULL CHECK (proof_type IN ('signature','photo','identity_check','pin')),
  recipient_name text NOT NULL,
  object_reference text NOT NULL,
  content_hash text NULL,
  captured_at timestamptz NOT NULL,
  captured_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, allocation_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES fulfillment.plans(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES fulfillment.allocations(tenant_id, id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES fulfillment.shipments(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS fulfillment.workflow_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL,
  allocation_id uuid NULL,
  event_type text NOT NULL,
  from_status text NULL,
  to_status text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES fulfillment.plans(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES fulfillment.allocations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_workflow_history_idx
  ON fulfillment.workflow_events(tenant_id, plan_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS fulfillment.return_authorizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_number text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  original_payment_allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('requested','approved','rejected','received','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales.orders(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_return_queue_idx
  ON fulfillment.return_authorizations(tenant_id, store_id, status, updated_at, id)
  WHERE status IN ('requested','approved','received');
CREATE INDEX IF NOT EXISTS fulfillment_return_order_idx
  ON fulfillment.return_authorizations(tenant_id, order_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS fulfillment.return_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  return_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  item_snapshot jsonb NOT NULL,
  quantity_snapshot jsonb NOT NULL,
  original_quantity_snapshot jsonb NOT NULL,
  original_price_tax_snapshot jsonb NOT NULL,
  expected_condition text NOT NULL CHECK (expected_condition IN ('resalable','opened','damaged','defective','unknown')),
  proposed_disposition text NOT NULL CHECK (proposed_disposition IN ('restock','refurbish','quarantine','scrap','vendor_return')),
  actual_condition text NULL CHECK (actual_condition IS NULL OR actual_condition IN ('resalable','opened','damaged','defective','unknown')),
  final_disposition text NULL CHECK (final_disposition IS NULL OR final_disposition IN ('restock','refurbish','quarantine','scrap','vendor_return')),
  warehouse_id uuid NULL,
  received_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES fulfillment.return_authorizations(tenant_id, id),
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES sales.order_lines(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_return_line_order_idx
  ON fulfillment.return_lines(tenant_id, order_line_id, return_id);

CREATE TABLE IF NOT EXISTS fulfillment.return_approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  return_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  policy_override_approval_id text NULL,
  approved_by uuid NOT NULL REFERENCES platform.users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, return_id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES fulfillment.return_authorizations(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS fulfillment.return_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  return_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  inventory_operation_id uuid NOT NULL,
  received_snapshot jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, return_id),
  UNIQUE (tenant_id, inventory_operation_id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES fulfillment.return_authorizations(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS fulfillment.refund_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  return_id uuid NOT NULL,
  payment_intent_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','completed','failed')),
  provider_reference text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, return_id) REFERENCES fulfillment.return_authorizations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_refund_status_idx
  ON fulfillment.refund_requests(tenant_id, status, updated_at, id)
  WHERE status <> 'completed';

CREATE TABLE IF NOT EXISTS fulfillment.exchange_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  return_id uuid NOT NULL,
  return_line_id uuid NOT NULL,
  replacement_variant_id uuid NOT NULL,
  quantity_snapshot jsonb NOT NULL,
  replacement_order_request_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','order_created','cancelled','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, return_id) REFERENCES fulfillment.return_authorizations(tenant_id, id),
  FOREIGN KEY (tenant_id, return_line_id) REFERENCES fulfillment.return_lines(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_exchange_status_idx
  ON fulfillment.exchange_requests(tenant_id, status, updated_at, id)
  WHERE status IN ('requested','failed');

CREATE TABLE IF NOT EXISTS fulfillment.return_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  return_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES fulfillment.return_authorizations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS fulfillment_return_event_history_idx
  ON fulfillment.return_events(tenant_id, return_id, occurred_at, id);

CREATE OR REPLACE FUNCTION fulfillment.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION fulfillment.reject_completed_return_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'return_authorizations' THEN
    v_status := OLD.status;
  ELSE
    SELECT status INTO v_status
    FROM fulfillment.return_authorizations
    WHERE tenant_id = OLD.tenant_id
      AND id = OLD.return_id;
  END IF;

  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Completed return documents are immutable' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fulfillment_delivery_proofs_append_only ON fulfillment.delivery_proofs;
CREATE TRIGGER fulfillment_delivery_proofs_append_only
  BEFORE UPDATE OR DELETE ON fulfillment.delivery_proofs
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_append_only_mutation();
DROP TRIGGER IF EXISTS fulfillment_workflow_events_append_only ON fulfillment.workflow_events;
CREATE TRIGGER fulfillment_workflow_events_append_only
  BEFORE UPDATE OR DELETE ON fulfillment.workflow_events
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_append_only_mutation();
DROP TRIGGER IF EXISTS fulfillment_return_approvals_append_only ON fulfillment.return_approvals;
CREATE TRIGGER fulfillment_return_approvals_append_only
  BEFORE UPDATE OR DELETE ON fulfillment.return_approvals
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_append_only_mutation();
DROP TRIGGER IF EXISTS fulfillment_return_receipts_append_only ON fulfillment.return_receipts;
CREATE TRIGGER fulfillment_return_receipts_append_only
  BEFORE UPDATE OR DELETE ON fulfillment.return_receipts
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_append_only_mutation();
DROP TRIGGER IF EXISTS fulfillment_return_events_append_only ON fulfillment.return_events;
CREATE TRIGGER fulfillment_return_events_append_only
  BEFORE UPDATE OR DELETE ON fulfillment.return_events
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_append_only_mutation();
DROP TRIGGER IF EXISTS fulfillment_completed_return_immutable ON fulfillment.return_authorizations;
CREATE TRIGGER fulfillment_completed_return_immutable
  BEFORE UPDATE OR DELETE ON fulfillment.return_authorizations
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_completed_return_mutation();
DROP TRIGGER IF EXISTS fulfillment_completed_return_lines_immutable ON fulfillment.return_lines;
CREATE TRIGGER fulfillment_completed_return_lines_immutable
  BEFORE UPDATE OR DELETE ON fulfillment.return_lines
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_completed_return_mutation();
DROP TRIGGER IF EXISTS fulfillment_completed_refund_requests_immutable ON fulfillment.refund_requests;
CREATE TRIGGER fulfillment_completed_refund_requests_immutable
  BEFORE UPDATE OR DELETE ON fulfillment.refund_requests
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_completed_return_mutation();
DROP TRIGGER IF EXISTS fulfillment_completed_exchange_requests_immutable ON fulfillment.exchange_requests;
CREATE TRIGGER fulfillment_completed_exchange_requests_immutable
  BEFORE UPDATE OR DELETE ON fulfillment.exchange_requests
  FOR EACH ROW EXECUTE FUNCTION fulfillment.reject_completed_return_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'plans','allocations','packages','shipments','delivery_proofs','workflow_events',
    'return_authorizations','return_lines','return_approvals','return_receipts',
    'refund_requests','exchange_requests','return_events'
  ] LOOP
    EXECUTE format('ALTER TABLE fulfillment.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE fulfillment.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON fulfillment.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON fulfillment.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('fulfillment.plan.create','fulfillment','Create reservation-backed fulfillment plans','sensitive'),
  ('fulfillment.read','fulfillment','Read fulfillment work and delivery status','standard'),
  ('fulfillment.pick','fulfillment','Start and confirm picking','sensitive'),
  ('fulfillment.pack','fulfillment','Pack picked quantities','sensitive'),
  ('fulfillment.ship','fulfillment','Ship packed allocations and post stock issue','sensitive'),
  ('fulfillment.deliver','fulfillment','Record proof of delivery','sensitive'),
  ('fulfillment.pickup','fulfillment','Prepare and confirm customer pickup','sensitive'),
  ('return.request','fulfillment','Create customer return authorizations','standard'),
  ('return.approve','fulfillment','Approve or reject customer returns','privileged'),
  ('return.receive','fulfillment','Receive approved customer returns and post stock','sensitive'),
  ('return.resolve','fulfillment','Orchestrate refund and exchange resolution','privileged'),
  ('return.override_policy','fulfillment','Override quantity or policy limits with recorded approval','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA fulfillment TO store_app_runtime, store_app_reporting;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fulfillment TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA fulfillment TO store_app_reporting;
REVOKE DELETE ON ALL TABLES IN SCHEMA fulfillment FROM store_app_runtime;
REVOKE UPDATE ON fulfillment.delivery_proofs, fulfillment.workflow_events, fulfillment.return_approvals,
  fulfillment.return_receipts, fulfillment.return_events FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA fulfillment GRANT SELECT, INSERT, UPDATE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA fulfillment GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FUL-0001','MOD-C-FULFILLMENT','manifest:FUL-0001-fulfillment.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
