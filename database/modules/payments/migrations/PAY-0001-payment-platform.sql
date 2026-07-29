BEGIN;

CREATE TABLE payment.provider_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  code text NOT NULL,
  provider_key text NOT NULL,
  display_name text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','degraded','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id)
);

CREATE TABLE payment.terminal_mappings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  provider_account_id uuid NOT NULL,
  store_id uuid NULL,
  register_id uuid NULL,
  terminal_reference text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_account_id, terminal_reference),
  FOREIGN KEY (tenant_id, provider_account_id) REFERENCES payment.provider_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);

CREATE TABLE payment.payment_intents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  register_id uuid NULL,
  provider_account_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_version text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  captured_minor bigint NOT NULL DEFAULT 0 CHECK (captured_minor >= 0),
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','requires_action','authorized','captured','declined','cancelled','unknown','partially_refunded','refunded','charged_back')),
  provider_reference text NULL,
  payment_method_token_ref text NULL,
  unknown_since timestamptz NULL,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (captured_minor <= amount_minor),
  CHECK (refunded_minor <= captured_minor),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_account_id, provider_reference),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, provider_account_id) REFERENCES payment.provider_accounts(tenant_id, id)
);
CREATE INDEX payment_intents_source_idx ON payment.payment_intents(tenant_id, source_type, source_id);
CREATE INDEX payment_intents_unknown_idx ON payment.payment_intents(tenant_id, unknown_since) WHERE status = 'unknown';

CREATE TABLE payment.payment_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payment_intent_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('authorize','capture','void','refund','status_query','webhook')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  provider_reference text NULL,
  outcome text NOT NULL CHECK (outcome IN ('processing','succeeded','declined','failed','ambiguous')),
  failure_category text NULL,
  provider_code text NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, payment_intent_id, idempotency_key),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment.payment_intents(tenant_id, id)
);

CREATE TABLE payment.payment_state_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payment_intent_id uuid NOT NULL,
  payment_attempt_id uuid NULL,
  prior_status text NULL,
  new_status text NOT NULL,
  amount_minor bigint NULL,
  event_reason text NOT NULL,
  provider_reference text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  actor_id uuid NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment.payment_intents(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_attempt_id) REFERENCES payment.payment_attempts(tenant_id, id)
);
CREATE INDEX payment_state_events_intent_idx ON payment.payment_state_events(tenant_id, payment_intent_id, occurred_at, id);

CREATE TABLE payment.payment_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payment_intent_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('invoice','credit_note','customer_open_item','supplier_open_item')),
  target_id text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  reversal_of_allocation_id uuid NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  reason text NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment.payment_intents(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_allocation_id) REFERENCES payment.payment_allocations(tenant_id, id)
);
CREATE INDEX payment_allocations_target_idx ON payment.payment_allocations(tenant_id, target_type, target_id);

CREATE TABLE payment.refunds (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payment_intent_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','pending_approval','processing','succeeded','declined','failed','unknown','cancelled')),
  provider_reference text NULL,
  approval_request_id uuid NULL,
  reversal_of_refund_id uuid NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment.payment_intents(tenant_id, id),
  FOREIGN KEY (tenant_id, provider_account_id) REFERENCES payment.provider_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_refund_id) REFERENCES payment.refunds(tenant_id, id)
);

CREATE TABLE payment.settlements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_settlement_id text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  gross_minor bigint NOT NULL,
  fee_minor bigint NOT NULL,
  adjustment_minor bigint NOT NULL,
  net_minor bigint NOT NULL,
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','matched','reconciled','exception','reversed')),
  settled_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_hash text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (net_minor = gross_minor - fee_minor - adjustment_minor),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_account_id, provider_settlement_id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, provider_account_id) REFERENCES payment.provider_accounts(tenant_id, id)
);

CREATE TABLE payment.settlement_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  settlement_id uuid NOT NULL,
  payment_intent_id uuid NULL,
  refund_id uuid NULL,
  line_type text NOT NULL CHECK (line_type IN ('capture','refund','fee','adjustment','chargeback')),
  provider_reference text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  gross_minor bigint NOT NULL,
  fee_minor bigint NOT NULL,
  net_minor bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, settlement_id, provider_reference, line_type),
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES payment.settlements(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_intent_id) REFERENCES payment.payment_intents(tenant_id, id),
  FOREIGN KEY (tenant_id, refund_id) REFERENCES payment.refunds(tenant_id, id)
);

CREATE OR REPLACE FUNCTION payment.protect_payment_intent_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.legal_entity_id IS DISTINCT FROM NEW.legal_entity_id OR OLD.provider_account_id IS DISTINCT FROM NEW.provider_account_id OR OLD.source_type IS DISTINCT FROM NEW.source_type OR OLD.source_id IS DISTINCT FROM NEW.source_id OR OLD.source_version IS DISTINCT FROM NEW.source_version OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.scale IS DISTINCT FROM NEW.scale OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'payment intent identity and amount are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.captured_minor > NEW.amount_minor OR NEW.refunded_minor > NEW.captured_minor THEN
    RAISE EXCEPTION 'payment captured/refunded totals are invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_intent_identity_immutable BEFORE UPDATE ON payment.payment_intents FOR EACH ROW EXECUTE FUNCTION payment.protect_payment_intent_identity();

CREATE TRIGGER payment_attempts_append_only BEFORE UPDATE OR DELETE ON payment.payment_attempts FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER payment_state_events_append_only BEFORE UPDATE OR DELETE ON payment.payment_state_events FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON payment.payment_allocations FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER settlement_lines_append_only BEFORE UPDATE OR DELETE ON payment.settlement_lines FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['provider_accounts','terminal_mappings','payment_intents','payment_attempts','payment_state_events','payment_allocations','refunds','settlements','settlement_lines'] LOOP
    EXECUTE format('ALTER TABLE payment.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE payment.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON payment.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('payments.read','payment','Read payment intent, allocation, refund and settlement state','sensitive'),
  ('payments.intent.create','payment','Create payment intents','sensitive'),
  ('payments.authorize','payment','Authorize a payment through an approved provider','privileged'),
  ('payments.capture','payment','Capture an authorized payment','privileged'),
  ('payments.refund.request','payment','Request a payment refund','privileged'),
  ('payments.refund.approve','payment','Approve a high-risk payment refund','privileged'),
  ('payments.recover','payment','Recover ambiguous provider state','privileged'),
  ('payments.settlement.import','payment','Import provider settlements','privileged'),
  ('payments.settlement.reconcile','payment','Reconcile provider settlements','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA payment TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA payment TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payment FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('PAY-0001','MOD-E-PAYMENT','manifest:PAY-0001-payment-platform.sql');

COMMIT;
