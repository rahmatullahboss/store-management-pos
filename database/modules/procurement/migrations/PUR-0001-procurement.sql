BEGIN;

CREATE SCHEMA IF NOT EXISTS procurement;

CREATE TABLE IF NOT EXISTS procurement.suppliers (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$'),
  legal_name text NOT NULL CHECK (char_length(legal_name) BETWEEN 1 AND 240),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','inactive','archived')),
  currency char(3) NOT NULL,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 3650),
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days BETWEEN 0 AND 3650),
  tax_registration text NULL,
  email text NULL,
  phone text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS procurement.supplier_contacts (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  name text NOT NULL,
  role text NULL,
  email text NULL,
  phone text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_contacts_one_primary_idx
  ON procurement.supplier_contacts(tenant_id, supplier_id)
  WHERE is_primary AND status = 'active';

CREATE TABLE IF NOT EXISTS procurement.supplier_items (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  supplier_sku text NOT NULL,
  purchase_unit text NOT NULL,
  minimum_order_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (minimum_order_quantity >= 0),
  pack_quantity numeric(38,0) NOT NULL CHECK (pack_quantity > 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  last_quoted_unit_cost_minor numeric(38,0) NULL CHECK (last_quoted_unit_cost_minor IS NULL OR last_quoted_unit_cost_minor >= 0),
  currency char(3) NULL,
  lead_time_days integer NULL CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 3650),
  preferred boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, supplier_id, supplier_sku),
  UNIQUE (tenant_id, supplier_id, variant_id, purchase_unit),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id),
  CHECK ((last_quoted_unit_cost_minor IS NULL AND currency IS NULL) OR (last_quoted_unit_cost_minor IS NOT NULL AND currency IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS supplier_items_variant_idx ON procurement.supplier_items(tenant_id, variant_id, preferred DESC);

CREATE TABLE IF NOT EXISTS procurement.purchase_requisitions (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','rejected','converted','cancelled')),
  requested_by uuid NOT NULL,
  approved_by uuid NULL,
  approval_id uuid NULL,
  rejection_reason text NULL,
  purchase_order_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_requisitions_queue_idx ON procurement.purchase_requisitions(tenant_id, state, updated_at DESC)
  WHERE state IN ('submitted','approved');

CREATE TABLE IF NOT EXISTS procurement.purchase_requisition_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  requisition_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric(38,0) NOT NULL CHECK (quantity > 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  required_by date NOT NULL,
  preferred_supplier_id uuid NULL,
  estimated_unit_cost_minor numeric(38,0) NULL CHECK (estimated_unit_cost_minor IS NULL OR estimated_unit_cost_minor >= 0),
  currency char(3) NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, requisition_id) REFERENCES procurement.purchase_requisitions(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, preferred_supplier_id) REFERENCES procurement.suppliers(tenant_id, id),
  CHECK ((estimated_unit_cost_minor IS NULL AND currency IS NULL) OR (estimated_unit_cost_minor IS NOT NULL AND currency IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS procurement.purchase_orders (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  order_number text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','partially_received','received','closed','cancelled')),
  currency char(3) NOT NULL,
  warehouse_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  submitted_by uuid NULL,
  approved_by uuid NULL,
  approval_id uuid NULL,
  approved_at timestamptz NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, order_number),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_orders_open_idx ON procurement.purchase_orders(tenant_id, state, updated_at DESC)
  WHERE state IN ('submitted','approved','partially_received');
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON procurement.purchase_orders(tenant_id, supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS procurement.purchase_order_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  supplier_item_id uuid NULL,
  warehouse_id uuid NOT NULL,
  ordered_quantity numeric(38,0) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  returned_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  cancelled_quantity numeric(38,0) NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  unit_cost_minor numeric(38,0) NOT NULL CHECK (unit_cost_minor >= 0),
  currency char(3) NOT NULL,
  tax_code text NULL,
  promised_date date NULL,
  over_receipt_tolerance_basis_points integer NOT NULL DEFAULT 0 CHECK (over_receipt_tolerance_basis_points BETWEEN 0 AND 10000),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_item_id) REFERENCES procurement.supplier_items(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  CHECK (received_quantity + cancelled_quantity <= ordered_quantity * (1 + over_receipt_tolerance_basis_points::numeric / 10000)),
  CHECK (returned_quantity <= received_quantity)
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_variant_idx ON procurement.purchase_order_lines(tenant_id, variant_id, warehouse_id);

ALTER TABLE procurement.purchase_requisitions
  DROP CONSTRAINT IF EXISTS purchase_requisitions_purchase_order_fk;
ALTER TABLE procurement.purchase_requisitions
  ADD CONSTRAINT purchase_requisitions_purchase_order_fk
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id, id);

CREATE TABLE IF NOT EXISTS procurement.goods_receipts (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  receipt_number text NOT NULL,
  warehouse_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'posted' CHECK (state IN ('posted','reversed')),
  received_by uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  posting_group_id text NOT NULL,
  reversal_receipt_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, posting_group_id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_receipt_id) REFERENCES procurement.goods_receipts(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS goods_receipts_po_idx ON procurement.goods_receipts(tenant_id, purchase_order_id, received_at DESC);

CREATE TABLE IF NOT EXISTS procurement.goods_receipt_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  received_quantity numeric(38,0) NOT NULL CHECK (received_quantity > 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('accepted','quarantine','damaged','rejected')),
  unit_cost_minor numeric(38,0) NOT NULL CHECK (unit_cost_minor >= 0),
  currency char(3) NOT NULL,
  batch_id uuid NULL,
  serial_ids uuid[] NOT NULL DEFAULT '{}',
  expiry_date date NULL,
  discrepancy_reason text NULL,
  stock_ledger_entry_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_line_id) REFERENCES procurement.purchase_order_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.stock_batches(tenant_id, id),
  CHECK (disposition <> 'rejected' OR discrepancy_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS goods_receipt_lines_variant_idx ON procurement.goods_receipt_lines(tenant_id, variant_id, warehouse_id);

CREATE TABLE IF NOT EXISTS procurement.supplier_returns (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'posted' CHECK (state IN ('posted','cancelled')),
  returned_by uuid NOT NULL,
  returned_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  posting_group_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, posting_group_id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS procurement.supplier_return_lines (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  supplier_return_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric(38,0) NOT NULL CHECK (quantity > 0),
  quantity_scale smallint NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_code text NOT NULL,
  unit_cost_minor numeric(38,0) NOT NULL CHECK (unit_cost_minor >= 0),
  currency char(3) NOT NULL,
  reason text NOT NULL,
  stock_ledger_entry_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_return_id) REFERENCES procurement.supplier_returns(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_line_id) REFERENCES procurement.goods_receipt_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS procurement.supplier_bills (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  bill_number text NOT NULL,
  bill_date date NOT NULL,
  currency char(3) NOT NULL,
  subtotal_minor numeric(38,0) NOT NULL,
  tax_minor numeric(38,0) NOT NULL,
  total_minor numeric(38,0) NOT NULL,
  money_scale smallint NOT NULL DEFAULT 2 CHECK (money_scale BETWEEN 0 AND 9),
  state text NOT NULL DEFAULT 'unmatched' CHECK (state IN ('unmatched','matched','variance','posted','cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, supplier_id, bill_number),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id),
  CHECK (subtotal_minor + tax_minor = total_minor)
);

CREATE TABLE IF NOT EXISTS procurement.supplier_bill_purchase_orders (
  tenant_id uuid NOT NULL,
  supplier_bill_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, supplier_bill_id, purchase_order_id),
  FOREIGN KEY (tenant_id, supplier_bill_id) REFERENCES procurement.supplier_bills(tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS procurement.supplier_bill_receipts (
  tenant_id uuid NOT NULL,
  supplier_bill_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, supplier_bill_id, goods_receipt_id),
  FOREIGN KEY (tenant_id, supplier_bill_id) REFERENCES procurement.supplier_bills(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS procurement.three_way_match_results (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  supplier_bill_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('matched','quantity_variance','price_variance','missing_receipt','failed')),
  ordered_amount_minor numeric(38,0) NOT NULL,
  received_amount_minor numeric(38,0) NOT NULL,
  billed_amount_minor numeric(38,0) NOT NULL,
  quantity_variance_minor numeric(38,0) NOT NULL,
  price_variance_minor numeric(38,0) NOT NULL,
  currency char(3) NOT NULL,
  money_scale smallint NOT NULL DEFAULT 2 CHECK (money_scale BETWEEN 0 AND 9),
  evidence_refs text[] NOT NULL DEFAULT '{}',
  accounting_instruction jsonb NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_bill_id) REFERENCES procurement.supplier_bills(tenant_id, id)
);
DROP TRIGGER IF EXISTS three_way_match_results_append_only ON procurement.three_way_match_results;
CREATE TRIGGER three_way_match_results_append_only BEFORE UPDATE OR DELETE ON procurement.three_way_match_results
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE TABLE IF NOT EXISTS procurement.landed_cost_documents (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  currency char(3) NOT NULL,
  total_minor numeric(38,0) NOT NULL CHECK (total_minor >= 0),
  money_scale smallint NOT NULL DEFAULT 2 CHECK (money_scale BETWEEN 0 AND 9),
  allocation_basis text NOT NULL CHECK (allocation_basis IN ('quantity','inventory_value','manual')),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','posted','reversed')),
  posted_by uuid NULL,
  posted_at timestamptz NULL,
  posting_group_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS landed_cost_posting_group_idx ON procurement.landed_cost_documents(tenant_id, posting_group_id)
  WHERE posting_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS procurement.landed_cost_allocations (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  landed_cost_document_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  cost_layer_id uuid NOT NULL,
  amount_minor numeric(38,0) NOT NULL,
  currency char(3) NOT NULL,
  money_scale smallint NOT NULL DEFAULT 2 CHECK (money_scale BETWEEN 0 AND 9),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, landed_cost_document_id, cost_layer_id),
  FOREIGN KEY (tenant_id, landed_cost_document_id) REFERENCES procurement.landed_cost_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, goods_receipt_line_id) REFERENCES procurement.goods_receipt_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, cost_layer_id) REFERENCES inventory.cost_layers(tenant_id, id)
);

ALTER TABLE inventory.reorder_policies
  DROP CONSTRAINT IF EXISTS reorder_policies_supplier_fk;
ALTER TABLE inventory.reorder_policies
  ADD CONSTRAINT reorder_policies_supplier_fk
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES procurement.suppliers(tenant_id, id);

DROP TRIGGER IF EXISTS goods_receipt_lines_append_only ON procurement.goods_receipt_lines;
CREATE TRIGGER goods_receipt_lines_append_only BEFORE UPDATE OR DELETE ON procurement.goods_receipt_lines
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
DROP TRIGGER IF EXISTS supplier_return_lines_append_only ON procurement.supplier_return_lines;
CREATE TRIGGER supplier_return_lines_append_only BEFORE UPDATE OR DELETE ON procurement.supplier_return_lines
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
DROP TRIGGER IF EXISTS landed_cost_allocations_append_only ON procurement.landed_cost_allocations;
CREATE TRIGGER landed_cost_allocations_append_only BEFORE UPDATE OR DELETE ON procurement.landed_cost_allocations
FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'suppliers','supplier_contacts','supplier_items','purchase_requisitions','purchase_requisition_lines',
    'purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','supplier_returns',
    'supplier_return_lines','supplier_bills','supplier_bill_purchase_orders','supplier_bill_receipts',
    'three_way_match_results','landed_cost_documents','landed_cost_allocations'
  ] LOOP
    EXECUTE format('ALTER TABLE procurement.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE procurement.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON procurement.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON procurement.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

GRANT USAGE ON SCHEMA procurement TO store_app_runtime, store_app_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA procurement TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA procurement TO store_app_reporting;
REVOKE UPDATE, DELETE ON procurement.goods_receipt_lines, procurement.supplier_return_lines, procurement.three_way_match_results, procurement.landed_cost_allocations FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA procurement GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA procurement GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('procurement.supplier.read','procurement','Read suppliers and supplier item mappings','standard'),
  ('procurement.supplier.manage','procurement','Manage suppliers and supplier item mappings','sensitive'),
  ('procurement.requisition.read','procurement','Read purchase requisitions','standard'),
  ('procurement.requisition.manage','procurement','Create and submit purchase requisitions','sensitive'),
  ('procurement.requisition.approve','procurement','Approve or reject purchase requisitions','privileged'),
  ('procurement.purchase_order.read','procurement','Read purchase orders','standard'),
  ('procurement.purchase_order.manage','procurement','Create and amend purchase orders','sensitive'),
  ('procurement.purchase_order.approve','procurement','Approve purchase orders','privileged'),
  ('procurement.receipt.manage','procurement','Post goods receipts and discrepancies','sensitive'),
  ('procurement.return.manage','procurement','Post supplier returns','sensitive'),
  ('procurement.bill.match','procurement','Run supplier bill three-way matching','sensitive'),
  ('procurement.landed_cost.manage','procurement','Allocate and post landed cost','privileged'),
  ('procurement.report.read','procurement','Read procurement and supplier performance reports','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('PUR-0001','MOD-B-PROCUREMENT','manifest:PUR-0001-procurement.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
