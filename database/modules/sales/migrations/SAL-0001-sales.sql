BEGIN;

CREATE SCHEMA IF NOT EXISTS sales;
COMMENT ON SCHEMA sales IS 'MOD-C quotations, orders, operational invoices and credit notes';

CREATE TABLE IF NOT EXISTS sales.document_sequences (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('quote','order','invoice','credit_note')),
  business_date date NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, legal_entity_id, document_type, business_date)
);

CREATE OR REPLACE FUNCTION sales.next_document_number(
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_document_type text,
  p_business_date date
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_value bigint;
  v_prefix text;
BEGIN
  IF p_document_type NOT IN ('quote','order','invoice','credit_note') THEN
    RAISE EXCEPTION 'Unsupported sales document type %', p_document_type USING ERRCODE = '22023';
  END IF;

  INSERT INTO sales.document_sequences(tenant_id, legal_entity_id, document_type, business_date, next_value)
  VALUES (p_tenant_id, p_legal_entity_id, p_document_type, p_business_date, 1)
  ON CONFLICT DO NOTHING;

  SELECT next_value INTO v_value
  FROM sales.document_sequences
  WHERE tenant_id = p_tenant_id
    AND legal_entity_id = p_legal_entity_id
    AND document_type = p_document_type
    AND business_date = p_business_date
  FOR UPDATE;

  UPDATE sales.document_sequences
  SET next_value = v_value + 1, updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND legal_entity_id = p_legal_entity_id
    AND document_type = p_document_type
    AND business_date = p_business_date;

  v_prefix := CASE p_document_type
    WHEN 'quote' THEN 'QTE'
    WHEN 'order' THEN 'ORD'
    WHEN 'invoice' THEN 'INV'
    ELSE 'CRN'
  END;
  RETURN format('%s-%s-%s', v_prefix, to_char(p_business_date, 'YYYYMMDD'), lpad(v_value::text, 6, '0'));
END $$;

CREATE TABLE IF NOT EXISTS sales.quotes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  document_number text NOT NULL,
  customer_id uuid NOT NULL,
  customer_snapshot jsonb NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  quote_status text NOT NULL CHECK (quote_status IN ('draft','sent','accepted','expired','cancelled')),
  expires_at timestamptz NULL,
  totals_snapshot jsonb NOT NULL,
  salesperson_id uuid NULL,
  commission_basis_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  converted_order_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, document_number)
);
CREATE INDEX IF NOT EXISTS sales_quote_query_idx ON sales.quotes(tenant_id, legal_entity_id, store_id, quote_status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS sales_quote_customer_idx ON sales.quotes(tenant_id, customer_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS sales.quote_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  quote_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  item_snapshot jsonb NOT NULL,
  quantity_snapshot jsonb NOT NULL,
  price_tax_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_id, line_number),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES sales.quotes(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_quote_line_variant_idx ON sales.quote_lines(tenant_id, variant_id, quote_id);

CREATE TABLE IF NOT EXISTS sales.quote_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  quote_id uuid NOT NULL,
  quote_version bigint NOT NULL CHECK (quote_version > 0),
  quote_status text NOT NULL CHECK (quote_status IN ('draft','sent','accepted','expired','cancelled')),
  content_snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_id, quote_version),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES sales.quotes(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_quote_revision_history_idx ON sales.quote_revisions(tenant_id, quote_id, quote_version DESC);

CREATE TABLE IF NOT EXISTS sales.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  document_number text NOT NULL,
  source_quote_id uuid NULL,
  customer_id uuid NOT NULL,
  customer_snapshot jsonb NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  fulfillment_method text NOT NULL CHECK (fulfillment_method IN ('pickup','local_delivery','ship_from_store','split')),
  payment_terms text NOT NULL CHECK (payment_terms IN ('prepaid','deposit','layaway','on_account')),
  reservation_id uuid NOT NULL,
  credit_decision text NULL CHECK (credit_decision IS NULL OR credit_decision IN ('approved','approval_required')),
  credit_approval_id text NULL,
  order_status text NOT NULL CHECK (order_status IN ('draft','confirmed','on_hold','cancelled','completed')),
  payment_status text NOT NULL CHECK (payment_status IN ('unpaid','partially_paid','paid','partially_refunded','refunded')),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN ('unfulfilled','partially_fulfilled','fulfilled','cancelled')),
  invoice_status text NOT NULL CHECK (invoice_status IN ('not_invoiced','partially_invoiced','invoiced','credited')),
  return_status text NOT NULL CHECK (return_status IN ('not_returned','partially_returned','returned')),
  backorder_status text NOT NULL CHECK (backorder_status IN ('none','backordered','released')),
  totals_snapshot jsonb NOT NULL,
  salesperson_id uuid NULL,
  commission_basis_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  cancellation jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, document_number),
  FOREIGN KEY (tenant_id, source_quote_id) REFERENCES sales.quotes(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_order_query_idx ON sales.orders(tenant_id, legal_entity_id, store_id, order_status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS sales_order_customer_idx ON sales.orders(tenant_id, customer_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_queue_idx ON sales.orders(tenant_id, warehouse_id, fulfillment_status, order_status, created_at, id)
  WHERE order_status = 'confirmed' AND fulfillment_status <> 'fulfilled';
CREATE INDEX IF NOT EXISTS sales_order_backorder_idx ON sales.orders(tenant_id, warehouse_id, backorder_status, created_at, id)
  WHERE backorder_status = 'backordered';

CREATE TABLE IF NOT EXISTS sales.order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  source_quote_line_id uuid NULL,
  item_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  item_snapshot jsonb NOT NULL,
  quantity_snapshot jsonb NOT NULL,
  price_tax_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id, line_number),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales.orders(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_order_line_variant_idx ON sales.order_lines(tenant_id, variant_id, order_id);

CREATE TABLE IF NOT EXISTS sales.payment_observations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  order_id uuid NOT NULL,
  payment_intent_id text NOT NULL,
  payment_status text NOT NULL CHECK (payment_status IN ('created','requires_action','authorized','captured','declined','cancelled','unknown','refunded','partially_refunded')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  provider_reference text NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  event_id text NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, payment_intent_id, payment_status, observed_at),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales.orders(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_payment_order_idx ON sales.payment_observations(tenant_id, order_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS sales.fulfillment_observations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  order_id uuid NOT NULL,
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN ('unfulfilled','partially_fulfilled','fulfilled','cancelled')),
  fulfilled_quantities jsonb NOT NULL DEFAULT '[]'::jsonb,
  backordered_quantities jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  event_id text NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales.orders(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_fulfillment_order_idx ON sales.fulfillment_observations(tenant_id, order_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS sales.invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  order_id uuid NOT NULL,
  document_number text NULL,
  external_reference text NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  totals_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','posted')),
  posted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, document_number),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales.orders(tenant_id, id),
  CHECK ((status = 'posted' AND document_number IS NOT NULL AND posted_at IS NOT NULL) OR status = 'draft')
);
CREATE INDEX IF NOT EXISTS sales_invoice_order_idx ON sales.invoices(tenant_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_invoice_query_idx ON sales.invoices(tenant_id, legal_entity_id, store_id, status, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS sales.invoice_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  invoice_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  quantity_snapshot jsonb NOT NULL,
  price_tax_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, invoice_id, line_number),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES sales.invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES sales.order_lines(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS sales.credit_notes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  document_number text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  totals_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'posted' CHECK (status = 'posted'),
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, document_number),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES sales.invoices(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_credit_note_invoice_idx ON sales.credit_notes(tenant_id, invoice_id, posted_at DESC);

CREATE TABLE IF NOT EXISTS sales.credit_note_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  credit_note_id uuid NOT NULL,
  invoice_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  quantity_snapshot jsonb NOT NULL,
  original_price_tax_snapshot jsonb NOT NULL,
  allocation_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, credit_note_id, line_number),
  FOREIGN KEY (tenant_id, credit_note_id) REFERENCES sales.credit_notes(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_line_id) REFERENCES sales.invoice_lines(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS sales.document_notes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  document_type text NOT NULL CHECK (document_type IN ('quote','order','invoice','credit_note')),
  document_id uuid NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 4000),
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_document_note_lookup_idx ON sales.document_notes(tenant_id, document_type, document_id, created_at);

CREATE TABLE IF NOT EXISTS sales.document_attachments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  document_type text NOT NULL CHECK (document_type IN ('quote','order','invoice','credit_note')),
  document_id uuid NOT NULL,
  file_name text NOT NULL,
  object_key text NOT NULL,
  content_type text NULL,
  byte_size bigint NULL CHECK (byte_size IS NULL OR byte_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, object_key)
);
CREATE INDEX IF NOT EXISTS sales_document_attachment_lookup_idx ON sales.document_attachments(tenant_id, document_type, document_id, created_at);

CREATE TABLE IF NOT EXISTS sales.customer_communications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  document_type text NULL CHECK (document_type IS NULL OR document_type IN ('quote','order','invoice','credit_note')),
  document_id uuid NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','phone','whatsapp','in_person','other')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  subject text NOT NULL,
  content_summary text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_customer_communication_idx ON sales.customer_communications(tenant_id, customer_id, occurred_at DESC, id);

CREATE OR REPLACE FUNCTION sales.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION sales.reject_posted_document_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Posted invoice is immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'invoice_lines' THEN
    SELECT status INTO v_status FROM sales.invoices WHERE tenant_id = OLD.tenant_id AND id = OLD.invoice_id;
    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'Posted invoice lines are immutable' USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'Posted credit-note document is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS sales_quote_revisions_append_only ON sales.quote_revisions;
CREATE TRIGGER sales_quote_revisions_append_only BEFORE UPDATE OR DELETE ON sales.quote_revisions
  FOR EACH ROW EXECUTE FUNCTION sales.reject_append_only_mutation();
DROP TRIGGER IF EXISTS sales_payment_observations_append_only ON sales.payment_observations;
CREATE TRIGGER sales_payment_observations_append_only BEFORE UPDATE OR DELETE ON sales.payment_observations
  FOR EACH ROW EXECUTE FUNCTION sales.reject_append_only_mutation();
DROP TRIGGER IF EXISTS sales_fulfillment_observations_append_only ON sales.fulfillment_observations;
CREATE TRIGGER sales_fulfillment_observations_append_only BEFORE UPDATE OR DELETE ON sales.fulfillment_observations
  FOR EACH ROW EXECUTE FUNCTION sales.reject_append_only_mutation();
DROP TRIGGER IF EXISTS sales_invoices_immutable_when_posted ON sales.invoices;
CREATE TRIGGER sales_invoices_immutable_when_posted BEFORE UPDATE OR DELETE ON sales.invoices
  FOR EACH ROW EXECUTE FUNCTION sales.reject_posted_document_mutation();
DROP TRIGGER IF EXISTS sales_invoice_lines_immutable_when_posted ON sales.invoice_lines;
CREATE TRIGGER sales_invoice_lines_immutable_when_posted BEFORE UPDATE OR DELETE ON sales.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION sales.reject_posted_document_mutation();
DROP TRIGGER IF EXISTS sales_credit_notes_immutable ON sales.credit_notes;
CREATE TRIGGER sales_credit_notes_immutable BEFORE UPDATE OR DELETE ON sales.credit_notes
  FOR EACH ROW EXECUTE FUNCTION sales.reject_posted_document_mutation();
DROP TRIGGER IF EXISTS sales_credit_note_lines_immutable ON sales.credit_note_lines;
CREATE TRIGGER sales_credit_note_lines_immutable BEFORE UPDATE OR DELETE ON sales.credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION sales.reject_posted_document_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'document_sequences','quotes','quote_lines','quote_revisions','orders','order_lines',
    'payment_observations','fulfillment_observations','invoices','invoice_lines','credit_notes',
    'credit_note_lines','document_notes','document_attachments','customer_communications'
  ] LOOP
    EXECUTE format('ALTER TABLE sales.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE sales.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON sales.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON sales.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('sales.quote.create','sales','Create quotations','standard'),
  ('sales.quote.update','sales','Revise draft quotations','standard'),
  ('sales.quote.send','sales','Send quotations to customers','standard'),
  ('sales.quote.accept','sales','Record quotation acceptance','sensitive'),
  ('sales.order.create','sales','Create and confirm sales orders','sensitive'),
  ('sales.order.read','sales','Read sales orders and lifecycle status','standard'),
  ('sales.order.update','sales','Record payment and fulfillment observations','sensitive'),
  ('sales.order.cancel','sales','Cancel unaffected sales orders','sensitive'),
  ('sales.order.cancel_after_effects','sales','Cancel orders after payment, fulfillment or invoicing with approval','privileged'),
  ('sales.invoice.create','sales','Create operational invoices','sensitive'),
  ('sales.invoice.post','sales','Post immutable operational invoices','privileged'),
  ('sales.credit_note.create','sales','Issue immutable operational credit notes','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA sales TO store_app_runtime, store_app_reporting;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA sales TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA sales TO store_app_reporting;
GRANT EXECUTE ON FUNCTION sales.next_document_number(uuid, uuid, text, date) TO store_app_runtime;
REVOKE DELETE ON ALL TABLES IN SCHEMA sales FROM store_app_runtime;
REVOKE UPDATE ON sales.quote_revisions, sales.payment_observations, sales.fulfillment_observations, sales.credit_notes, sales.credit_note_lines FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales GRANT SELECT, INSERT, UPDATE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('SAL-0001','MOD-C-SALES','manifest:SAL-0001-sales.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
