BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE accounting.charts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  base_currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id)
);

CREATE TABLE accounting.accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  chart_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense','contra_asset','contra_liability','contra_revenue','contra_expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  control_type text NULL CHECK (control_type IN ('accounts_receivable','accounts_payable','bank','cash','inventory','tax_payable','tax_receivable','payment_clearing','settlement_clearing','retained_earnings')),
  parent_account_id uuid NULL,
  allow_manual_posting boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  effective_from date NOT NULL,
  effective_until date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, chart_id, code),
  FOREIGN KEY (tenant_id, chart_id) REFERENCES accounting.charts(tenant_id, id),
  FOREIGN KEY (tenant_id, parent_account_id) REFERENCES accounting.accounts(tenant_id, id)
);
CREATE UNIQUE INDEX accounting_accounts_control_unique ON accounting.accounts(tenant_id, chart_id, control_type) WHERE control_type IS NOT NULL;

CREATE TABLE accounting.fiscal_periods (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  code text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','soft_closed','closed')),
  closed_at timestamptz NULL,
  closed_by uuid NULL REFERENCES platform.users(id),
  close_approval_request_id uuid NULL,
  reopened_at timestamptz NULL,
  reopened_by uuid NULL REFERENCES platform.users(id),
  reopen_approval_request_id uuid NULL,
  close_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (end_date >= start_date),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, code),
  EXCLUDE USING gist (tenant_id WITH =, legal_entity_id WITH =, daterange(start_date, end_date, '[]') WITH &&),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, close_approval_request_id) REFERENCES platform.approval_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, reopen_approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);

CREATE TABLE accounting.posting_rule_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  rule_code text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  source_event_type text NOT NULL,
  rule_definition jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  approved_by uuid NULL REFERENCES platform.users(id),
  approval_request_id uuid NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, rule_code, version_number),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE UNIQUE INDEX accounting_posting_rule_active_unique ON accounting.posting_rule_versions(tenant_id, legal_entity_id, rule_code) WHERE status = 'active' AND effective_until IS NULL;

CREATE TABLE accounting.posting_groups (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_version text NOT NULL,
  business_date date NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, source_type, source_id, source_version),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id)
);

CREATE TABLE accounting.journal_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  chart_id uuid NOT NULL,
  fiscal_period_id uuid NOT NULL,
  posting_group_id uuid NOT NULL,
  posting_rule_version_id uuid NULL,
  journal_type text NOT NULL CHECK (journal_type IN ('system','manual','adjustment','reversal','opening','closing','revaluation')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_version text NOT NULL,
  transaction_currency char(3) NOT NULL,
  transaction_scale smallint NOT NULL CHECK (transaction_scale BETWEEN 0 AND 12),
  base_currency char(3) NOT NULL,
  base_scale smallint NOT NULL CHECK (base_scale BETWEEN 0 AND 12),
  total_debit_minor bigint NOT NULL CHECK (total_debit_minor > 0),
  total_credit_minor bigint NOT NULL CHECK (total_credit_minor > 0),
  total_base_debit_minor bigint NOT NULL CHECK (total_base_debit_minor > 0),
  total_base_credit_minor bigint NOT NULL CHECK (total_base_credit_minor > 0),
  exchange_rate_numerator bigint NOT NULL DEFAULT 1 CHECK (exchange_rate_numerator > 0),
  exchange_rate_denominator bigint NOT NULL DEFAULT 1 CHECK (exchange_rate_denominator > 0),
  posting_kind text NOT NULL DEFAULT 'ordinary' CHECK (posting_kind IN ('ordinary','adjustment','reversal')),
  reversal_of_journal_id uuid NULL,
  correction_reason text NULL,
  approval_request_id uuid NULL,
  business_date date NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  CHECK (total_debit_minor = total_credit_minor),
  CHECK (total_base_debit_minor = total_base_credit_minor),
  CHECK ((posting_kind = 'ordinary' AND approval_request_id IS NULL) OR posting_kind IN ('adjustment','reversal')),
  CHECK ((posting_kind <> 'reversal' AND reversal_of_journal_id IS NULL) OR (posting_kind = 'reversal' AND reversal_of_journal_id IS NOT NULL AND correction_reason IS NOT NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, posting_group_id, journal_type, source_type, source_id, source_version),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, chart_id) REFERENCES accounting.charts(tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_period_id) REFERENCES accounting.fiscal_periods(tenant_id, id),
  FOREIGN KEY (tenant_id, posting_group_id) REFERENCES accounting.posting_groups(tenant_id, id),
  FOREIGN KEY (tenant_id, posting_rule_version_id) REFERENCES accounting.posting_rule_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_journal_id) REFERENCES accounting.journal_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE INDEX accounting_journal_entries_source_idx ON accounting.journal_entries(tenant_id, source_type, source_id);
CREATE INDEX accounting_journal_entries_period_idx ON accounting.journal_entries(tenant_id, legal_entity_id, fiscal_period_id, business_date, posted_at);

CREATE TABLE accounting.journal_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  account_id uuid NOT NULL,
  transaction_debit_minor bigint NOT NULL DEFAULT 0 CHECK (transaction_debit_minor >= 0),
  transaction_credit_minor bigint NOT NULL DEFAULT 0 CHECK (transaction_credit_minor >= 0),
  base_debit_minor bigint NOT NULL DEFAULT 0 CHECK (base_debit_minor >= 0),
  base_credit_minor bigint NOT NULL DEFAULT 0 CHECK (base_credit_minor >= 0),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  party_type text NULL CHECK (party_type IN ('customer','supplier','employee','tax_authority','payment_provider','bank','other')),
  party_id text NULL,
  source_line_id text NULL,
  memo text NULL,
  CHECK ((transaction_debit_minor > 0 AND transaction_credit_minor = 0) OR (transaction_credit_minor > 0 AND transaction_debit_minor = 0)),
  CHECK ((base_debit_minor > 0 AND base_credit_minor = 0) OR (base_credit_minor > 0 AND base_debit_minor = 0)),
  CHECK ((party_type IS NULL AND party_id IS NULL) OR (party_type IS NOT NULL AND party_id IS NOT NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, journal_entry_id, line_number),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES accounting.journal_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES accounting.accounts(tenant_id, id)
);
CREATE INDEX accounting_journal_lines_account_idx ON accounting.journal_lines(tenant_id, account_id, journal_entry_id);
CREATE INDEX accounting_journal_lines_party_idx ON accounting.journal_lines(tenant_id, party_type, party_id) WHERE party_id IS NOT NULL;
CREATE INDEX accounting_journal_lines_dimensions_gin ON accounting.journal_lines USING gin(dimensions);

CREATE TABLE accounting.open_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  control_account_id uuid NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id text NOT NULL,
  document_type text NOT NULL,
  document_id text NOT NULL,
  document_version text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  original_minor bigint NOT NULL CHECK (original_minor > 0),
  direction text NOT NULL CHECK (direction IN ('receivable','payable')),
  due_date date NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_allocated','settled','written_off','reversed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  journal_entry_id uuid NOT NULL,
  reversal_of_open_item_id uuid NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, document_type, document_id, document_version, direction),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, control_account_id) REFERENCES accounting.accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES accounting.journal_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_open_item_id) REFERENCES accounting.open_items(tenant_id, id)
);
CREATE INDEX accounting_open_items_party_idx ON accounting.open_items(tenant_id, party_type, party_id, status, due_date);

CREATE TABLE accounting.open_item_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  open_item_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  journal_entry_id uuid NOT NULL,
  reversal_of_allocation_id uuid NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  reason text NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, open_item_id, source_type, source_id, journal_entry_id),
  FOREIGN KEY (tenant_id, open_item_id) REFERENCES accounting.open_items(tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES accounting.journal_entries(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_allocation_id) REFERENCES accounting.open_item_allocations(tenant_id, id)
);

CREATE TABLE accounting.period_close_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  fiscal_period_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','checking','blocked','approved','closed','failed','reopened')),
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  control_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  approval_request_id uuid NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_period_id) REFERENCES accounting.fiscal_periods(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);

CREATE OR REPLACE FUNCTION accounting.assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_journal_id uuid := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  v_line_count bigint;
  v_debit bigint;
  v_credit bigint;
  v_base_debit bigint;
  v_base_credit bigint;
  v_entry accounting.journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM accounting.journal_entries WHERE tenant_id = v_tenant_id AND id = v_journal_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), COALESCE(sum(transaction_debit_minor), 0), COALESCE(sum(transaction_credit_minor), 0), COALESCE(sum(base_debit_minor), 0), COALESCE(sum(base_credit_minor), 0)
  INTO v_line_count, v_debit, v_credit, v_base_debit, v_base_credit
  FROM accounting.journal_lines WHERE tenant_id = v_tenant_id AND journal_entry_id = v_journal_id;
  IF v_line_count < 2 THEN RAISE EXCEPTION 'posted journal requires at least two lines' USING ERRCODE = '23514'; END IF;
  IF v_debit <> v_credit OR v_base_debit <> v_base_credit THEN RAISE EXCEPTION 'posted journal is not balanced' USING ERRCODE = '23514'; END IF;
  IF v_entry.total_debit_minor <> v_debit OR v_entry.total_credit_minor <> v_credit OR v_entry.total_base_debit_minor <> v_base_debit OR v_entry.total_base_credit_minor <> v_base_credit THEN
    RAISE EXCEPTION 'journal header totals do not match line totals' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accounting_journal_balance_deferred
AFTER INSERT OR UPDATE OR DELETE ON accounting.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION accounting.assert_journal_balanced();

CREATE OR REPLACE FUNCTION accounting.protect_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'posted journals are immutable; create a reversal or adjustment' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER accounting_journal_entries_append_only BEFORE UPDATE OR DELETE ON accounting.journal_entries FOR EACH ROW EXECUTE FUNCTION accounting.protect_posted_journal();
CREATE TRIGGER accounting_journal_lines_append_only BEFORE UPDATE OR DELETE ON accounting.journal_lines FOR EACH ROW EXECUTE FUNCTION accounting.protect_posted_journal();
CREATE TRIGGER accounting_posting_rules_append_only BEFORE UPDATE OR DELETE ON accounting.posting_rule_versions FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER accounting_open_items_append_only BEFORE UPDATE OR DELETE ON accounting.open_items FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER accounting_open_item_allocations_append_only BEFORE UPDATE OR DELETE ON accounting.open_item_allocations FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE VIEW accounting.trial_balance_v AS
SELECT je.tenant_id, je.legal_entity_id, je.chart_id, je.fiscal_period_id, jl.account_id,
       je.base_currency AS currency, je.base_scale AS scale,
       sum(jl.base_debit_minor)::bigint AS debit_minor,
       sum(jl.base_credit_minor)::bigint AS credit_minor,
       (sum(jl.base_debit_minor) - sum(jl.base_credit_minor))::bigint AS balance_minor,
       count(DISTINCT je.id)::bigint AS journal_count,
       max(je.posted_at) AS refreshed_at
FROM accounting.journal_entries je
JOIN accounting.journal_lines jl ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
GROUP BY je.tenant_id, je.legal_entity_id, je.chart_id, je.fiscal_period_id, jl.account_id, je.base_currency, je.base_scale;

CREATE OR REPLACE VIEW accounting.general_ledger_v AS
SELECT je.tenant_id, je.legal_entity_id, je.business_date, je.posted_at, je.id AS journal_entry_id,
       je.posting_group_id, je.source_type, je.source_id, je.source_version,
       jl.line_number, jl.account_id, a.code AS account_code, a.display_name AS account_name,
       je.transaction_currency, je.transaction_scale, jl.transaction_debit_minor, jl.transaction_credit_minor,
       je.base_currency, je.base_scale, jl.base_debit_minor, jl.base_credit_minor,
       jl.dimensions, jl.party_type, jl.party_id, jl.source_line_id, jl.memo
FROM accounting.journal_entries je
JOIN accounting.journal_lines jl ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
JOIN accounting.accounts a ON a.tenant_id = jl.tenant_id AND a.id = jl.account_id;

CREATE OR REPLACE VIEW accounting.open_item_balances_v AS
SELECT oi.tenant_id, oi.legal_entity_id, oi.id AS open_item_id, oi.party_type, oi.party_id,
       oi.document_type, oi.document_id, oi.currency, oi.scale, oi.original_minor,
       COALESCE(sum(oia.amount_minor), 0)::bigint AS allocated_minor,
       (oi.original_minor - COALESCE(sum(oia.amount_minor), 0))::bigint AS outstanding_minor,
       oi.due_date, oi.status, oi.business_date, max(oia.allocated_at) AS last_allocation_at
FROM accounting.open_items oi
LEFT JOIN accounting.open_item_allocations oia ON oia.tenant_id = oi.tenant_id AND oia.open_item_id = oi.id
GROUP BY oi.tenant_id, oi.legal_entity_id, oi.id, oi.party_type, oi.party_id, oi.document_type, oi.document_id, oi.currency, oi.scale, oi.original_minor, oi.due_date, oi.status, oi.business_date;

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['charts','accounts','fiscal_periods','posting_rule_versions','posting_groups','journal_entries','journal_lines','open_items','open_item_allocations','period_close_runs'] LOOP
    EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON accounting.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', table_name);
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('accounting.read','accounting','Read chart, journal, subledger and financial report data','sensitive'),
  ('accounting.chart.manage','accounting','Manage chart of accounts and posting mappings','privileged'),
  ('accounting.journal.post','accounting','Post system journals through approved posting rules','privileged'),
  ('accounting.journal.manual','accounting','Create a manual journal with reason and approval','privileged'),
  ('accounting.journal.reverse','accounting','Reverse a posted journal','privileged'),
  ('accounting.open_item.allocate','accounting','Allocate receivable or payable open items','privileged'),
  ('accounting.period.close','accounting','Run and approve fiscal period close','privileged'),
  ('accounting.period.reopen','accounting','Reopen a closed period with approval','privileged'),
  ('accounting.reports.read','accounting','Read general ledger and financial statements','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA accounting TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA accounting TO store_app_runtime, store_app_reporting;
GRANT SELECT ON accounting.trial_balance_v, accounting.general_ledger_v, accounting.open_item_balances_v TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA accounting FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA accounting GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('ACC-0001','MOD-E-ACCOUNTING','manifest:ACC-0001-accounting-core.sql');

COMMIT;
