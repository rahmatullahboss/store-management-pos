BEGIN;

CREATE TABLE banking.bank_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  ledger_account_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  bank_name text NOT NULL,
  account_reference_masked text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  country_code char(2) NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, ledger_account_id) REFERENCES accounting.accounts(tenant_id, id)
);

CREATE TABLE banking.statement_imports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('csv','ofx','camt','api','manual')),
  source_name text NOT NULL,
  source_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed','duplicate','cancelled')),
  line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  imported_by uuid NOT NULL REFERENCES platform.users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  failure_code text NULL,
  failure_message text NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, bank_account_id, source_hash),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES banking.bank_accounts(tenant_id, id)
);

CREATE TABLE banking.statement_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  statement_import_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  external_id text NULL,
  fingerprint text NOT NULL,
  booked_at timestamptz NOT NULL,
  value_date date NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  running_balance_minor bigint NULL,
  reference text NOT NULL,
  counterparty_name text NULL,
  counterparty_reference text NULL,
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status text NOT NULL DEFAULT 'unmatched' CHECK (reconciliation_status IN ('unmatched','suggested','matched','partially_matched','exception','reversed')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, statement_import_id, line_number),
  UNIQUE (tenant_id, bank_account_id, fingerprint),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES banking.bank_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, statement_import_id) REFERENCES banking.statement_imports(tenant_id, id)
);
CREATE UNIQUE INDEX banking_statement_external_unique ON banking.statement_lines(tenant_id, bank_account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX banking_statement_unmatched_idx ON banking.statement_lines(tenant_id, bank_account_id, booked_at, id) WHERE reconciliation_status IN ('unmatched','suggested','exception');

CREATE TABLE banking.reconciliation_rules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  priority integer NOT NULL CHECK (priority >= 0),
  rule_definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  approved_by uuid NULL REFERENCES platform.users(id),
  approval_request_id uuid NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, code, effective_from),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);

CREATE TABLE banking.reconciliations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  statement_line_id uuid NOT NULL,
  candidate_type text NOT NULL CHECK (candidate_type IN ('settlement','payment','refund','supplier_payment','cash_deposit','journal','opening_balance')),
  candidate_id text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  matched_amount_minor bigint NOT NULL CHECK (matched_amount_minor <> 0),
  status text NOT NULL DEFAULT 'matched' CHECK (status IN ('matched','reversed','exception')),
  match_method text NOT NULL CHECK (match_method IN ('automatic','manual','imported')),
  confidence_basis_points integer NULL CHECK (confidence_basis_points BETWEEN 0 AND 10000),
  rule_id uuid NULL,
  journal_entry_id uuid NULL,
  reversal_of_reconciliation_id uuid NULL,
  reason text NULL,
  matched_by uuid NOT NULL REFERENCES platform.users(id),
  matched_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, statement_line_id, candidate_type, candidate_id, status),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES banking.bank_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, statement_line_id) REFERENCES banking.statement_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES banking.reconciliation_rules(tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES accounting.journal_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_reconciliation_id) REFERENCES banking.reconciliations(tenant_id, id)
);
CREATE INDEX banking_reconciliations_candidate_idx ON banking.reconciliations(tenant_id, candidate_type, candidate_id, matched_at);

CREATE TABLE banking.reconciliation_exceptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  statement_line_id uuid NULL,
  settlement_id uuid NULL,
  exception_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('information','warning','error','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','waived','reopened')),
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed jsonb NOT NULL DEFAULT '{}'::jsonb,
  difference_minor bigint NULL,
  currency char(3) NULL,
  scale smallint NULL CHECK (scale BETWEEN 0 AND 12),
  owner_id uuid NULL REFERENCES platform.users(id),
  reason text NULL,
  resolution text NULL,
  approval_request_id uuid NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES banking.bank_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, statement_line_id) REFERENCES banking.statement_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES payment.settlements(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE INDEX banking_reconciliation_exceptions_open_idx ON banking.reconciliation_exceptions(tenant_id, legal_entity_id, severity, opened_at) WHERE status IN ('open','investigating','reopened');

CREATE TABLE banking.reconciliation_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','completed','completed_with_exceptions','failed','cancelled')),
  source_line_count bigint NOT NULL DEFAULT 0 CHECK (source_line_count >= 0),
  matched_line_count bigint NOT NULL DEFAULT 0 CHECK (matched_line_count >= 0),
  exception_count bigint NOT NULL DEFAULT 0 CHECK (exception_count >= 0),
  statement_total_minor bigint NOT NULL DEFAULT 0,
  matched_total_minor bigint NOT NULL DEFAULT 0,
  difference_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CHECK (period_end >= period_start),
  CHECK (matched_line_count <= source_line_count),
  CHECK (difference_minor = statement_total_minor - matched_total_minor),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES banking.bank_accounts(tenant_id, id)
);

CREATE OR REPLACE FUNCTION banking.protect_statement_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.bank_account_id IS DISTINCT FROM NEW.bank_account_id OR OLD.statement_import_id IS DISTINCT FROM NEW.statement_import_id OR OLD.line_number IS DISTINCT FROM NEW.line_number OR OLD.external_id IS DISTINCT FROM NEW.external_id OR OLD.fingerprint IS DISTINCT FROM NEW.fingerprint OR OLD.booked_at IS DISTINCT FROM NEW.booked_at OR OLD.value_date IS DISTINCT FROM NEW.value_date OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.scale IS DISTINCT FROM NEW.scale OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor OR OLD.running_balance_minor IS DISTINCT FROM NEW.running_balance_minor OR OLD.reference IS DISTINCT FROM NEW.reference OR OLD.counterparty_name IS DISTINCT FROM NEW.counterparty_name OR OLD.counterparty_reference IS DISTINCT FROM NEW.counterparty_reference OR OLD.raw_metadata IS DISTINCT FROM NEW.raw_metadata OR OLD.imported_at IS DISTINCT FROM NEW.imported_at THEN
    RAISE EXCEPTION 'bank statement content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER banking_statement_content_immutable BEFORE UPDATE ON banking.statement_lines FOR EACH ROW EXECUTE FUNCTION banking.protect_statement_content();
CREATE TRIGGER banking_statement_delete_forbidden BEFORE DELETE ON banking.statement_lines FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER banking_reconciliations_append_only BEFORE UPDATE OR DELETE ON banking.reconciliations FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER banking_reconciliation_rules_append_only BEFORE UPDATE OR DELETE ON banking.reconciliation_rules FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE VIEW banking.unreconciled_statement_lines_v AS
SELECT sl.tenant_id, ba.legal_entity_id, sl.bank_account_id, sl.id AS statement_line_id,
       sl.booked_at, sl.value_date, sl.currency, sl.scale, sl.amount_minor, sl.reference,
       sl.counterparty_name, sl.reconciliation_status, sl.imported_at,
       COALESCE(sum(r.matched_amount_minor), 0)::bigint AS matched_minor,
       (sl.amount_minor - COALESCE(sum(r.matched_amount_minor), 0))::bigint AS unmatched_minor,
       max(r.matched_at) AS last_matched_at
FROM banking.statement_lines sl
JOIN banking.bank_accounts ba ON ba.tenant_id = sl.tenant_id AND ba.id = sl.bank_account_id
LEFT JOIN banking.reconciliations r ON r.tenant_id = sl.tenant_id AND r.statement_line_id = sl.id
GROUP BY sl.tenant_id, ba.legal_entity_id, sl.bank_account_id, sl.id, sl.booked_at, sl.value_date, sl.currency, sl.scale, sl.amount_minor, sl.reference, sl.counterparty_name, sl.reconciliation_status, sl.imported_at;

CREATE OR REPLACE VIEW banking.settlement_bank_reconciliation_v AS
SELECT s.tenant_id, s.legal_entity_id, s.id AS settlement_id, s.provider_settlement_id,
       s.currency, s.scale, s.net_minor AS settlement_net_minor,
       COALESCE(sum(r.matched_amount_minor), 0)::bigint AS bank_matched_minor,
       (s.net_minor - COALESCE(sum(r.matched_amount_minor), 0))::bigint AS difference_minor,
       s.status AS settlement_status, max(r.matched_at) AS last_matched_at
FROM payment.settlements s
LEFT JOIN banking.reconciliations r ON r.tenant_id = s.tenant_id AND r.candidate_type = 'settlement' AND r.candidate_id = s.id::text
GROUP BY s.tenant_id, s.legal_entity_id, s.id, s.provider_settlement_id, s.currency, s.scale, s.net_minor, s.status;

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['bank_accounts','statement_imports','statement_lines','reconciliation_rules','reconciliations','reconciliation_exceptions','reconciliation_runs'] LOOP
    EXECUTE format('ALTER TABLE banking.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE banking.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON banking.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('banking.read','banking','Read bank accounts, statement lines and reconciliation state','sensitive'),
  ('banking.account.manage','banking','Manage bank account references and ledger mappings','privileged'),
  ('banking.statement.import','banking','Import bank statements','privileged'),
  ('banking.reconcile.auto','banking','Run automatic bank reconciliation','sensitive'),
  ('banking.reconcile.manual','banking','Create or reverse a manual reconciliation','privileged'),
  ('banking.exception.resolve','banking','Resolve reconciliation exceptions','privileged'),
  ('banking.reports.read','banking','Read bank and settlement reconciliation reports','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA banking TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA banking TO store_app_runtime, store_app_reporting;
GRANT SELECT ON banking.unreconciled_statement_lines_v, banking.settlement_bank_reconciliation_v TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA banking FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA banking GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('BNK-0001','MOD-E-BANKING','manifest:BNK-0001-banking-reconciliation.sql');

COMMIT;
