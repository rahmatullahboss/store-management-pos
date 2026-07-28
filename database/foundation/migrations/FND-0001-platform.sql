BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS pricing;
CREATE SCHEMA IF NOT EXISTS tax;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS procurement;
CREATE SCHEMA IF NOT EXISTS customer;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS fulfillment;
CREATE SCHEMA IF NOT EXISTS pos;
CREATE SCHEMA IF NOT EXISTS cash;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS accounting;
CREATE SCHEMA IF NOT EXISTS banking;
CREATE SCHEMA IF NOT EXISTS localization;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS reporting;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'store_app_runtime') THEN CREATE ROLE store_app_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'store_app_reporting') THEN CREATE ROLE store_app_reporting NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'store_app_migrator') THEN CREATE ROLE store_app_migrator NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  migration_id text PRIMARY KEY,
  module text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
);

CREATE TABLE IF NOT EXISTS platform.module_ownership (
  module_id text PRIMARY KEY,
  postgres_schema text NOT NULL UNIQUE,
  git_path text NOT NULL UNIQUE,
  migration_prefix text NOT NULL UNIQUE,
  owner_workpack text NOT NULL,
  dependency_modules text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform.module_ownership(module_id, postgres_schema, git_path, migration_prefix, owner_workpack, dependency_modules) VALUES
  ('FOUNDATION','platform','database/foundation','FND','FOUNDATION','{}'),
  ('MOD-A-CATALOG','catalog','modules/catalog','CAT','MOD-A','{}'),
  ('MOD-A-PRICING','pricing','modules/pricing','PRC','MOD-A','{MOD-A-CATALOG}'),
  ('MOD-A-TAX','tax','modules/tax','TAX','MOD-A','{MOD-A-CATALOG}'),
  ('MOD-B-INVENTORY','inventory','modules/inventory','INV','MOD-B','{MOD-A-CATALOG}'),
  ('MOD-B-PROCUREMENT','procurement','modules/procurement','PUR','MOD-B','{MOD-A-CATALOG,MOD-B-INVENTORY}'),
  ('MOD-C-CUSTOMER','customer','modules/customer','CUS','MOD-C','{}'),
  ('MOD-C-SALES','sales','modules/sales','SAL','MOD-C','{MOD-A-CATALOG,MOD-A-PRICING,MOD-A-TAX,MOD-C-CUSTOMER}'),
  ('MOD-C-FULFILLMENT','fulfillment','modules/fulfillment','FUL','MOD-C','{MOD-B-INVENTORY,MOD-C-SALES}'),
  ('MOD-D-POS','pos','modules/pos','POS','MOD-D','{MOD-C-SALES}'),
  ('MOD-D-CASH','cash','modules/cash','CSH','MOD-D','{MOD-D-POS}'),
  ('MOD-E-PAYMENT','payment','modules/payments','PAY','MOD-E','{MOD-C-SALES}'),
  ('MOD-E-ACCOUNTING','accounting','modules/accounting','ACC','MOD-E','{MOD-B-INVENTORY,MOD-C-SALES,MOD-E-PAYMENT}'),
  ('MOD-E-BANKING','banking','modules/banking','BNK','MOD-E','{MOD-E-PAYMENT,MOD-E-ACCOUNTING}'),
  ('MOD-F-LOCALIZATION','localization','modules/localization','LOC','MOD-F','{}'),
  ('MOD-G-INTEGRATION','integration','modules/integrations','INT','MOD-G','{}'),
  ('MOD-G-REPORTING','reporting','modules/reporting','RPT','MOD-G','{}')
ON CONFLICT (module_id) DO UPDATE SET dependency_modules = EXCLUDED.dependency_modules;

CREATE TABLE IF NOT EXISTS platform.tenants (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{2,62}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  home_region text NOT NULL,
  status text NOT NULL CHECK (status IN ('provisioning','active','suspended','offboarding','deleted')),
  default_locale text NOT NULL,
  default_time_zone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS platform.legal_entities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  legal_name text NOT NULL,
  base_currency char(3) NOT NULL,
  country_code char(2) NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS platform.stores (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.warehouses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.registers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, store_id, code),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.users (
  id uuid PRIMARY KEY,
  identity_subject text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email_normalized text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique ON platform.users(email_normalized) WHERE email_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  user_id uuid NOT NULL REFERENCES platform.users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform.roles (
  id uuid PRIMARY KEY,
  tenant_id uuid NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  system_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.permissions (
  code text PRIMARY KEY,
  module text NOT NULL,
  description text NOT NULL,
  risk_level text NOT NULL DEFAULT 'standard' CHECK (risk_level IN ('standard','sensitive','privileged'))
);

CREATE TABLE IF NOT EXISTS platform.role_permissions (
  role_id uuid NOT NULL REFERENCES platform.roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES platform.permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS platform.membership_roles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  legal_entity_id uuid NULL,
  store_id uuid NULL,
  warehouse_id uuid NULL,
  register_id uuid NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid NULL REFERENCES platform.users(id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES platform.memberships(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES platform.roles(tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES platform.warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_roles_scope_unique ON platform.membership_roles (
  tenant_id, membership_id, role_id,
  COALESCE(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(register_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE IF NOT EXISTS platform.approval_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  action_code text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
  payload_hash text NOT NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.approval_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  approval_request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  action text NOT NULL CHECK (action IN ('approve','reject','cancel')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, approval_request_id) REFERENCES platform.approval_requests(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.devices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  device_type text NOT NULL CHECK (device_type IN ('browser','pos','mobile','integration','support')),
  display_name text NOT NULL,
  public_key text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','retired')),
  enrolled_by uuid NULL REFERENCES platform.users(id),
  enrolled_at timestamptz NULL,
  revoked_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform.register_device_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  register_id uuid NOT NULL,
  device_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  bound_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  FOREIGN KEY (tenant_id, register_id) REFERENCES platform.registers(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES platform.devices(tenant_id, id),
  UNIQUE (tenant_id, register_id, device_id)
);

CREATE TABLE IF NOT EXISTS platform.entitlements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  entitlement_key text NOT NULL,
  enabled boolean NOT NULL,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entitlement_key, valid_from)
);

CREATE TABLE IF NOT EXISTS platform.support_impersonation_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  support_actor_id uuid NOT NULL REFERENCES platform.users(id),
  target_user_id uuid NOT NULL REFERENCES platform.users(id),
  approved_by uuid NOT NULL REFERENCES platform.users(id),
  reason text NOT NULL,
  allowed_actions text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  CHECK (expires_at > started_at)
);

CREATE TABLE IF NOT EXISTS platform.audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  event_type text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  actor_id uuid NULL,
  approver_id uuid NULL,
  impersonator_id uuid NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  device_id uuid NULL,
  before_hash text NULL,
  after_hash text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  source_version text NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_occurred_idx ON platform.audit_events(tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS platform.idempotency_records (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  response_status integer NULL,
  response_json jsonb NULL,
  resource_type text NULL,
  resource_id text NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  PRIMARY KEY (tenant_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS platform.outbox_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  schema_version text NOT NULL,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  causation_id text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  published_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NULL,
  last_error text NULL,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON platform.outbox_events(next_attempt_at, occurred_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS platform.inbox_receipts (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  first_received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  last_error text NULL,
  PRIMARY KEY (tenant_id, consumer_name, event_id)
);

CREATE TABLE IF NOT EXISTS platform.dead_letter_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  source text NOT NULL,
  message_id text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  error_code text NOT NULL,
  error_message text NOT NULL,
  attempts integer NOT NULL,
  replay_status text NOT NULL DEFAULT 'pending' CHECK (replay_status IN ('pending','replayed','discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  replayed_at timestamptz NULL,
  UNIQUE (tenant_id, source, message_id)
);

CREATE TABLE IF NOT EXISTS platform.workflow_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  job_type text NOT NULL,
  correlation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','running','waiting','completed','failed','cancelled')),
  input jsonb NOT NULL,
  output jsonb NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, correlation_id)
);

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('platform.reference.create','platform','Create Foundation reference records','standard'),
  ('platform.reference.read','platform','Read Foundation reference records','standard'),
  ('platform.audit.read','platform','Read tenant audit history','sensitive'),
  ('platform.access.manage','platform','Manage memberships, roles and permissions','privileged'),
  ('platform.device.read','platform','Read enrolled device state','standard'),
  ('platform.register.use','platform','Operate an assigned register','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT store_app_runtime, store_app_reporting, store_app_migrator TO CURRENT_USER;
GRANT USAGE ON SCHEMA platform TO store_app_runtime, store_app_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO store_app_reporting;
REVOKE UPDATE, DELETE ON platform.audit_events FROM store_app_runtime;
REVOKE DELETE ON platform.outbox_events, platform.inbox_receipts, platform.idempotency_records FROM store_app_runtime;
REVOKE INSERT, UPDATE, DELETE ON platform.schema_migrations, platform.module_ownership, platform.permissions, platform.role_permissions FROM store_app_runtime;
REVOKE INSERT, UPDATE, DELETE ON platform.users FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum) VALUES ('FND-0001','FOUNDATION','manifest:FND-0001-platform.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
