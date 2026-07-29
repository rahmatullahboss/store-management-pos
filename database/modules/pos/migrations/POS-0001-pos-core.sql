BEGIN;

CREATE TABLE pos.register_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id text NOT NULL,
  cashier_id uuid NOT NULL REFERENCES platform.users(id),
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed','revoked')),
  offline_authorization_id text NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR status <> 'closed')
);
CREATE UNIQUE INDEX register_sessions_one_open_idx
  ON pos.register_sessions(tenant_id, register_id)
  WHERE status IN ('open','closing');

CREATE TABLE pos.device_enrollments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id text NOT NULL,
  public_key_id text NOT NULL,
  hardware_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','revoked')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR status <> 'revoked')
);

CREATE TABLE pos.carts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  register_session_id uuid NOT NULL,
  customer_id text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','converted','abandoned')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  source_mode text NOT NULL CHECK (source_mode IN ('online','offline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_session_id) REFERENCES pos.register_sessions(tenant_id, id)
);

CREATE TABLE pos.cart_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_id text NOT NULL,
  variant_id text NOT NULL,
  quantity numeric(38,12) NOT NULL CHECK (quantity > 0),
  quantity_unit text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  gross_minor bigint NOT NULL CHECK (gross_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  net_minor bigint NOT NULL CHECK (net_minor >= 0),
  price_tax_snapshot jsonb NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cart_id, line_number),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id) ON DELETE CASCADE,
  CHECK (discount_minor <= gross_minor),
  CHECK (net_minor = gross_minor - discount_minor + tax_minor)
);

CREATE TABLE pos.operation_inbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_id text NOT NULL,
  register_id uuid NOT NULL,
  operation_id text NOT NULL,
  local_sequence bigint NOT NULL CHECK (local_sequence > 0),
  operation_type text NOT NULL CHECK (operation_type IN ('checkout','cash_event','shift_open','shift_close','receipt_delivery','device_health')),
  payload_hash text NOT NULL,
  authorization_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','applied','duplicate','rejected','review_required','payment_unknown')),
  business_effect_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_code text NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, device_id, operation_id),
  UNIQUE (tenant_id, device_id, local_sequence),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);
CREATE INDEX operation_inbox_status_idx
  ON pos.operation_inbox(tenant_id, status, received_at);

CREATE TABLE pos.checkouts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  register_session_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  operation_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  source_mode text NOT NULL CHECK (source_mode IN ('online','offline')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  status text NOT NULL CHECK (status IN ('processing','accepted_online','accepted_offline_pending_sync','rejected','review_required','payment_unknown','reversed')),
  sales_document_id text NULL,
  accounting_posting_id text NULL,
  accepted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operation_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, register_session_id) REFERENCES pos.register_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES pos.carts(tenant_id, id),
  CHECK (discount_minor <= subtotal_minor),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor)
);

CREATE TABLE pos.checkout_tenders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  checkout_id uuid NOT NULL,
  tender_id text NOT NULL,
  tender_kind text NOT NULL CHECK (tender_kind IN ('cash','external_card','stored_value','account_credit')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  state text NOT NULL CHECK (state IN ('accepted','authorized','captured','declined','unknown','cancelled')),
  payment_intent_id uuid NULL,
  provider_capability_id text NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, checkout_id, tender_id),
  FOREIGN KEY (tenant_id, checkout_id) REFERENCES pos.checkouts(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment.payment_intents(tenant_id, id)
);

CREATE TABLE pos.receipt_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  checkout_id uuid NOT NULL,
  receipt_number text NOT NULL,
  business_date date NOT NULL,
  locale text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  paid_minor bigint NOT NULL CHECK (paid_minor >= 0),
  source_mode text NOT NULL CHECK (source_mode IN ('online','offline')),
  source_operation_id text NOT NULL,
  semantic_snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, receipt_number),
  UNIQUE (tenant_id, content_hash),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, checkout_id) REFERENCES pos.checkouts(tenant_id, id),
  CHECK (discount_minor <= subtotal_minor),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor),
  CHECK (paid_minor = total_minor)
);

CREATE TABLE pos.receipt_delivery_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('print','email','sms')),
  destination text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  idempotency_key text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  failure_code text NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES pos.receipt_snapshots(tenant_id, id)
);

CREATE OR REPLACE FUNCTION pos.protect_checkout_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.legal_entity_id IS DISTINCT FROM NEW.legal_entity_id
     OR OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.register_id IS DISTINCT FROM NEW.register_id
     OR OLD.register_session_id IS DISTINCT FROM NEW.register_session_id
     OR OLD.cart_id IS DISTINCT FROM NEW.cart_id
     OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.scale IS DISTINCT FROM NEW.scale
     OR OLD.subtotal_minor IS DISTINCT FROM NEW.subtotal_minor
     OR OLD.discount_minor IS DISTINCT FROM NEW.discount_minor
     OR OLD.tax_minor IS DISTINCT FROM NEW.tax_minor
     OR OLD.total_minor IS DISTINCT FROM NEW.total_minor
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'checkout identity and exact totals are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_identity_immutable
  BEFORE UPDATE ON pos.checkouts
  FOR EACH ROW EXECUTE FUNCTION pos.protect_checkout_identity();

CREATE OR REPLACE FUNCTION pos.protect_operation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.device_id IS DISTINCT FROM NEW.device_id
     OR OLD.register_id IS DISTINCT FROM NEW.register_id
     OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
     OR OLD.local_sequence IS DISTINCT FROM NEW.local_sequence
     OR OLD.operation_type IS DISTINCT FROM NEW.operation_type
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.authorization_id IS DISTINCT FROM NEW.authorization_id
     OR OLD.received_at IS DISTINCT FROM NEW.received_at THEN
    RAISE EXCEPTION 'offline operation identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operation_identity_immutable
  BEFORE UPDATE ON pos.operation_inbox
  FOR EACH ROW EXECUTE FUNCTION pos.protect_operation_identity();

CREATE TRIGGER checkout_tenders_append_only
  BEFORE UPDATE OR DELETE ON pos.checkout_tenders
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER receipt_snapshots_append_only
  BEFORE UPDATE OR DELETE ON pos.receipt_snapshots
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'register_sessions',
    'device_enrollments',
    'carts',
    'cart_lines',
    'operation_inbox',
    'checkouts',
    'checkout_tenders',
    'receipt_snapshots',
    'receipt_delivery_requests'
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
  ('pos.checkout','pos','Complete an online or approved offline checkout','sensitive'),
  ('pos.discount.override','pos','Override POS price or discount under approval','privileged'),
  ('pos.receipt.read','pos','Read immutable POS receipt snapshots','sensitive'),
  ('pos.receipt.deliver','pos','Request print, email or SMS receipt delivery','standard'),
  ('pos.offline.sync','pos','Upload offline operations and download projections','sensitive'),
  ('pos.device.enroll','pos','Enroll a register device and hardware profile','privileged'),
  ('pos.device.revoke','pos','Revoke a register device','privileged'),
  ('pos.reconciliation.read','pos','Read rejected and review-required POS operations','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA pos TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA pos TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pos FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0001','MOD-D-POS','manifest:POS-0001-pos-core.sql');

COMMIT;
