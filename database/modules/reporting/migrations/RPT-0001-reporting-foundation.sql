BEGIN;

CREATE TABLE reporting.metric_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  metric_id text NOT NULL,
  version text NOT NULL,
  owner_module text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL,
  value_kind text NOT NULL CHECK (value_kind IN ('money','quantity','count','ratio','duration')),
  formula text NOT NULL,
  supported_dimensions text[] NOT NULL DEFAULT '{}',
  source_event_types text[] NOT NULL,
  control_total_metric_id text NULL,
  freshness_seconds integer NOT NULL CHECK (freshness_seconds > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL,
  published_by uuid NOT NULL REFERENCES platform.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, metric_id, version),
  CHECK (btrim(metric_id) <> '' AND btrim(version) <> ''),
  CHECK (cardinality(source_event_types) > 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE reporting.projection_cursors (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  projection_name text NOT NULL,
  source_stream text NOT NULL,
  high_water_sequence numeric(78,0) NOT NULL DEFAULT 0 CHECK (high_water_sequence >= 0),
  last_event_id text NULL,
  last_occurred_at timestamptz NULL,
  status text NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','stale','rebuilding','degraded','failed')),
  rebuilt_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, projection_name, source_stream),
  CHECK (btrim(projection_name) <> '' AND btrim(source_stream) <> '')
);

CREATE TABLE reporting.projection_event_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  projection_name text NOT NULL,
  source_event_id text NOT NULL,
  source_event_type text NOT NULL,
  source_sequence numeric(78,0) NOT NULL CHECK (source_sequence > 0),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload_hash text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('applied','duplicate','rejected','review')),
  reason_code text NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz NULL,
  business_date date NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, projection_name, source_event_id),
  CHECK (btrim(payload_hash) <> '')
);
CREATE INDEX projection_event_receipts_cursor_idx
  ON reporting.projection_event_receipts(tenant_id, projection_name, source_sequence, id);

CREATE TABLE reporting.metric_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  metric_definition_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  time_zone text NOT NULL,
  currency char(3) NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  unit text NOT NULL,
  amount numeric(78,0) NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  dimensions_hash text NOT NULL,
  source_count numeric(78,0) NOT NULL CHECK (source_count >= 0),
  source_cursor text NOT NULL,
  freshness_observed_at timestamptz NOT NULL,
  freshness_seconds integer NOT NULL CHECK (freshness_seconds >= 0),
  health text NOT NULL CHECK (health IN ('fresh','stale','rebuilding','degraded','failed')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, metric_definition_id, period_start, period_end, dimensions_hash, source_cursor),
  FOREIGN KEY (tenant_id, metric_definition_id) REFERENCES reporting.metric_definitions(tenant_id, id),
  CHECK (period_end > period_start),
  CHECK (btrim(unit) <> '' AND btrim(source_cursor) <> '')
);
CREATE INDEX metric_snapshots_query_idx
  ON reporting.metric_snapshots(tenant_id, metric_definition_id, period_end DESC, generated_at DESC);

CREATE TABLE reporting.projection_reconciliations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  metric_definition_id uuid NOT NULL,
  metric_snapshot_id uuid NOT NULL,
  projected_amount numeric(78,0) NOT NULL,
  control_amount numeric(78,0) NOT NULL,
  difference_amount numeric(78,0) NOT NULL,
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 12),
  unit text NOT NULL,
  currency char(3) NULL,
  reconciled boolean NOT NULL,
  source_cursor text NOT NULL,
  checked_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, metric_definition_id) REFERENCES reporting.metric_definitions(tenant_id, id),
  FOREIGN KEY (tenant_id, metric_snapshot_id) REFERENCES reporting.metric_snapshots(tenant_id, id),
  CHECK (difference_amount = projected_amount - control_amount),
  CHECK (reconciled = (difference_amount = 0))
);

CREATE TABLE reporting.export_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  report_id text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','xlsx','pdf','json')),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','review','completed','failed','cancelled','expired')),
  object_reference text NULL,
  content_hash text NULL,
  row_count numeric(78,0) NULL CHECK (row_count IS NULL OR row_count >= 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  expires_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (expires_at > requested_at),
  CHECK (status <> 'completed' OR (object_reference IS NOT NULL AND content_hash IS NOT NULL))
);
CREATE INDEX export_requests_queue_idx
  ON reporting.export_requests(tenant_id, status, requested_at, id)
  WHERE status IN ('queued','running','review');

CREATE TABLE reporting.export_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  export_request_id uuid NOT NULL,
  prior_status text NULL,
  new_status text NOT NULL,
  reason_code text NULL,
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, export_request_id) REFERENCES reporting.export_requests(tenant_id, id)
);
CREATE INDEX export_events_request_idx
  ON reporting.export_events(tenant_id, export_request_id, observed_at, id);

CREATE TRIGGER metric_definitions_append_only
  BEFORE UPDATE OR DELETE ON reporting.metric_definitions
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER projection_event_receipts_append_only
  BEFORE UPDATE OR DELETE ON reporting.projection_event_receipts
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER metric_snapshots_append_only
  BEFORE UPDATE OR DELETE ON reporting.metric_snapshots
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER projection_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON reporting.projection_reconciliations
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER export_events_append_only
  BEFORE UPDATE OR DELETE ON reporting.export_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'metric_definitions','projection_cursors','projection_event_receipts',
    'metric_snapshots','projection_reconciliations','export_requests','export_events'
  ] LOOP
    EXECUTE format('ALTER TABLE reporting.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE reporting.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON reporting.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('reporting.metric.read','reporting','Read versioned metric definitions and snapshots','sensitive'),
  ('reporting.metric.publish','reporting','Publish a versioned metric definition','privileged'),
  ('reporting.projection.manage','reporting','Rebuild, reconcile and inspect reporting projections','privileged'),
  ('reporting.export.request','reporting','Request an asynchronous report export','sensitive'),
  ('reporting.export.manage','reporting','Review, cancel or expire report exports','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA reporting TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA reporting FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('RPT-0001','MOD-G-REPORTING','manifest:RPT-0001-reporting-foundation.sql');

COMMIT;
