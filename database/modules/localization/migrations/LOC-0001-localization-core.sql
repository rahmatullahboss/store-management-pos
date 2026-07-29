BEGIN;

CREATE TABLE localization.country_pack_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  pack_id text NOT NULL,
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  version text NOT NULL,
  support_level text NOT NULL CHECK (support_level IN ('experimental','limited','validated')),
  effective_from date NOT NULL,
  effective_to date NULL,
  default_locale text NOT NULL,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^(sha256:)?[a-f0-9]{64}$'),
  signature text NOT NULL,
  signing_key_id text NOT NULL,
  published_at timestamptz NOT NULL,
  published_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_id, version),
  CHECK (btrim(pack_id) <> '' AND btrim(version) <> '' AND btrim(default_locale) <> ''),
  CHECK (btrim(signature) <> '' AND btrim(signing_key_id) <> ''),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE localization.locale_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  pack_version_id uuid NOT NULL,
  locale text NOT NULL,
  fallback_locales text[] NOT NULL DEFAULT '{}',
  direction text NOT NULL CHECK (direction IN ('ltr','rtl')),
  numbering_system text NULL,
  calendar text NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_version_id, locale),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.country_pack_versions(tenant_id, id),
  CHECK (btrim(locale) <> '')
);

CREATE TABLE localization.currency_metadata (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  pack_version_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  accounting_scale smallint NOT NULL CHECK (accounting_scale BETWEEN 0 AND 12),
  cash_increment_minor bigint NOT NULL CHECK (cash_increment_minor > 0),
  cash_rounding_mode text NOT NULL CHECK (cash_rounding_mode IN ('nearest','up','down')),
  effective_from date NOT NULL,
  effective_to date NULL,
  metadata_version text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_version_id, currency, metadata_version),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.country_pack_versions(tenant_id, id),
  CHECK (btrim(metadata_version) <> ''),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE localization.business_day_boundaries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  pack_version_id uuid NOT NULL,
  time_zone text NOT NULL,
  local_start_time time NOT NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  boundary_version text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_version_id, time_zone, boundary_version),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.country_pack_versions(tenant_id, id),
  CHECK (btrim(time_zone) <> '' AND btrim(boundary_version) <> ''),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE localization.country_pack_activations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  pack_version_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','revoked')),
  previous_activation_id uuid NULL,
  approved_by uuid NOT NULL REFERENCES platform.users(id),
  reason text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.country_pack_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, previous_activation_id) REFERENCES localization.country_pack_activations(tenant_id, id),
  CHECK (btrim(reason) <> '' AND btrim(idempotency_key) <> '' AND btrim(request_hash) <> ''),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX country_pack_active_scope_unique ON localization.country_pack_activations(
  tenant_id, legal_entity_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE status = 'active';

CREATE TABLE localization.legal_number_scopes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  document_type text NOT NULL CHECK (document_type IN ('receipt','invoice','credit_note','debit_note','delivery_note')),
  fiscal_year text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  suffix text NOT NULL DEFAULT '',
  minimum_value numeric(40,0) NOT NULL CHECK (minimum_value >= 0),
  maximum_value numeric(40,0) NOT NULL CHECK (maximum_value >= minimum_value),
  next_value numeric(40,0) NOT NULL CHECK (next_value >= minimum_value),
  width smallint NOT NULL CHECK (width BETWEEN 1 AND 40),
  effective_from date NOT NULL,
  effective_to date NULL,
  offline_allocation_allowed boolean NOT NULL DEFAULT false,
  sequence_version text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','closed')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  CHECK (btrim(fiscal_year) <> '' AND btrim(sequence_version) <> ''),
  CHECK (next_value <= maximum_value + 1),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX legal_number_scope_identity_unique ON localization.legal_number_scopes(
  tenant_id, legal_entity_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
  document_type, fiscal_year, sequence_version
);

CREATE TABLE localization.legal_number_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  operation_id text NOT NULL,
  numeric_value numeric(40,0) NOT NULL CHECK (numeric_value >= 0),
  legal_number text NOT NULL,
  allocation_mode text NOT NULL CHECK (allocation_mode IN ('online','offline_block')),
  device_id text NULL,
  allocated_by uuid NOT NULL REFERENCES platform.users(id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scope_id, operation_id),
  UNIQUE (tenant_id, scope_id, numeric_value),
  UNIQUE (tenant_id, legal_number),
  FOREIGN KEY (tenant_id, scope_id) REFERENCES localization.legal_number_scopes(tenant_id, id),
  CHECK (btrim(operation_id) <> '' AND btrim(legal_number) <> ''),
  CHECK (allocation_mode <> 'offline_block' OR device_id IS NOT NULL)
);

CREATE TABLE localization.legal_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  document_type text NOT NULL CHECK (document_type IN ('receipt','invoice','credit_note','debit_note','delivery_note')),
  legal_number text NOT NULL,
  business_date date NOT NULL,
  issued_at timestamptz NOT NULL,
  pack_version_id uuid NOT NULL,
  template_id text NOT NULL,
  template_version text NOT NULL,
  tax_rule_version text NOT NULL,
  currency_metadata_version text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_version text NOT NULL,
  totals jsonb NOT NULL CHECK (jsonb_typeof(totals) = 'object'),
  semantic_payload_hash text NOT NULL CHECK (semantic_payload_hash ~ '^(sha256:)?[a-f0-9]{64}$'),
  rendered_document_hash text NOT NULL CHECK (rendered_document_hash ~ '^(sha256:)?[a-f0-9]{64}$'),
  archive_object_key text NOT NULL,
  fiscal_status text NOT NULL CHECK (fiscal_status IN ('not_required','pending','accepted','rejected','unknown','corrected')),
  correction_of_document_id uuid NULL,
  issued_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_number),
  UNIQUE (tenant_id, source_type, source_id, source_version, document_type),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.country_pack_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, correction_of_document_id) REFERENCES localization.legal_documents(tenant_id, id),
  CHECK (btrim(template_id) <> '' AND btrim(template_version) <> ''),
  CHECK (btrim(tax_rule_version) <> '' AND btrim(currency_metadata_version) <> ''),
  CHECK (btrim(source_type) <> '' AND btrim(source_id) <> '' AND btrim(source_version) <> ''),
  CHECK (btrim(archive_object_key) <> '')
);

CREATE TABLE localization.fiscal_submissions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  provider_capability_id text NOT NULL,
  country_pack_version text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^(sha256:)?[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','unknown','corrected')),
  provider_reference text NULL,
  submitted_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, document_id, provider_capability_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES localization.legal_documents(tenant_id, id),
  CHECK (btrim(provider_capability_id) <> '' AND btrim(country_pack_version) <> ''),
  CHECK (btrim(idempotency_key) <> '' AND btrim(request_hash) <> '')
);

CREATE TABLE localization.fiscal_submission_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  fiscal_submission_id uuid NOT NULL,
  prior_status text NULL,
  new_status text NOT NULL CHECK (new_status IN ('pending','accepted','rejected','unknown','corrected')),
  provider_reference text NULL,
  rejection_code text NULL,
  observed_at timestamptz NOT NULL,
  actor_id uuid NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_submission_id) REFERENCES localization.fiscal_submissions(tenant_id, id)
);

CREATE TABLE localization.retention_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  policy_id text NOT NULL,
  policy_version text NOT NULL,
  data_category text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days >= 0),
  legal_basis text NOT NULL,
  immutable_evidence_required boolean NOT NULL,
  anonymization_allowed boolean NOT NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, policy_id, policy_version),
  CHECK (btrim(policy_id) <> '' AND btrim(policy_version) <> ''),
  CHECK (btrim(data_category) <> '' AND btrim(legal_basis) <> ''),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE localization.privacy_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  subject_reference text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('access','export','correct','anonymize','erase','restrict')),
  retention_policy_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','running','completed','partially_completed','rejected')),
  preserved_evidence_references text[] NOT NULL DEFAULT '{}',
  affected_resource_references text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, retention_policy_id) REFERENCES localization.retention_policies(tenant_id, id),
  CHECK (btrim(subject_reference) <> '' AND btrim(reason) <> ''),
  CHECK (btrim(idempotency_key) <> '' AND btrim(request_hash) <> '')
);

CREATE TRIGGER country_pack_versions_append_only BEFORE UPDATE OR DELETE ON localization.country_pack_versions FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER locale_profiles_append_only BEFORE UPDATE OR DELETE ON localization.locale_profiles FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER currency_metadata_append_only BEFORE UPDATE OR DELETE ON localization.currency_metadata FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER business_day_boundaries_append_only BEFORE UPDATE OR DELETE ON localization.business_day_boundaries FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER legal_number_allocations_append_only BEFORE UPDATE OR DELETE ON localization.legal_number_allocations FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER legal_documents_append_only BEFORE UPDATE OR DELETE ON localization.legal_documents FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER fiscal_submission_events_append_only BEFORE UPDATE OR DELETE ON localization.fiscal_submission_events FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
CREATE TRIGGER retention_policies_append_only BEFORE UPDATE OR DELETE ON localization.retention_policies FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'country_pack_versions','locale_profiles','currency_metadata','business_day_boundaries',
    'country_pack_activations','legal_number_scopes','legal_number_allocations',
    'legal_documents','fiscal_submissions','fiscal_submission_events',
    'retention_policies','privacy_operations'
  ] LOOP
    EXECUTE format('ALTER TABLE localization.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE localization.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON localization.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('localization.pack.read','localization','Read country-pack versions and locale metadata','sensitive'),
  ('localization.pack.activate','localization','Activate an effective country-pack version','privileged'),
  ('localization.number.allocate','localization','Allocate collision-free legal document numbers','privileged'),
  ('localization.document.publish','localization','Publish immutable legal-document snapshots','privileged'),
  ('localization.fiscal.submit','localization','Create and transition fiscal submissions','privileged'),
  ('localization.privacy.execute','localization','Execute approved privacy workflows','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA localization TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA localization TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA localization FROM store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA localization GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('LOC-0001','MOD-F-LOCALIZATION','manifest:LOC-0001-localization-core.sql');

COMMIT;
