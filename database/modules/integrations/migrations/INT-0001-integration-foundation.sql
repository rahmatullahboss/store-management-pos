BEGIN;

CREATE TABLE integration.api_clients (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  display_name text NOT NULL,
  authentication text NOT NULL CHECK (authentication IN ('api_key','oauth2_client_credentials')),
  credential_reference text NOT NULL,
  scopes text[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  rate_limit_per_minute integer NOT NULL CHECK (rate_limit_per_minute > 0),
  expires_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  CHECK (cardinality(scopes) > 0),
  CHECK (btrim(credential_reference) <> '')
);

CREATE TABLE integration.webhook_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  endpoint_url text NOT NULL,
  event_types text[] NOT NULL,
  signing_key_reference text NOT NULL,
  signature_version text NOT NULL DEFAULT 'hmac-sha256-v1',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  CHECK (endpoint_url ~ '^https://'),
  CHECK (cardinality(event_types) > 0),
  CHECK (btrim(signing_key_reference) <> '')
);

CREATE TABLE integration.webhook_deliveries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  source_event_id text NOT NULL,
  source_event_type text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  signature_version text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivering','delivered','retry_wait','dead_letter','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NULL,
  delivered_at timestamptz NULL,
  last_response_code integer NULL,
  last_error_category text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, subscription_id, source_event_id),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES integration.webhook_subscriptions(tenant_id, id),
  CHECK (btrim(payload_hash) <> '')
);
CREATE INDEX webhook_deliveries_queue_idx
  ON integration.webhook_deliveries(tenant_id, status, next_attempt_at, created_at, id)
  WHERE status IN ('queued','retry_wait','delivering');

CREATE TABLE integration.webhook_delivery_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  request_hash text NOT NULL,
  response_code integer NULL,
  outcome text NOT NULL CHECK (outcome IN ('delivered','retry','dead_letter','network_error','timeout','cancelled')),
  error_category text NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, delivery_id, attempt_number),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES integration.webhook_deliveries(tenant_id, id)
);

CREATE TABLE integration.webhook_replay_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, delivery_id, idempotency_key),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES integration.webhook_deliveries(tenant_id, id),
  CHECK (btrim(reason) <> '')
);

CREATE TABLE integration.connector_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  connector_type text NOT NULL,
  provider_key text NOT NULL,
  display_name text NOT NULL,
  credential_reference text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','degraded','paused','revoked')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_healthy_at timestamptz NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_key, display_name),
  CHECK (btrim(credential_reference) <> '')
);

CREATE TABLE integration.connector_field_mappings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  resource_type text NOT NULL,
  platform_field text NOT NULL,
  external_field text NOT NULL,
  ownership text NOT NULL CHECK (ownership IN ('platform','external','manual')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  transform_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connection_id, resource_type, direction, platform_field, external_field),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES integration.connector_connections(tenant_id, id),
  CHECK ((ownership <> 'platform' OR direction = 'outbound') AND (ownership <> 'external' OR direction = 'inbound'))
);

CREATE TABLE integration.connector_cursors (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  resource_type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  cursor text NOT NULL,
  last_external_id text NULL,
  last_event_id text NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connection_id, resource_type, direction),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES integration.connector_connections(tenant_id, id),
  CHECK (btrim(cursor) <> '')
);

CREATE TABLE integration.connector_sync_outcomes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  resource_type text NOT NULL,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','duplicate','conflict','rejected','deferred')),
  platform_reference text NULL,
  external_reference text NULL,
  reason_code text NULL,
  observed_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, connection_id, operation_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES integration.connector_connections(tenant_id, id)
);
CREATE INDEX connector_sync_outcomes_status_idx
  ON integration.connector_sync_outcomes(tenant_id, connection_id, status, observed_at, id);

CREATE TRIGGER webhook_delivery_attempts_append_only
  BEFORE UPDATE OR DELETE ON integration.webhook_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER webhook_replay_requests_append_only
  BEFORE UPDATE OR DELETE ON integration.webhook_replay_requests
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER connector_sync_outcomes_append_only
  BEFORE UPDATE OR DELETE ON integration.connector_sync_outcomes
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'api_clients','webhook_subscriptions','webhook_deliveries','webhook_delivery_attempts',
    'webhook_replay_requests','connector_connections','connector_field_mappings',
    'connector_cursors','connector_sync_outcomes'
  ] LOOP
    EXECUTE format('ALTER TABLE integration.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE integration.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON integration.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('integration.api_client.read','integration','Read API clients and scopes without credential material','sensitive'),
  ('integration.api_client.manage','integration','Create, suspend and revoke external API clients','privileged'),
  ('integration.webhook.read','integration','Read webhook subscriptions, delivery state and DLQ evidence','sensitive'),
  ('integration.webhook.manage','integration','Manage webhook subscriptions, retries and replay','privileged'),
  ('integration.connector.read','integration','Read connector configuration, mappings and health','sensitive'),
  ('integration.connector.manage','integration','Manage connector credentials, mappings, cursors and recovery','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA integration TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA integration TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integration FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA integration GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0001','MOD-G-INTEGRATION','manifest:INT-0001-integration-foundation.sql');

COMMIT;
