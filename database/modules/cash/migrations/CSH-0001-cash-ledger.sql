BEGIN;

CREATE SCHEMA IF NOT EXISTS cash;

CREATE TABLE cash.shifts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  pos_session_id uuid NOT NULL,
  business_date date NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed','reopened')),
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid NULL REFERENCES platform.users(id),
  closed_at timestamptz NULL,
  approval_request_id uuid NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pos_session_id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, pos_session_id) REFERENCES pos.register_sessions(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id),
  CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR status <> 'closed')
);
CREATE UNIQUE INDEX cash_shifts_open_unique
  ON cash.shifts(tenant_id, register_id)
  WHERE status IN ('open','closing');

CREATE TABLE cash.cash_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'opening_float','cash_sale','cash_refund','paid_in','paid_out',
    'safe_drop','adjustment_in','adjustment_out'
  )),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  source_type text NOT NULL,
  source_id text NOT NULL,
  reversal_of_event_id uuid NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  reason text NULL,
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, shift_id, idempotency_key),
  UNIQUE (tenant_id, shift_id, sequence),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash.shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_event_id) REFERENCES cash.cash_events(tenant_id, id)
);
CREATE INDEX cash_events_shift_idx
  ON cash.cash_events(tenant_id, shift_id, occurred_at, sequence);

CREATE TABLE cash.cash_counts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  count_type text NOT NULL CHECK (count_type IN ('blind_close','recount','audit')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  counted_minor bigint NOT NULL CHECK (counted_minor >= 0),
  denomination_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  counted_by uuid NOT NULL REFERENCES platform.users(id),
  counted_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash.shifts(tenant_id, id)
);
CREATE INDEX cash_counts_shift_idx
  ON cash.cash_counts(tenant_id, shift_id, counted_at, id);

CREATE TABLE cash.shift_closures (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  cash_count_id uuid NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  expected_minor bigint NOT NULL,
  counted_minor bigint NOT NULL,
  variance_minor bigint NOT NULL,
  approval_request_id uuid NULL,
  closed_by uuid NOT NULL REFERENCES platform.users(id),
  closed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, shift_id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash.shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, cash_count_id) REFERENCES cash.cash_counts(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id),
  CHECK (variance_minor = counted_minor - expected_minor),
  CHECK (variance_minor = 0 OR approval_request_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION cash.cash_event_effect(p_event_type text, p_amount_minor bigint)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN p_event_type IN ('opening_float','cash_sale','paid_in','adjustment_in') THEN p_amount_minor
    ELSE -p_amount_minor
  END
$$;

CREATE OR REPLACE FUNCTION cash.protect_shift_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.register_id IS DISTINCT FROM NEW.register_id
     OR OLD.pos_session_id IS DISTINCT FROM NEW.pos_session_id
     OR OLD.business_date IS DISTINCT FROM NEW.business_date
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.scale IS DISTINCT FROM NEW.scale
     OR OLD.opened_by IS DISTINCT FROM NEW.opened_by
     OR OLD.opened_at IS DISTINCT FROM NEW.opened_at THEN
    RAISE EXCEPTION 'cash shift identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'closed' AND
     (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.closed_by IS DISTINCT FROM NEW.closed_by
      OR OLD.closed_at IS DISTINCT FROM NEW.closed_at
      OR OLD.approval_request_id IS DISTINCT FROM NEW.approval_request_id) THEN
    RAISE EXCEPTION 'closed cash shift requires an explicit reopen workflow' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_shift_identity_immutable
  BEFORE UPDATE ON cash.shifts
  FOR EACH ROW EXECUTE FUNCTION cash.protect_shift_identity();

CREATE TRIGGER cash_events_append_only
  BEFORE UPDATE OR DELETE ON cash.cash_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER cash_counts_append_only
  BEFORE UPDATE OR DELETE ON cash.cash_counts
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER shift_closures_append_only
  BEFORE UPDATE OR DELETE ON cash.shift_closures
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['shifts','cash_events','cash_counts','shift_closures'] LOOP
    EXECUTE format('ALTER TABLE cash.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE cash.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON cash.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('cash.shift.read','cash','Read shifts, counts, variances and append-only cash events','sensitive'),
  ('cash.shift.open','cash','Open a register cash shift with an approved float','privileged'),
  ('cash.event.append','cash','Append cash sale, refund, paid-in, paid-out and safe-drop events','privileged'),
  ('cash.shift.close','cash','Perform blind count and close a cash shift','privileged'),
  ('cash.variance.approve','cash','Approve a non-zero cash variance','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA cash TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA cash TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cash FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA cash GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0001','MOD-D-CASH','manifest:CSH-0001-cash-ledger.sql');

COMMIT;
