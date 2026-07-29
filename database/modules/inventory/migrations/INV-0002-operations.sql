BEGIN;

CREATE TABLE IF NOT EXISTS inventory.stock_reservations (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('fully_reserved','partially_reserved','unfulfilled','partially_consumed','consumed','released','expired','cancelled')),
  fulfillment_policy text NOT NULL CHECK (fulfillment_policy IN ('all_or_nothing','allow_partial')),
  expires_at timestamptz NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS stock_reservations_active_expiry_idx
  ON inventory.stock_reservations(tenant_id, expires_at)
  WHERE state IN ('fully_reserved','partially_reserved','partially_consumed') AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.stock_reservation_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  unit_code text NOT NULL,
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  requested_quantity numeric(38,0) NOT NULL CHECK (requested_quantity > 0),
  reserved_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  consumed_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  released_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, reservation_id, variant_id, warehouse_id, unit_code, quantity_scale),
  FOREIGN KEY (tenant_id, reservation_id) REFERENCES inventory.stock_reservations(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  CHECK (reserved_quantity <= requested_quantity),
  CHECK (consumed_quantity + released_quantity <= reserved_quantity)
);
CREATE INDEX IF NOT EXISTS stock_reservation_lines_availability_idx
  ON inventory.stock_reservation_lines(tenant_id, warehouse_id, variant_id)
  WHERE reserved_quantity > consumed_quantity + released_quantity;

CREATE TABLE IF NOT EXISTS inventory.stock_transfers (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  source_warehouse_id uuid NOT NULL,
  destination_warehouse_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','picking','dispatched','partially_received','received','closed','cancelled')),
  requested_by uuid NOT NULL,
  approved_by uuid NULL,
  approval_id uuid NULL,
  dispatched_at timestamptz NULL,
  received_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, source_warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, destination_warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES platform.approval_requests(tenant_id, id),
  CHECK (source_warehouse_id <> destination_warehouse_id)
);
CREATE INDEX IF NOT EXISTS stock_transfers_open_idx ON inventory.stock_transfers(tenant_id, state, updated_at DESC)
  WHERE state NOT IN ('closed','cancelled');

CREATE TABLE IF NOT EXISTS inventory.stock_transfer_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  transfer_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  unit_code text NOT NULL,
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  requested_quantity numeric(38,0) NOT NULL CHECK (requested_quantity > 0),
  dispatched_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (dispatched_quantity >= 0),
  received_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  damaged_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  missing_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
  batch_id uuid NULL,
  serial_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, transfer_id) REFERENCES inventory.stock_transfers(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id),
  CHECK (dispatched_quantity <= requested_quantity),
  CHECK (received_quantity + damaged_quantity + missing_quantity <= dispatched_quantity)
);

CREATE TABLE IF NOT EXISTS inventory.stock_adjustments (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','posted','rejected','cancelled')),
  reason_code text NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  approved_by uuid NULL,
  approval_id uuid NULL,
  posting_group_id text NULL,
  posted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES platform.approval_requests(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.stock_adjustment_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  adjustment_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  bin_id uuid NULL,
  stock_status text NOT NULL DEFAULT 'sellable' CHECK (stock_status IN ('sellable','reserved','in_transit','damaged','quarantine')),
  batch_id uuid NULL,
  serial_id uuid NULL,
  quantity_delta numeric(38,0) NOT NULL CHECK (quantity_delta <> 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  unit_cost_minor numeric(38,0) NULL,
  currency char(3) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, adjustment_id) REFERENCES inventory.stock_adjustments(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, serial_id) REFERENCES inventory.stock_serials(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.stock_counts (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','frozen','counting','submitted','recount_required','approved','posted','cancelled')),
  blind boolean NOT NULL DEFAULT true,
  snapshot_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid NULL,
  approval_id uuid NULL,
  posting_group_id text NULL,
  posted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS stock_counts_open_idx ON inventory.stock_counts(tenant_id, warehouse_id, state, updated_at DESC)
  WHERE state NOT IN ('posted','cancelled');

CREATE TABLE IF NOT EXISTS inventory.stock_count_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  count_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  bin_id uuid NULL,
  batch_id uuid NULL,
  unit_code text NOT NULL,
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  expected_quantity numeric(38,0) NOT NULL,
  first_count_quantity numeric(38,0) NULL CHECK (first_count_quantity IS NULL OR first_count_quantity >= 0),
  recount_quantity numeric(38,0) NULL CHECK (recount_quantity IS NULL OR recount_quantity >= 0),
  approved_quantity numeric(38,0) NULL CHECK (approved_quantity IS NULL OR approved_quantity >= 0),
  variance_quantity numeric(38,0) NULL,
  counter_id uuid NULL,
  recounter_id uuid NULL,
  counted_at timestamptz NULL,
  recounted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, count_id) REFERENCES inventory.stock_counts(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.reconciliation_runs (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('running','matched','mismatch','failed')),
  ledger_entry_count bigint NOT NULL DEFAULT 0,
  projection_key_count bigint NOT NULL DEFAULT 0,
  mismatch_count bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  requested_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
DROP TRIGGER IF EXISTS reconciliation_runs_delete_forbidden ON inventory.reconciliation_runs;
CREATE TRIGGER reconciliation_runs_delete_forbidden BEFORE DELETE ON inventory.reconciliation_runs
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE TABLE IF NOT EXISTS inventory.reorder_policies (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  supplier_id uuid NULL,
  reorder_point numeric(38,0) NOT NULL CHECK (reorder_point >= 0),
  safety_stock numeric(38,0) NOT NULL CHECK (safety_stock >= 0),
  minimum_quantity numeric(38,0) NOT NULL CHECK (minimum_quantity >= 0),
  maximum_quantity numeric(38,0) NOT NULL CHECK (maximum_quantity >= minimum_quantity),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  lead_time_days integer NOT NULL CHECK (lead_time_days BETWEEN 0 AND 3650),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, variant_id, warehouse_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id)
);

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stock_reservations','stock_reservation_lines','stock_transfers','stock_transfer_lines',
    'stock_adjustments','stock_adjustment_lines','stock_counts','stock_count_lines',
    'reconciliation_runs','reorder_policies'
  ] LOOP
    EXECUTE format('ALTER TABLE inventory.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE inventory.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON inventory.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON inventory.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory TO store_app_reporting;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('inventory.reservation.manage','inventory','Create, consume and release stock reservations','sensitive'),
  ('inventory.transfer.manage','inventory','Create and dispatch stock transfers','sensitive'),
  ('inventory.transfer.approve','inventory','Approve stock transfers','privileged'),
  ('inventory.count.manage','inventory','Run physical and cycle counts','sensitive'),
  ('inventory.count.approve','inventory','Approve and post count variances','privileged'),
  ('inventory.replenishment.read','inventory','Read reorder policies and proposals','standard'),
  ('inventory.replenishment.manage','inventory','Manage reorder policies','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INV-0002','MOD-B-INVENTORY','manifest:INV-0002-operations.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
