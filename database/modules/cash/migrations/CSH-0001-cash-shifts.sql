BEGIN;

CREATE TABLE cash.shifts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  register_id uuid NOT NULL,
  register_session_id uuid NOT NULL,
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  opened_at timestamptz NOT NULL,
  business_date date NOT NULL,
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed','reopened_for_adjustment')),
  closed_by uuid NULL REFERENCES platform.users(id),
  closed_at timestamptz NULL,
  approved_by uuid NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, register_session_id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, register_session_id) REFERENCES pos.register_sessions(tenant_id, id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX cash_shifts_one_open_idx ON cash.shifts(tenant_id, register_id)
  WHERE status IN ('open','closing','reopened_for_adjustment');

CREATE TABLE cash.cash_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  shift_id uuid NOT NULL,
  register_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'opening_float','cash_sale','cash_refund','paid_in','paid_out','safe_drop','adjustment_in','adjustment_out'
  )),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  source_type text NOT NULL,
  source_reference text NOT NULL,
  source_operation_id text NOT NULL,
  request_hash text NOT NULL,
  reason text NULL,
  approval_request_id uuid NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, shift_id, source_operation_id),
  UNIQUE (tenant_id, shift_id, sequence),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash.shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);
CREATE INDEX cash_events_shift_order_idx ON cash.cash_events(tenant_id, shift_id, sequence);

CREATE TABLE cash.shift_counts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  shift_id uuid NOT NULL,
  count_type text NOT NULL CHECK (count_type IN ('blind_close','recount','approved_adjustment')),
  currency char(3) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  counted_minor bigint NOT NULL CHECK (counted_minor >= 0),
  expected_minor bigint NOT NULL,
  variance_minor bigint NOT NULL,
  denomination_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  counted_by uuid NOT NULL REFERENCES platform.users(id),
  counted_at timestamptz NOT NULL,
  approved_by uuid NULL REFERENCES platform.users(id),
  approval_request_id uuid NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, shift_id, count_type, counted_at),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES cash.shifts(tenant_id, id),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id),
  CHECK (variance_minor = counted_minor - expected_minor),
  CHECK (variance_minor = 0 OR approved_by IS NOT NULL OR approval_request_id IS NOT NULL)
);

CREATE VIEW cash.shift_expected_cash AS
SELECT
  tenant_id,
  shift_id,
  currency,
  scale,
  COALESCE(SUM(
    CASE
      WHEN event_type IN ('opening_float','cash_sale','paid_in','adjustment_in') THEN amount_minor
      ELSE -amount_minor
    END
  ), 0)::bigint AS expected_minor,
  COUNT(*)::bigint AS event_count
FROM cash.cash_events
GROUP BY tenant_id, shift_id, currency, scale;

CREATE TRIGGER cash_events_append_only BEFORE UPDATE OR DELETE ON cash.cash_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER shift_counts_append_only BEFORE UPDATE OR DELETE ON cash.shift_counts
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION cash.protect_shift_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.register_id IS DISTINCT FROM NEW.register_id
    OR OLD.register_session_id IS DISTINCT FROM NEW.register_session_id
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.scale IS DISTINCT FROM NEW.scale
    OR OLD.opened_at IS DISTINCT FROM NEW.opened_at
    OR OLD.opened_by IS DISTINCT FROM NEW.opened_by
  THEN
    RAISE EXCEPTION 'cash shift identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'closed' AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.closed_at IS DISTINCT FROM NEW.closed_at
    OR OLD.closed_by IS DISTINCT FROM NEW.closed_by
  ) THEN
    RAISE EXCEPTION 'closed cash shift requires an explicit adjustment workflow' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_shift_identity_immutable BEFORE UPDATE ON cash.shifts
  FOR EACH ROW EXECUTE FUNCTION cash.protect_shift_identity();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['shifts','cash_events','shift_counts'] LOOP
    EXECUTE format('ALTER TABLE cash.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE cash.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON cash.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('cash.shift.open','cash','Open a register cash shift','privileged'),
  ('cash.shift.close','cash','Blind count and close a register cash shift','privileged'),
  ('cash.event.record','cash','Record cash sale, refund, paid-in, paid-out or safe-drop events','privileged'),
  ('cash.variance.approve','cash','Approve a cash variance or controlled adjustment','privileged'),
  ('cash.reconciliation.read','cash','Read cash shift reconstruction and reconciliation evidence','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA cash TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA cash TO store_app_runtime, store_app_reporting;
GRANT SELECT ON cash.shift_expected_cash TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cash FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA cash GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0001','MOD-D-CASH','manifest:CSH-0001-cash-shifts.sql');

COMMIT;
