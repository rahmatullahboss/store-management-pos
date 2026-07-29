BEGIN;

CREATE TABLE platform.saas_plan_definitions (
  id uuid PRIMARY KEY,
  plan_id text NOT NULL,
  version text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','retired')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL,
  published_by uuid NOT NULL REFERENCES platform.users(id),
  published_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  UNIQUE (plan_id, version),
  UNIQUE (idempotency_key),
  CHECK (plan_id ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  CHECK (btrim(version) <> '' AND btrim(display_name) <> ''),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (btrim(request_hash) <> '')
);

CREATE TABLE platform.saas_plan_entitlements (
  id uuid PRIMARY KEY,
  plan_definition_id uuid NOT NULL REFERENCES platform.saas_plan_definitions(id),
  entitlement_code text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('boolean','integer','string')),
  entitlement_value text NOT NULL,
  enforcement text NOT NULL CHECK (enforcement IN ('hard','soft','observe')),
  reset_period text NULL CHECK (reset_period IS NULL OR reset_period IN ('day','month','year')),
  UNIQUE (plan_definition_id, entitlement_code),
  CHECK (entitlement_code ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  CHECK (btrim(entitlement_value) <> '')
);

CREATE TABLE platform.tenant_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_definition_id uuid NOT NULL REFERENCES platform.saas_plan_definitions(id),
  status text NOT NULL CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  started_at timestamptz NOT NULL,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  suspended_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (current_period_end > current_period_start),
  CHECK (started_at <= current_period_start),
  CHECK (btrim(request_hash) <> '')
);

CREATE TABLE platform.tenant_subscription_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN ('assign','activate','mark_past_due','suspend','resume','cancel','change_plan')),
  prior_status text NULL CHECK (prior_status IS NULL OR prior_status IN ('trial','active','past_due','suspended','cancelled')),
  new_status text NOT NULL CHECK (new_status IN ('trial','active','past_due','suspended','cancelled')),
  prior_plan_definition_id uuid NULL,
  new_plan_definition_id uuid NOT NULL REFERENCES platform.saas_plan_definitions(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES platform.tenant_subscriptions(tenant_id, id),
  CHECK (btrim(request_hash) <> '' AND btrim(request_id) <> '' AND btrim(trace_id) <> '')
);

CREATE TABLE platform.usage_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  meter_code text NOT NULL,
  quantity numeric(78,0) NOT NULL CHECK (quantity >= 0),
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, subscription_id, meter_code, source_type, source_id, source_version),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES platform.tenant_subscriptions(tenant_id, id),
  CHECK (meter_code ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  CHECK (period_end > period_start),
  CHECK (occurred_at >= period_start AND occurred_at < period_end),
  CHECK (btrim(source_type) <> '' AND btrim(source_id) <> '' AND btrim(source_version) <> ''),
  CHECK (btrim(request_hash) <> '' AND btrim(request_id) <> '' AND btrim(trace_id) <> '')
);

CREATE TABLE platform.usage_counters (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  meter_code text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  quantity numeric(78,0) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  last_usage_event_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, subscription_id, meter_code, period_start, period_end),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES platform.tenant_subscriptions(tenant_id, id),
  FOREIGN KEY (tenant_id, last_usage_event_id) REFERENCES platform.usage_events(tenant_id, id),
  CHECK (period_end > period_start)
);

CREATE TABLE platform.tenant_lifecycle_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  operation text NOT NULL CHECK (operation IN ('provision','suspend','resume','offboard','export')),
  status text NOT NULL CHECK (status IN ('queued','running','review','completed','failed','cancelled')),
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (btrim(reason) <> '' AND btrim(request_hash) <> ''),
  CHECK (started_at IS NULL OR started_at >= requested_at),
  CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);

CREATE TABLE platform.tenant_lifecycle_job_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  prior_status text NULL CHECK (prior_status IS NULL OR prior_status IN ('queued','running','review','completed','failed','cancelled')),
  new_status text NOT NULL CHECK (new_status IN ('queued','running','review','completed','failed','cancelled')),
  reason_code text NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, job_id) REFERENCES platform.tenant_lifecycle_jobs(tenant_id, id)
);

CREATE TABLE platform.support_impersonation_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  support_actor_id uuid NOT NULL REFERENCES platform.users(id),
  approved_by uuid NOT NULL REFERENCES platform.users(id),
  reason text NOT NULL,
  scopes text[] NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (support_actor_id <> approved_by),
  CHECK (cardinality(scopes) > 0),
  CHECK (expires_at > issued_at),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
  CHECK (btrim(reason) <> '' AND btrim(request_hash) <> '')
);

CREATE TABLE platform.support_impersonation_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('issued','revoked','used')),
  support_actor_id uuid NOT NULL REFERENCES platform.users(id),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES platform.support_impersonation_grants(tenant_id, id)
);

CREATE TABLE platform.feature_rollouts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  feature_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned','enabled','paused','disabled')),
  rollout_percentage smallint NOT NULL CHECK (rollout_percentage BETWEEN 0 AND 100),
  reason text NOT NULL,
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, feature_code),
  CHECK (feature_code ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  CHECK (btrim(reason) <> '')
);

CREATE TABLE platform.feature_rollout_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  rollout_id uuid NOT NULL,
  prior_status text NULL CHECK (prior_status IS NULL OR prior_status IN ('planned','enabled','paused','disabled')),
  new_status text NOT NULL CHECK (new_status IN ('planned','enabled','paused','disabled')),
  prior_percentage smallint NULL,
  new_percentage smallint NOT NULL CHECK (new_percentage BETWEEN 0 AND 100),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, rollout_id) REFERENCES platform.feature_rollouts(tenant_id, id)
);

CREATE TABLE platform.support_incidents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  incident_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL CHECK (status IN ('open','investigating','monitoring','resolved','closed')),
  summary text NOT NULL,
  opened_by uuid NOT NULL REFERENCES platform.users(id),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, incident_code),
  CHECK (incident_code ~ '^[A-Z][A-Z0-9-]{2,63}$'),
  CHECK (btrim(summary) <> ''),
  CHECK (resolved_at IS NULL OR resolved_at >= opened_at)
);

CREATE TABLE platform.support_incident_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  prior_status text NULL CHECK (prior_status IS NULL OR prior_status IN ('open','investigating','monitoring','resolved','closed')),
  new_status text NOT NULL CHECK (new_status IN ('open','investigating','monitoring','resolved','closed')),
  note text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES platform.support_incidents(tenant_id, id),
  CHECK (btrim(note) <> '')
);

CREATE TRIGGER saas_plan_definitions_append_only
  BEFORE UPDATE OR DELETE ON platform.saas_plan_definitions
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER saas_plan_entitlements_append_only
  BEFORE UPDATE OR DELETE ON platform.saas_plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER tenant_subscription_events_append_only
  BEFORE UPDATE OR DELETE ON platform.tenant_subscription_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER usage_events_append_only
  BEFORE UPDATE OR DELETE ON platform.usage_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER tenant_lifecycle_job_events_append_only
  BEFORE UPDATE OR DELETE ON platform.tenant_lifecycle_job_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER support_impersonation_events_append_only
  BEFORE UPDATE OR DELETE ON platform.support_impersonation_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER feature_rollout_events_append_only
  BEFORE UPDATE OR DELETE ON platform.feature_rollout_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER support_incident_events_append_only
  BEFORE UPDATE OR DELETE ON platform.support_incident_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_subscriptions','tenant_subscription_events','usage_events','usage_counters',
    'tenant_lifecycle_jobs','tenant_lifecycle_job_events','support_impersonation_grants',
    'support_impersonation_events','feature_rollouts','feature_rollout_events',
    'support_incidents','support_incident_events'
  ] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON platform.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('saas.plan.read','saas-admin','Read versioned SaaS plans and entitlements','sensitive'),
  ('saas.plan.manage','saas-admin','Publish versioned SaaS plans and entitlements','privileged'),
  ('saas.subscription.read','saas-admin','Read tenant subscription and lifecycle state','sensitive'),
  ('saas.subscription.manage','saas-admin','Assign plans and transition tenant subscriptions','privileged'),
  ('saas.usage.read','saas-admin','Read exact usage meters and counters','sensitive'),
  ('saas.usage.record','saas-admin','Record idempotent exact usage events','privileged'),
  ('saas.lifecycle.manage','saas-admin','Run tenant provisioning suspension resume offboarding and export jobs','privileged'),
  ('saas.support.impersonate','saas-admin','Issue revoke and use independently approved support impersonation','privileged'),
  ('saas.rollout.manage','saas-admin','Manage tenant feature rollout state','privileged'),
  ('saas.incident.manage','saas-admin','Manage tenant support incidents','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT SELECT ON platform.saas_plan_definitions, platform.saas_plan_entitlements TO store_app_runtime, store_app_reporting;
GRANT SELECT ON platform.tenant_subscriptions, platform.tenant_subscription_events,
  platform.usage_events, platform.usage_counters, platform.tenant_lifecycle_jobs,
  platform.tenant_lifecycle_job_events, platform.support_impersonation_grants,
  platform.support_impersonation_events, platform.feature_rollouts,
  platform.feature_rollout_events, platform.support_incidents,
  platform.support_incident_events TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON platform.saas_plan_definitions, platform.saas_plan_entitlements,
  platform.tenant_subscriptions, platform.tenant_subscription_events,
  platform.usage_events, platform.usage_counters, platform.tenant_lifecycle_jobs,
  platform.tenant_lifecycle_job_events, platform.support_impersonation_grants,
  platform.support_impersonation_events, platform.feature_rollouts,
  platform.feature_rollout_events, platform.support_incidents,
  platform.support_incident_events FROM store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0005','MOD-G-INTEGRATION','manifest:INT-0005-saas-platform-foundation.sql');

COMMIT;
