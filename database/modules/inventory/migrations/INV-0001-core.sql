BEGIN;

CREATE SCHEMA IF NOT EXISTS inventory;

CREATE TABLE IF NOT EXISTS inventory.warehouse_settings (
  tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  negative_stock_policy text NOT NULL DEFAULT 'deny' CHECK (negative_stock_policy IN ('deny','approve','allow')),
  costing_method text NOT NULL DEFAULT 'fifo' CHECK (costing_method IN ('fifo','weighted_average','specific_identification')),
  default_receiving_bin_id uuid NULL,
  default_quarantine_bin_id uuid NULL,
  cycle_count_frequency_days integer NOT NULL DEFAULT 90 CHECK (cycle_count_frequency_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, warehouse_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.warehouse_zones (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, code),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.warehouse_bins (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  zone_id uuid NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  pickable boolean NOT NULL DEFAULT true,
  receivable boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, code),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, zone_id) REFERENCES inventory.warehouse_zones(tenant_id, id)
);

ALTER TABLE inventory.warehouse_settings
  DROP CONSTRAINT IF EXISTS warehouse_settings_default_receiving_bin_fk;
ALTER TABLE inventory.warehouse_settings
  ADD CONSTRAINT warehouse_settings_default_receiving_bin_fk
  FOREIGN KEY (tenant_id, default_receiving_bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id);
ALTER TABLE inventory.warehouse_settings
  DROP CONSTRAINT IF EXISTS warehouse_settings_default_quarantine_bin_fk;
ALTER TABLE inventory.warehouse_settings
  ADD CONSTRAINT warehouse_settings_default_quarantine_bin_fk
  FOREIGN KEY (tenant_id, default_quarantine_bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id);

CREATE TABLE IF NOT EXISTS inventory.stock_batches (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  batch_number text NOT NULL,
  manufactured_date date NULL,
  expiry_date date NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','recalled','closed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, variant_id, batch_number),
  CHECK (expiry_date IS NULL OR manufactured_date IS NULL OR expiry_date >= manufactured_date)
);

CREATE TABLE IF NOT EXISTS inventory.stock_serials (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  serial_number text NOT NULL,
  warehouse_id uuid NULL,
  bin_id uuid NULL,
  stock_status text NULL CHECK (stock_status IS NULL OR stock_status IN ('sellable','reserved','in_transit','damaged','quarantine')),
  lifecycle_state text NOT NULL DEFAULT 'available' CHECK (lifecycle_state IN ('available','reserved','issued','returned','damaged','quarantine','in_transit','retired')),
  batch_id uuid NULL,
  last_ledger_entry_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, serial_number),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.stock_balances (
  tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  bin_id uuid NULL,
  stock_status text NOT NULL CHECK (stock_status IN ('sellable','reserved','in_transit','damaged','quarantine')),
  batch_id uuid NULL,
  bin_key uuid GENERATED ALWAYS AS (COALESCE(bin_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  batch_key uuid GENERATED ALWAYS AS (COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  quantity_amount numeric(38,0) NOT NULL DEFAULT 0,
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL CHECK (unit_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$'),
  value_minor numeric(38,0) NOT NULL DEFAULT 0,
  currency char(3) NULL,
  source_cursor bigint NOT NULL DEFAULT 0 CHECK (source_cursor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, warehouse_id, variant_id, stock_status, unit_code, quantity_scale, bin_key, batch_key),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS inventory.stock_ledger_entries (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  operation_id text NOT NULL,
  operation_line_index integer NOT NULL CHECK (operation_line_index >= 0),
  posting_group_id text NOT NULL,
  variant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  bin_id uuid NULL,
  stock_status text NOT NULL CHECK (stock_status IN ('sellable','reserved','in_transit','damaged','quarantine')),
  batch_id uuid NULL,
  serial_id uuid NULL,
  expiry_date date NULL,
  quantity_amount numeric(38,0) NOT NULL,
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL CHECK (unit_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$'),
  unit_cost_minor numeric(38,0) NULL,
  currency char(3) NULL,
  value_delta_minor numeric(38,0) NULL,
  movement_type text NOT NULL CHECK (movement_type IN (
    'opening_balance','purchase_receipt','sale_issue','customer_return','supplier_return',
    'transfer_dispatch','transfer_receipt','adjustment_gain','adjustment_loss',
    'physical_count_variance','status_change','landed_cost_revaluation','reversal'
  )),
  source_document_type text NOT NULL,
  source_document_id text NOT NULL,
  source_document_line_id text NULL,
  business_date date NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  approval_id uuid NULL,
  reversal_of_entry_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, operation_id, operation_line_index),
  UNIQUE (tenant_id, sequence_id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES inventory.warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, serial_id) REFERENCES inventory.stock_serials(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES platform.approval_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_entry_id) REFERENCES inventory.stock_ledger_entries(tenant_id, id),
  CHECK ((unit_cost_minor IS NULL AND currency IS NULL) OR (unit_cost_minor IS NOT NULL AND currency IS NOT NULL)),
  CHECK (quantity_amount <> 0 OR movement_type = 'landed_cost_revaluation')
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_ledger_single_reversal_idx
  ON inventory.stock_ledger_entries(tenant_id, reversal_of_entry_id)
  WHERE reversal_of_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_ledger_dimension_idx
  ON inventory.stock_ledger_entries(tenant_id, warehouse_id, variant_id, stock_status, posted_at DESC, sequence_id DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_source_idx
  ON inventory.stock_ledger_entries(tenant_id, source_document_type, source_document_id, source_document_line_id);
CREATE INDEX IF NOT EXISTS stock_ledger_posting_group_idx
  ON inventory.stock_ledger_entries(tenant_id, posting_group_id);
CREATE INDEX IF NOT EXISTS stock_ledger_batch_idx
  ON inventory.stock_ledger_entries(tenant_id, batch_id, posted_at DESC) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_ledger_serial_idx
  ON inventory.stock_ledger_entries(tenant_id, serial_id, posted_at DESC) WHERE serial_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.cost_layers (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  batch_id uuid NULL,
  serial_id uuid NULL,
  receipt_ledger_entry_id uuid NOT NULL,
  received_at timestamptz NOT NULL,
  original_quantity numeric(38,0) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity numeric(38,0) NOT NULL CHECK (remaining_quantity >= 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  unit_cost_minor numeric(38,0) NOT NULL CHECK (unit_cost_minor >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','consumed','revalued','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, receipt_ledger_entry_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, serial_id) REFERENCES inventory.stock_serials(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_ledger_entry_id) REFERENCES inventory.stock_ledger_entries(tenant_id, id),
  CHECK (remaining_quantity <= original_quantity)
);
CREATE INDEX IF NOT EXISTS cost_layers_fifo_idx
  ON inventory.cost_layers(tenant_id, warehouse_id, variant_id, received_at, id)
  WHERE remaining_quantity > 0;

CREATE TABLE IF NOT EXISTS inventory.cost_consumptions (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  issue_ledger_entry_id uuid NOT NULL,
  cost_layer_id uuid NOT NULL,
  quantity numeric(38,0) NOT NULL CHECK (quantity > 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_cost_minor numeric(38,0) NOT NULL CHECK (unit_cost_minor >= 0),
  value_minor numeric(38,0) NOT NULL CHECK (value_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, issue_ledger_entry_id) REFERENCES inventory.stock_ledger_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, cost_layer_id) REFERENCES inventory.cost_layers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS cost_consumptions_issue_idx ON inventory.cost_consumptions(tenant_id, issue_ledger_entry_id);
CREATE INDEX IF NOT EXISTS cost_consumptions_layer_idx ON inventory.cost_consumptions(tenant_id, cost_layer_id);

CREATE TABLE IF NOT EXISTS inventory.cost_layer_adjustments (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  cost_layer_id uuid NOT NULL,
  posting_group_id text NOT NULL,
  source_document_type text NOT NULL,
  source_document_id text NOT NULL,
  amount_minor numeric(38,0) NOT NULL,
  currency char(3) NOT NULL,
  reason text NOT NULL,
  actor_id uuid NOT NULL,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, cost_layer_id) REFERENCES inventory.cost_layers(tenant_id, id)
);

CREATE OR REPLACE FUNCTION inventory.apply_ledger_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, inventory, platform AS $$
DECLARE
  current_quantity numeric(38,0);
  policy text;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'inventory tenant context mismatch' USING ERRCODE = '42501';
  END IF;

  INSERT INTO inventory.stock_balances(
    tenant_id, warehouse_id, variant_id, bin_id, stock_status, batch_id,
    quantity_amount, quantity_scale, unit_code, value_minor, currency, source_cursor
  ) VALUES (
    NEW.tenant_id, NEW.warehouse_id, NEW.variant_id, NEW.bin_id, NEW.stock_status, NEW.batch_id,
    0, NEW.quantity_scale, NEW.unit_code, 0, NEW.currency, 0
  ) ON CONFLICT DO NOTHING;

  SELECT quantity_amount INTO current_quantity
    FROM inventory.stock_balances
   WHERE tenant_id = NEW.tenant_id
     AND warehouse_id = NEW.warehouse_id
     AND variant_id = NEW.variant_id
     AND stock_status = NEW.stock_status
     AND unit_code = NEW.unit_code
     AND quantity_scale = NEW.quantity_scale
     AND bin_id IS NOT DISTINCT FROM NEW.bin_id
     AND batch_id IS NOT DISTINCT FROM NEW.batch_id
   FOR UPDATE;

  IF NEW.stock_status = 'sellable' AND current_quantity + NEW.quantity_amount < 0 THEN
    SELECT negative_stock_policy INTO policy
      FROM inventory.warehouse_settings
     WHERE tenant_id = NEW.tenant_id AND warehouse_id = NEW.warehouse_id;
    policy := COALESCE(policy, 'deny');
    IF policy = 'deny' THEN
      RAISE EXCEPTION 'negative sellable stock is denied' USING ERRCODE = '23514';
    END IF;
    IF policy = 'approve' AND NEW.approval_id IS NULL THEN
      RAISE EXCEPTION 'negative stock requires approval' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE inventory.stock_balances
     SET quantity_amount = quantity_amount + NEW.quantity_amount,
         value_minor = value_minor + COALESCE(NEW.value_delta_minor, 0),
         currency = COALESCE(NEW.currency, currency),
         source_cursor = GREATEST(source_cursor, NEW.sequence_id),
         updated_at = NEW.posted_at,
         version = version + 1
   WHERE tenant_id = NEW.tenant_id
     AND warehouse_id = NEW.warehouse_id
     AND variant_id = NEW.variant_id
     AND stock_status = NEW.stock_status
     AND unit_code = NEW.unit_code
     AND quantity_scale = NEW.quantity_scale
     AND bin_id IS NOT DISTINCT FROM NEW.bin_id
     AND batch_id IS NOT DISTINCT FROM NEW.batch_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stock_ledger_projection_trigger ON inventory.stock_ledger_entries;
CREATE TRIGGER stock_ledger_projection_trigger
BEFORE INSERT ON inventory.stock_ledger_entries
FOR EACH ROW EXECUTE FUNCTION inventory.apply_ledger_projection();

DROP TRIGGER IF EXISTS stock_ledger_append_only ON inventory.stock_ledger_entries;
CREATE TRIGGER stock_ledger_append_only
BEFORE UPDATE OR DELETE ON inventory.stock_ledger_entries
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
DROP TRIGGER IF EXISTS cost_consumptions_append_only ON inventory.cost_consumptions;
CREATE TRIGGER cost_consumptions_append_only
BEFORE UPDATE OR DELETE ON inventory.cost_consumptions
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
DROP TRIGGER IF EXISTS cost_adjustments_append_only ON inventory.cost_layer_adjustments;
CREATE TRIGGER cost_adjustments_append_only
BEFORE UPDATE OR DELETE ON inventory.cost_layer_adjustments
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'warehouse_settings','warehouse_zones','warehouse_bins','stock_batches','stock_serials',
    'stock_balances','stock_ledger_entries','cost_layers','cost_consumptions','cost_layer_adjustments'
  ] LOOP
    EXECUTE format('ALTER TABLE inventory.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE inventory.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON inventory.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON inventory.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

GRANT USAGE ON SCHEMA inventory TO store_app_runtime, store_app_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory TO store_app_reporting;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventory TO store_app_runtime, store_app_reporting;
REVOKE ALL ON FUNCTION inventory.apply_ledger_projection() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.apply_ledger_projection() TO store_app_runtime;
REVOKE UPDATE, DELETE ON inventory.stock_ledger_entries, inventory.cost_consumptions, inventory.cost_layer_adjustments FROM store_app_runtime;
REVOKE INSERT, UPDATE, DELETE ON inventory.stock_balances FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('inventory.warehouse.read','inventory','Read warehouses, zones and bins','standard'),
  ('inventory.warehouse.manage','inventory','Manage warehouse configuration','sensitive'),
  ('inventory.stock.read','inventory','Read stock balances, availability and movement','standard'),
  ('inventory.stock.post','inventory','Post controlled stock movements','sensitive'),
  ('inventory.stock.adjust','inventory','Create stock adjustments','privileged'),
  ('inventory.stock.reconcile','inventory','Run and inspect stock reconciliation','sensitive'),
  ('inventory.cost.read','inventory','Read inventory cost and valuation','sensitive'),
  ('inventory.cost.manage','inventory','Post inventory cost revaluation','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INV-0001','MOD-B-INVENTORY','manifest:INV-0001-core.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
