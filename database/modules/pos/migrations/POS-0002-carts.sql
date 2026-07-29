BEGIN;

CREATE TABLE pos.carts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  session_id uuid NOT NULL,
  customer_reference text NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','checkout_pending','completed','cancelled')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES pos.register_sessions(tenant_id, id)
);
CREATE INDEX carts_session_status_idx ON pos.carts(tenant_id, session_id, status, updated_at, id);

CREATE TABLE pos.cart_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  variant_reference text NOT NULL,
  quantity numeric(30, 12) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  price_snapshot jsonb NOT NULL,
  tax_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cart_id, line_number),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id)
);

ALTER TABLE pos.checkout_operations
  ADD COLUMN cart_id uuid NOT NULL,
  ADD CONSTRAINT checkout_operations_cart_fk
    FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id);

CREATE OR REPLACE FUNCTION pos.protect_checkout_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.register_id IS DISTINCT FROM NEW.register_id
     OR OLD.device_id IS DISTINCT FROM NEW.device_id
     OR OLD.session_id IS DISTINCT FROM NEW.session_id
     OR OLD.cart_id IS DISTINCT FROM NEW.cart_id
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

ALTER TABLE pos.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.carts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos.carts
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE pos.cart_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.cart_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos.cart_lines
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

GRANT SELECT ON pos.carts, pos.cart_lines TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON pos.carts, pos.cart_lines FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0002','MOD-D-POS','manifest:POS-0002-carts.sql');

COMMIT;
