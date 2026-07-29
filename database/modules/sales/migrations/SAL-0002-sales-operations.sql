BEGIN;

ALTER TABLE sales.orders
  ADD COLUMN IF NOT EXISTS availability_mode text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS external_source text NULL,
  ADD COLUMN IF NOT EXISTS external_order_id text NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sales.orders'::regclass
      AND conname = 'sales_orders_availability_mode_check'
  ) THEN
    ALTER TABLE sales.orders
      ADD CONSTRAINT sales_orders_availability_mode_check
      CHECK (availability_mode IN ('standard','preorder','backorder'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sales.orders'::regclass
      AND conname = 'sales_orders_external_identity_complete_check'
  ) THEN
    ALTER TABLE sales.orders
      ADD CONSTRAINT sales_orders_external_identity_complete_check
      CHECK ((external_source IS NULL AND external_order_id IS NULL) OR (external_source IS NOT NULL AND external_order_id IS NOT NULL));
  END IF;
END $constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS sales_external_order_unique
  ON sales.orders(tenant_id, external_source, external_order_id)
  WHERE external_source IS NOT NULL AND external_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_order_availability_queue_idx
  ON sales.orders(tenant_id, warehouse_id, availability_mode, order_status, created_at, id)
  WHERE availability_mode IN ('preorder','backorder') AND order_status IN ('confirmed','on_hold');

CREATE TABLE IF NOT EXISTS sales.import_batches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  source_system text NOT NULL CHECK (char_length(source_system) BETWEEN 1 AND 80),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 240),
  row_count integer NOT NULL CHECK (row_count BETWEEN 0 AND 500),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (imported_count + skipped_count + error_count <= row_count),
  CHECK ((status = 'processing' AND completed_at IS NULL) OR (status <> 'processing' AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_import_batch_status_idx
  ON sales.import_batches(tenant_id, status, created_at DESC, id);

ALTER TABLE sales.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales.import_batches;
CREATE POLICY tenant_isolation ON sales.import_batches
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('sales.order.import','sales','Import externally sourced orders through bounded idempotent batches','sensitive'),
  ('sales.order.export','sales','Export scoped operational order data','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT SELECT, INSERT, UPDATE ON sales.import_batches TO store_app_runtime;
GRANT SELECT ON sales.import_batches TO store_app_reporting;
REVOKE DELETE ON sales.import_batches FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('SAL-0002','MOD-C-SALES','manifest:SAL-0002-sales-operations.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
