BEGIN;

CREATE SCHEMA IF NOT EXISTS customer;
COMMENT ON SCHEMA customer IS 'MOD-C customer profiles, identity, consent and credit controls';

CREATE TABLE IF NOT EXISTS customer.customers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NULL,
  customer_kind text NOT NULL CHECK (customer_kind IN ('person','company')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  person_data jsonb NULL,
  company_data jsonb NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','merged')),
  merged_into_id uuid NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  CHECK ((customer_kind = 'person' AND company_data IS NULL) OR (customer_kind = 'company' AND person_data IS NULL)),
  CHECK ((status = 'merged' AND merged_into_id IS NOT NULL) OR (status <> 'merged' AND merged_into_id IS NULL)),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES customer.customers(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS customer.external_identities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  source_system text NOT NULL CHECK (char_length(source_system) BETWEEN 1 AND 80),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  CONSTRAINT customer_external_identity_unique UNIQUE (tenant_id, source_system, external_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS customer.contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  contact_type text NOT NULL CHECK (contact_type IN ('email','phone','mobile','website')),
  contact_value text NOT NULL CHECK (char_length(contact_value) BETWEEN 1 AND 320),
  normalized_value text NOT NULL CHECK (char_length(normalized_value) BETWEEN 1 AND 320),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, customer_id, contact_type, normalized_value),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_contacts_normalized_idx ON customer.contacts(tenant_id, contact_type, normalized_value, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_one_primary_contact_idx ON customer.contacts(tenant_id, customer_id, contact_type) WHERE is_primary;

CREATE TABLE IF NOT EXISTS customer.addresses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  address_type text NOT NULL CHECK (address_type IN ('billing','shipping','home','office','other')),
  line1 text NOT NULL CHECK (char_length(line1) BETWEEN 1 AND 240),
  line2 text NULL,
  city text NOT NULL CHECK (char_length(city) BETWEEN 1 AND 120),
  region text NULL,
  postal_code text NULL,
  country_code char(2) NOT NULL CHECK (country_code = upper(country_code)),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_addresses_lookup_idx ON customer.addresses(tenant_id, customer_id, address_type, country_code);
CREATE UNIQUE INDEX IF NOT EXISTS customer_one_primary_address_idx ON customer.addresses(tenant_id, customer_id, address_type) WHERE is_primary;

CREATE TABLE IF NOT EXISTS customer.tags (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  tag text NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 80 AND tag = lower(tag)),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  PRIMARY KEY (tenant_id, customer_id, tag),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_tags_reverse_idx ON customer.tags(tenant_id, tag, customer_id);

CREATE TABLE IF NOT EXISTS customer.groups (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  group_code text NOT NULL CHECK (char_length(group_code) BETWEEN 1 AND 80 AND group_code = lower(group_code)),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  PRIMARY KEY (tenant_id, customer_id, group_code),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_groups_reverse_idx ON customer.groups(tenant_id, group_code, customer_id);

CREATE TABLE IF NOT EXISTS customer.tax_registrations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  country_code char(2) NOT NULL CHECK (country_code = upper(country_code)),
  registration_type text NOT NULL CHECK (char_length(registration_type) BETWEEN 1 AND 40),
  registration_number text NOT NULL CHECK (char_length(registration_number) BETWEEN 1 AND 120),
  valid_from date NULL,
  valid_to date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, country_code, registration_type, registration_number),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS customer_tax_registration_customer_idx ON customer.tax_registrations(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS customer.consent_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  channel text NOT NULL CHECK (char_length(channel) BETWEEN 1 AND 40),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 120),
  granted boolean NOT NULL,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 80),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_consent_current_idx ON customer.consent_events(tenant_id, customer_id, channel, purpose, recorded_at DESC);

CREATE TABLE IF NOT EXISTS customer.credit_profiles (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  limit_minor bigint NOT NULL DEFAULT 0 CHECK (limit_minor >= 0),
  balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hold','closed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, customer_id, legal_entity_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_credit_exposure_idx ON customer.credit_profiles(tenant_id, legal_entity_id, status, customer_id);

CREATE TABLE IF NOT EXISTS customer.credit_approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  source_document_type text NOT NULL,
  source_document_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  excess_minor bigint NOT NULL CHECK (excess_minor >= 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
  approved_by uuid NOT NULL REFERENCES platform.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer.customers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS customer_credit_approval_source_idx ON customer.credit_approvals(tenant_id, source_document_type, source_document_id);

CREATE TABLE IF NOT EXISTS customer.merge_history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  survivor_customer_id uuid NOT NULL,
  duplicate_customer_id uuid NOT NULL,
  survivor_version_before bigint NOT NULL CHECK (survivor_version_before > 0),
  duplicate_version_before bigint NOT NULL CHECK (duplicate_version_before > 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
  merged_by uuid NOT NULL REFERENCES platform.users(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  business_date date NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, duplicate_customer_id),
  FOREIGN KEY (tenant_id, survivor_customer_id) REFERENCES customer.customers(tenant_id, id),
  FOREIGN KEY (tenant_id, duplicate_customer_id) REFERENCES customer.customers(tenant_id, id),
  CHECK (survivor_customer_id <> duplicate_customer_id)
);
CREATE INDEX IF NOT EXISTS customer_merge_survivor_idx ON customer.merge_history(tenant_id, survivor_customer_id, merged_at DESC);

CREATE OR REPLACE FUNCTION customer.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS customer_consent_events_append_only ON customer.consent_events;
CREATE TRIGGER customer_consent_events_append_only
  BEFORE UPDATE OR DELETE ON customer.consent_events
  FOR EACH ROW EXECUTE FUNCTION customer.reject_history_mutation();
DROP TRIGGER IF EXISTS customer_credit_approvals_append_only ON customer.credit_approvals;
CREATE TRIGGER customer_credit_approvals_append_only
  BEFORE UPDATE OR DELETE ON customer.credit_approvals
  FOR EACH ROW EXECUTE FUNCTION customer.reject_history_mutation();
DROP TRIGGER IF EXISTS customer_merge_history_append_only ON customer.merge_history;
CREATE TRIGGER customer_merge_history_append_only
  BEFORE UPDATE OR DELETE ON customer.merge_history
  FOR EACH ROW EXECUTE FUNCTION customer.reject_history_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers','external_identities','contacts','addresses','tags','groups','tax_registrations',
    'consent_events','credit_profiles','credit_approvals','merge_history'
  ] LOOP
    EXECUTE format('ALTER TABLE customer.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE customer.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON customer.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON customer.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('customer.profile.create','customer','Create customer profiles','standard'),
  ('customer.profile.read','customer','Read customer profiles and identity history','standard'),
  ('customer.profile.update','customer','Update customer profiles, contacts, addresses and consent','sensitive'),
  ('customer.profile.merge','customer','Merge duplicate customers while preserving historical identities','privileged'),
  ('customer.credit.manage','customer','Manage customer credit limits, terms and holds','privileged'),
  ('customer.credit.approve','customer','Approve customer credit-limit exceptions','privileged'),
  ('customer.import','customer','Import customer profiles from approved sources','sensitive'),
  ('customer.export','customer','Export customer profiles and operational identity data','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA customer TO store_app_runtime, store_app_reporting;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA customer TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA customer TO store_app_reporting;
REVOKE DELETE ON ALL TABLES IN SCHEMA customer FROM store_app_runtime;
REVOKE UPDATE ON customer.consent_events, customer.credit_approvals, customer.merge_history FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA customer GRANT SELECT, INSERT, UPDATE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA customer GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CUS-0001','MOD-C-CUSTOMER','manifest:CUS-0001-customer.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
