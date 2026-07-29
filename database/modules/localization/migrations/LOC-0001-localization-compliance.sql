BEGIN;

CREATE SCHEMA IF NOT EXISTS localization;

CREATE TABLE IF NOT EXISTS localization.pack_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  pack_id text NOT NULL CHECK (pack_id ~ '^[a-z0-9][a-z0-9.-]{1,95}$'),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  version text NOT NULL,
  support_level text NOT NULL CHECK (support_level IN ('experimental','limited','validated')),
  effective_from date NOT NULL,
  effective_until date NULL,
  default_locale text NOT NULL,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  signature text NOT NULL,
  signing_key_id text NOT NULL,
  published_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS localization.locale_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  pack_version_id uuid NOT NULL,
  locale text NOT NULL,
  fallback_locales text[] NOT NULL DEFAULT '{}',
  direction text NOT NULL CHECK (direction IN ('ltr','rtl')),
  numbering_system text NULL,
  calendar text NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_version_id, locale),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.pack_versions(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS localization.currency_metadata (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  pack_version_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  accounting_scale integer NOT NULL CHECK (accounting_scale BETWEEN 0 AND 12),
  cash_increment_minor numeric(38,0) NOT NULL CHECK (cash_increment_minor > 0),
  cash_rounding_mode text NOT NULL CHECK (cash_rounding_mode IN ('nearest','up','down')),
  effective_from date NOT NULL,
  effective_until date NULL,
  metadata_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_version_id, currency, metadata_version),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.pack_versions(tenant_id, id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS localization.business_day_boundaries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  pack_version_id uuid NOT NULL,
  time_zone text NOT NULL,
  local_start_time time NOT NULL,
  effective_from date NOT NULL,
  effective_until date NULL,
  boundary_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pack_version_id, time_zone, boundary_version),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.pack_versions(tenant_id, id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS localization.pack_activations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  pack_version_id uuid NOT NULL,
  effective_from date NOT NULL,
  status text NOT NULL CHECK (status IN ('active','superseded','retired')),
  activated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz NULL,
  previous_activation_id uuid NULL,
  approved_by uuid NOT NULL REFERENCES platform.users(id),
  reason text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.pack_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, previous_activation_id) REFERENCES localization.pack_activations(tenant_id, id),
  CHECK ((status = 'active' AND deactivated_at IS NULL) OR status <> 'active')
);
CREATE UNIQUE INDEX IF NOT EXISTS localization_active_pack_scope_unique
  ON localization.pack_activations(
    tenant_id,
    legal_entity_id,
    COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS localization.numbering_scopes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  document_type text NOT NULL CHECK (document_type IN ('receipt','invoice','credit_note','debit_note','delivery_note')),
  fiscal_year text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  suffix text NOT NULL DEFAULT '',
  minimum_value numeric(38,0) NOT NULL CHECK (minimum_value >= 0),
  maximum_value numeric(38,0) NOT NULL,
  next_value numeric(38,0) NOT NULL,
  width integer NOT NULL CHECK (width BETWEEN 1 AND 38),
  effective_from date NOT NULL,
  effective_until date NULL,
  offline_allocation_allowed boolean NOT NULL DEFAULT false,
  sequence_version text NOT NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  CHECK (maximum_value >= minimum_value),
  CHECK (next_value BETWEEN minimum_value AND maximum_value + 1),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS localization_numbering_scope_identity_unique
  ON localization.numbering_scopes(
    tenant_id,
    legal_entity_id,
    COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    document_type,
    fiscal_year,
    sequence_version
  );

CREATE TABLE IF NOT EXISTS localization.number_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  scope_id uuid NOT NULL,
  operation_id text NOT NULL,
  numeric_value numeric(38,0) NOT NULL,
  legal_number text NOT NULL,
  allocation_mode text NOT NULL CHECK (allocation_mode IN ('online','offline_block')),
  device_id uuid NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scope_id, operation_id),
  UNIQUE (tenant_id, scope_id, numeric_value),
  UNIQUE (tenant_id, scope_id, legal_number),
  FOREIGN KEY (tenant_id, scope_id) REFERENCES localization.numbering_scopes(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS localization.legal_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_entity_id uuid NOT NULL,
  store_id uuid NULL,
  allocation_id uuid NOT NULL,
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
  totals jsonb NOT NULL,
  semantic_payload_hash text NOT NULL CHECK (semantic_payload_hash ~ '^[a-f0-9]{64}$'),
  rendered_document_hash text NOT NULL CHECK (rendered_document_hash ~ '^[a-f0-9]{64}$'),
  archive_object_key text NOT NULL,
  initial_fiscal_status text NOT NULL CHECK (initial_fiscal_status IN ('not_required','pending','accepted','rejected','unknown','corrected')),
  correction_of_document_id uuid NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, allocation_id),
  UNIQUE (tenant_id, legal_entity_id, document_type, legal_number),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES platform.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES platform.stores(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES localization.number_allocations(tenant_id, id),
  FOREIGN KEY (tenant_id, pack_version_id) REFERENCES localization.pack_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, correction_of_document_id) REFERENCES localization.legal_documents(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS localization_legal_documents_source_idx
  ON localization.legal_documents(tenant_id, source_type, source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS localization.fiscal_submission_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  document_id uuid NOT NULL,
  previous_event_id uuid NULL,
  provider_capability_id text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','accepted','rejected','unknown','corrected')),
  provider_reference text NULL,
  rejection_code text NULL,
  rejection_message text NULL,
  retry_after timestamptz NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, document_id) REFERENCES localization.legal_documents(tenant_id, id),
  FOREIGN KEY (tenant_id, previous_event_id) REFERENCES localization.fiscal_submission_events(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS localization_fiscal_document_idx
  ON localization.fiscal_submission_events(tenant_id, document_id, observed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS localization.retention_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  policy_code text NOT NULL,
  version text NOT NULL,
  data_category text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days >= 0),
  legal_basis text NOT NULL,
  immutable_evidence_required boolean NOT NULL,
  anonymization_allowed boolean NOT NULL,
  effective_from date NOT NULL,
  effective_until date NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, policy_code, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS localization.data_residency_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  policy_code text NOT NULL,
  version text NOT NULL,
  allowed_regions text[] NOT NULL,
  storage_providers text[] NOT NULL,
  processing_providers text[] NOT NULL,
  backup_regions text[] NOT NULL,
  cross_border_transfer_basis text NULL,
  effective_from date NOT NULL,
  effective_until date NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, policy_code, version),
  CHECK (cardinality(allowed_regions) > 0),
  CHECK (cardinality(storage_providers) > 0),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS localization.privacy_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  subject_reference text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('access','export','correct','anonymize','erase','restrict')),
  retention_policy_id uuid NOT NULL,
  retention_policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','approved','running','completed','partially_completed','rejected')),
  preserved_evidence_references text[] NOT NULL DEFAULT '{}',
  affected_resource_references text[] NOT NULL DEFAULT '{}',
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, retention_policy_id) REFERENCES localization.retention_policies(tenant_id, id),
  CHECK ((status IN ('completed','partially_completed') AND completed_at IS NOT NULL) OR status NOT IN ('completed','partially_completed'))
);

CREATE TABLE IF NOT EXISTS localization.privacy_operation_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  operation_id uuid NOT NULL,
  from_status text NULL,
  to_status text NOT NULL CHECK (to_status IN ('requested','approved','running','completed','partially_completed','rejected')),
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  reason text NOT NULL,
  preserved_evidence_references text[] NOT NULL DEFAULT '{}',
  affected_resource_references text[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES localization.privacy_operations(tenant_id, id)
);

CREATE OR REPLACE FUNCTION localization.reject_effective_date_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
  v_overlap boolean := false;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'pack_versions' THEN
      v_key := NEW.tenant_id::text || ':' || NEW.pack_id;
      PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || v_key, 0));
      SELECT EXISTS (
        SELECT 1 FROM localization.pack_versions p
        WHERE p.tenant_id = NEW.tenant_id AND p.pack_id = NEW.pack_id AND p.id <> NEW.id
          AND daterange(p.effective_from, p.effective_until, '[)') && daterange(NEW.effective_from, NEW.effective_until, '[)')
      ) INTO v_overlap;
    WHEN 'currency_metadata' THEN
      v_key := NEW.tenant_id::text || ':' || NEW.pack_version_id::text || ':' || NEW.currency::text;
      PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || v_key, 0));
      SELECT EXISTS (
        SELECT 1 FROM localization.currency_metadata c
        WHERE c.tenant_id = NEW.tenant_id AND c.pack_version_id = NEW.pack_version_id
          AND c.currency = NEW.currency AND c.id <> NEW.id
          AND daterange(c.effective_from, c.effective_until, '[)') && daterange(NEW.effective_from, NEW.effective_until, '[)')
      ) INTO v_overlap;
    WHEN 'business_day_boundaries' THEN
      v_key := NEW.tenant_id::text || ':' || NEW.pack_version_id::text || ':' || NEW.time_zone;
      PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || v_key, 0));
      SELECT EXISTS (
        SELECT 1 FROM localization.business_day_boundaries b
        WHERE b.tenant_id = NEW.tenant_id AND b.pack_version_id = NEW.pack_version_id
          AND b.time_zone = NEW.time_zone AND b.id <> NEW.id
          AND daterange(b.effective_from, b.effective_until, '[)') && daterange(NEW.effective_from, NEW.effective_until, '[)')
      ) INTO v_overlap;
    WHEN 'retention_policies' THEN
      v_key := NEW.tenant_id::text || ':' || NEW.policy_code;
      PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || v_key, 0));
      SELECT EXISTS (
        SELECT 1 FROM localization.retention_policies r
        WHERE r.tenant_id = NEW.tenant_id AND r.policy_code = NEW.policy_code AND r.id <> NEW.id
          AND daterange(r.effective_from, r.effective_until, '[)') && daterange(NEW.effective_from, NEW.effective_until, '[)')
      ) INTO v_overlap;
    WHEN 'data_residency_policies' THEN
      v_key := NEW.tenant_id::text || ':' || NEW.policy_code;
      PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || v_key, 0));
      SELECT EXISTS (
        SELECT 1 FROM localization.data_residency_policies r
        WHERE r.tenant_id = NEW.tenant_id AND r.policy_code = NEW.policy_code AND r.id <> NEW.id
          AND daterange(r.effective_from, r.effective_until, '[)') && daterange(NEW.effective_from, NEW.effective_until, '[)')
      ) INTO v_overlap;
    ELSE
      RAISE EXCEPTION 'unsupported effective-date table %', TG_TABLE_NAME USING ERRCODE = '0A000';
  END CASE;
  IF v_overlap THEN
    RAISE EXCEPTION 'effective-date range overlaps an existing % record', TG_TABLE_NAME USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;

DO $effective_date_guards$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pack_versions','currency_metadata','business_day_boundaries',
    'retention_policies','data_residency_policies'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS effective_date_no_overlap ON localization.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER effective_date_no_overlap BEFORE INSERT ON localization.%I FOR EACH ROW EXECUTE FUNCTION localization.reject_effective_date_overlap()',
      table_name
    );
  END LOOP;
END $effective_date_guards$;

CREATE OR REPLACE FUNCTION localization.protect_numbering_scope_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.legal_entity_id IS DISTINCT FROM NEW.legal_entity_id
     OR OLD.store_id IS DISTINCT FROM NEW.store_id
     OR OLD.document_type IS DISTINCT FROM NEW.document_type
     OR OLD.fiscal_year IS DISTINCT FROM NEW.fiscal_year
     OR OLD.prefix IS DISTINCT FROM NEW.prefix
     OR OLD.suffix IS DISTINCT FROM NEW.suffix
     OR OLD.minimum_value IS DISTINCT FROM NEW.minimum_value
     OR OLD.maximum_value IS DISTINCT FROM NEW.maximum_value
     OR OLD.width IS DISTINCT FROM NEW.width
     OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
     OR OLD.effective_until IS DISTINCT FROM NEW.effective_until
     OR OLD.offline_allocation_allowed IS DISTINCT FROM NEW.offline_allocation_allowed
     OR OLD.sequence_version IS DISTINCT FROM NEW.sequence_version
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'numbering scope identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.next_value < OLD.next_value THEN
    RAISE EXCEPTION 'numbering scope cannot move backwards' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS numbering_scope_identity_immutable ON localization.numbering_scopes;
CREATE TRIGGER numbering_scope_identity_immutable
BEFORE UPDATE ON localization.numbering_scopes
FOR EACH ROW EXECUTE FUNCTION localization.protect_numbering_scope_identity();

DO $append_only$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pack_versions','locale_profiles','currency_metadata','business_day_boundaries',
    'number_allocations','legal_documents','fiscal_submission_events','retention_policies',
    'data_residency_policies','privacy_operation_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON localization.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON localization.%I FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation()',
      table_name, table_name
    );
  END LOOP;
END $append_only$;

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pack_versions','locale_profiles','currency_metadata','business_day_boundaries',
    'pack_activations','numbering_scopes','number_allocations','legal_documents',
    'fiscal_submission_events','retention_policies','data_residency_policies',
    'privacy_operations','privacy_operation_events'
  ] LOOP
    EXECUTE format('ALTER TABLE localization.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE localization.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON localization.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON localization.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())',
      table_name
    );
  END LOOP;
END $rls$;

CREATE OR REPLACE FUNCTION localization.activate_country_pack_v1(
  p_activation_id uuid,
  p_pack_version_id uuid,
  p_legal_entity_id uuid,
  p_store_id uuid,
  p_effective_from date,
  p_reason text
) RETURNS TABLE(
  activation_id uuid,
  pack_version_id uuid,
  status text,
  effective_from date,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, localization AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_existing localization.pack_activations%ROWTYPE;
  v_previous_id uuid;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_activation_id IS NULL OR p_pack_version_id IS NULL OR p_legal_entity_id IS NULL
     OR p_effective_from IS NULL OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'activation identity, scope, date and reason are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM localization.pack_activations
  WHERE tenant_id = v_tenant_id AND id = p_activation_id;
  IF FOUND THEN
    IF v_existing.pack_version_id IS DISTINCT FROM p_pack_version_id
       OR v_existing.legal_entity_id IS DISTINCT FROM p_legal_entity_id
       OR v_existing.store_id IS DISTINCT FROM p_store_id
       OR v_existing.effective_from IS DISTINCT FROM p_effective_from THEN
      RAISE EXCEPTION 'activation identity payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.pack_version_id, v_existing.status, v_existing.effective_from, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM localization.pack_versions p
    JOIN platform.legal_entities e
      ON e.tenant_id = p.tenant_id AND e.id = p_legal_entity_id
    WHERE p.tenant_id = v_tenant_id AND p.id = p_pack_version_id
      AND e.status = 'active' AND e.country_code = p.country_code
      AND p.effective_from <= p_effective_from
      AND (p.effective_until IS NULL OR p.effective_until > p_effective_from)
  ) THEN
    RAISE EXCEPTION 'effective country pack must match an active legal entity country' USING ERRCODE = '23503';
  END IF;
  IF p_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.stores s
    WHERE s.tenant_id = v_tenant_id AND s.id = p_store_id
      AND s.legal_entity_id = p_legal_entity_id AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active store does not belong to legal entity' USING ERRCODE = '23503';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'localization.pack.activation:' || v_tenant_id::text || ':' || p_legal_entity_id::text || ':' || COALESCE(p_store_id::text, 'all'),
    0
  ));

  SELECT * INTO v_existing
  FROM localization.pack_activations
  WHERE tenant_id = v_tenant_id AND id = p_activation_id;
  IF FOUND THEN
    IF v_existing.pack_version_id IS DISTINCT FROM p_pack_version_id
       OR v_existing.legal_entity_id IS DISTINCT FROM p_legal_entity_id
       OR v_existing.store_id IS DISTINCT FROM p_store_id
       OR v_existing.effective_from IS DISTINCT FROM p_effective_from THEN
      RAISE EXCEPTION 'activation identity payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.pack_version_id, v_existing.status, v_existing.effective_from, true;
    RETURN;
  END IF;

  SELECT id INTO v_previous_id
  FROM localization.pack_activations
  WHERE tenant_id = v_tenant_id
    AND legal_entity_id = p_legal_entity_id
    AND store_id IS NOT DISTINCT FROM p_store_id
    AND status = 'active'
  FOR UPDATE;

  IF v_previous_id IS NOT NULL THEN
    UPDATE localization.pack_activations
       SET status = 'superseded', deactivated_at = now()
     WHERE tenant_id = v_tenant_id AND id = v_previous_id;
  END IF;

  INSERT INTO localization.pack_activations(
    id, tenant_id, legal_entity_id, store_id, pack_version_id, effective_from,
    status, previous_activation_id, approved_by, reason
  ) VALUES (
    p_activation_id, v_tenant_id, p_legal_entity_id, p_store_id, p_pack_version_id,
    p_effective_from, 'active', v_previous_id, v_actor_id, p_reason
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.pack.activated.v1',
    'localization.pack.manage', 'success', v_actor_id, 'localization.pack_activation',
    p_activation_id::text, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('packVersionId', p_pack_version_id, 'legalEntityId', p_legal_entity_id, 'storeId', p_store_id),
    v_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.pack.activated.v1',
    'localization.pack_activation', p_activation_id::text, '1.0',
    jsonb_build_object('activationId', p_activation_id, 'packVersionId', p_pack_version_id, 'effectiveFrom', p_effective_from),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_activation_id, p_pack_version_id, 'active'::text, p_effective_from, false;
END $$;

CREATE OR REPLACE FUNCTION localization.allocate_legal_number_v1(
  p_scope_id uuid,
  p_operation_id text,
  p_allocation_mode text DEFAULT 'online',
  p_device_id uuid DEFAULT NULL
) RETURNS TABLE(
  allocation_id uuid,
  numeric_value numeric,
  legal_number text,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, localization AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_scope localization.numbering_scopes%ROWTYPE;
  v_existing localization.number_allocations%ROWTYPE;
  v_allocation_id uuid := gen_random_uuid();
  v_value numeric(38,0);
  v_legal_number text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_scope_id IS NULL OR char_length(btrim(COALESCE(p_operation_id, ''))) < 8
     OR p_allocation_mode NOT IN ('online','offline_block') THEN
    RAISE EXCEPTION 'valid numbering scope, operation and allocation mode are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM localization.number_allocations
  WHERE tenant_id = v_tenant_id AND scope_id = p_scope_id AND operation_id = p_operation_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.numeric_value, v_existing.legal_number, true;
    RETURN;
  END IF;

  SELECT * INTO v_scope
  FROM localization.numbering_scopes
  WHERE tenant_id = v_tenant_id AND id = p_scope_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'numbering scope does not exist' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_existing
  FROM localization.number_allocations
  WHERE tenant_id = v_tenant_id AND scope_id = p_scope_id AND operation_id = p_operation_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.numeric_value, v_existing.legal_number, true;
    RETURN;
  END IF;

  IF v_scope.effective_from > v_business_date
     OR (v_scope.effective_until IS NOT NULL AND v_scope.effective_until <= v_business_date) THEN
    RAISE EXCEPTION 'numbering scope is not effective for business date' USING ERRCODE = '22023';
  END IF;
  IF p_allocation_mode = 'offline_block' AND (NOT v_scope.offline_allocation_allowed OR p_device_id IS NULL) THEN
    RAISE EXCEPTION 'offline legal-number allocation is not allowed for this scope' USING ERRCODE = '42501';
  END IF;
  IF v_scope.next_value > v_scope.maximum_value THEN
    RAISE EXCEPTION 'legal-number scope is exhausted' USING ERRCODE = '22003';
  END IF;

  v_value := v_scope.next_value;
  v_legal_number := v_scope.prefix || lpad(v_value::text, v_scope.width, '0') || v_scope.suffix;

  UPDATE localization.numbering_scopes
     SET next_value = v_value + 1, updated_at = now()
   WHERE tenant_id = v_tenant_id AND id = p_scope_id;

  INSERT INTO localization.number_allocations(
    id, tenant_id, scope_id, operation_id, numeric_value, legal_number,
    allocation_mode, device_id, actor_id
  ) VALUES (
    v_allocation_id, v_tenant_id, p_scope_id, p_operation_id, v_value,
    v_legal_number, p_allocation_mode, p_device_id, v_actor_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.legal_number.allocated.v1',
    'localization.number.allocate', 'success', v_actor_id, 'localization.number_allocation',
    v_allocation_id::text, v_request_id, v_trace_id,
    jsonb_build_object('scopeId', p_scope_id, 'legalNumber', v_legal_number, 'mode', p_allocation_mode),
    v_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.legal_number.allocated.v1',
    'localization.number_allocation', v_allocation_id::text, '1.0',
    jsonb_build_object('allocationId', v_allocation_id, 'scopeId', p_scope_id, 'legalNumber', v_legal_number),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT v_allocation_id, v_value, v_legal_number, false;
END $$;

CREATE OR REPLACE FUNCTION localization.publish_legal_document_v1(
  p_document_id uuid,
  p_allocation_id uuid,
  p_business_date date,
  p_issued_at timestamptz,
  p_pack_version_id uuid,
  p_template_id text,
  p_template_version text,
  p_tax_rule_version text,
  p_currency_metadata_version text,
  p_source_type text,
  p_source_id text,
  p_source_version text,
  p_totals jsonb,
  p_semantic_payload_hash text,
  p_rendered_document_hash text,
  p_archive_object_key text,
  p_initial_fiscal_status text,
  p_correction_of_document_id uuid DEFAULT NULL
) RETURNS TABLE(
  document_id uuid,
  legal_number text,
  fiscal_status text,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, localization AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_allocation localization.number_allocations%ROWTYPE;
  v_scope localization.numbering_scopes%ROWTYPE;
  v_existing localization.legal_documents%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_document_id IS NULL OR p_allocation_id IS NULL OR p_business_date IS NULL OR p_issued_at IS NULL
     OR p_pack_version_id IS NULL OR p_totals IS NULL
     OR p_semantic_payload_hash !~ '^[a-f0-9]{64}$'
     OR p_rendered_document_hash !~ '^[a-f0-9]{64}$'
     OR p_initial_fiscal_status NOT IN ('not_required','pending','accepted','rejected','unknown','corrected') THEN
    RAISE EXCEPTION 'legal document payload is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'localization.legal_document:' || v_tenant_id::text || ':' || p_document_id::text,
    0
  ));

  SELECT * INTO v_existing
  FROM localization.legal_documents
  WHERE tenant_id = v_tenant_id AND id = p_document_id;
  IF FOUND THEN
    IF v_existing.semantic_payload_hash <> p_semantic_payload_hash
       OR v_existing.rendered_document_hash <> p_rendered_document_hash
       OR v_existing.allocation_id <> p_allocation_id THEN
      RAISE EXCEPTION 'legal document identity payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.legal_number, v_existing.initial_fiscal_status, true;
    RETURN;
  END IF;

  SELECT a, s INTO v_allocation, v_scope
  FROM localization.number_allocations a
  JOIN localization.numbering_scopes s
    ON s.tenant_id = a.tenant_id AND s.id = a.scope_id
  WHERE a.tenant_id = v_tenant_id AND a.id = p_allocation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legal-number allocation does not exist' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM localization.pack_activations a
    WHERE a.tenant_id = v_tenant_id
      AND a.pack_version_id = p_pack_version_id
      AND a.legal_entity_id = v_scope.legal_entity_id
      AND a.store_id IS NOT DISTINCT FROM v_scope.store_id
      AND a.status = 'active'
      AND a.effective_from <= p_business_date
  ) THEN
    RAISE EXCEPTION 'country pack is not active for the legal document scope' USING ERRCODE = '23503';
  END IF;
  IF p_correction_of_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM localization.legal_documents d
    WHERE d.tenant_id = v_tenant_id AND d.id = p_correction_of_document_id
  ) THEN
    RAISE EXCEPTION 'correction target does not exist' USING ERRCODE = '23503';
  END IF;

  INSERT INTO localization.legal_documents(
    id, tenant_id, legal_entity_id, store_id, allocation_id, document_type,
    legal_number, business_date, issued_at, pack_version_id, template_id,
    template_version, tax_rule_version, currency_metadata_version, source_type,
    source_id, source_version, totals, semantic_payload_hash, rendered_document_hash,
    archive_object_key, initial_fiscal_status, correction_of_document_id,
    actor_id, request_id, trace_id
  ) VALUES (
    p_document_id, v_tenant_id, v_scope.legal_entity_id, v_scope.store_id,
    p_allocation_id, v_scope.document_type, v_allocation.legal_number,
    p_business_date, p_issued_at, p_pack_version_id, p_template_id,
    p_template_version, p_tax_rule_version, p_currency_metadata_version,
    p_source_type, p_source_id, p_source_version, p_totals,
    p_semantic_payload_hash, p_rendered_document_hash, p_archive_object_key,
    p_initial_fiscal_status, p_correction_of_document_id,
    v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, after_hash, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.legal_document.published.v1',
    'localization.document.publish', 'success', v_actor_id, 'localization.legal_document',
    p_document_id::text, v_request_id, v_trace_id, p_rendered_document_hash,
    jsonb_build_object('legalNumber', v_allocation.legal_number, 'documentType', v_scope.document_type, 'sourceId', p_source_id),
    p_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.legal_document.published.v1',
    'localization.legal_document', p_document_id::text, '1.0',
    jsonb_build_object(
      'documentId', p_document_id, 'legalNumber', v_allocation.legal_number,
      'documentType', v_scope.document_type, 'fiscalStatus', p_initial_fiscal_status
    ),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), p_business_date
  );

  RETURN QUERY SELECT p_document_id, v_allocation.legal_number, p_initial_fiscal_status, false;
END $$;

CREATE OR REPLACE FUNCTION localization.record_fiscal_transition_v1(
  p_event_id uuid,
  p_document_id uuid,
  p_provider_capability_id text,
  p_payload_hash text,
  p_idempotency_key text,
  p_status text,
  p_provider_reference text DEFAULT NULL,
  p_rejection_code text DEFAULT NULL,
  p_rejection_message text DEFAULT NULL,
  p_retry_after timestamptz DEFAULT NULL
) RETURNS TABLE(
  event_id uuid,
  status text,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, localization AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_existing localization.fiscal_submission_events%ROWTYPE;
  v_previous_id uuid;
  v_previous_status text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_document_id IS NULL
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) < 8
     OR p_payload_hash !~ '^[a-f0-9]{64}$'
     OR p_status NOT IN ('pending','accepted','rejected','unknown','corrected') THEN
    RAISE EXCEPTION 'fiscal transition payload is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM localization.fiscal_submission_events
  WHERE tenant_id = v_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.document_id <> p_document_id OR v_existing.payload_hash <> p_payload_hash OR v_existing.status <> p_status THEN
      RAISE EXCEPTION 'fiscal idempotency payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.status, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'localization.fiscal.document:' || v_tenant_id::text || ':' || p_document_id::text,
    0
  ));

  SELECT * INTO v_existing
  FROM localization.fiscal_submission_events
  WHERE tenant_id = v_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.document_id <> p_document_id OR v_existing.payload_hash <> p_payload_hash OR v_existing.status <> p_status THEN
      RAISE EXCEPTION 'fiscal idempotency payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.status, true;
    RETURN;
  END IF;

  SELECT e.id, e.status INTO v_previous_id, v_previous_status
  FROM localization.fiscal_submission_events e
  WHERE e.tenant_id = v_tenant_id AND e.document_id = p_document_id
  ORDER BY e.observed_at DESC, e.id DESC
  LIMIT 1;

  IF v_previous_status IS NULL THEN
    SELECT d.initial_fiscal_status INTO v_previous_status
    FROM localization.legal_documents d
    WHERE d.tenant_id = v_tenant_id AND d.id = p_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'legal document does not exist' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF v_previous_status = 'not_required'
     OR v_previous_status = 'corrected'
     OR (v_previous_status = 'accepted' AND p_status <> 'corrected')
     OR (v_previous_status = 'pending' AND p_status NOT IN ('pending','accepted','rejected','unknown'))
     OR (v_previous_status = 'rejected' AND p_status NOT IN ('pending','corrected'))
     OR (v_previous_status = 'unknown' AND p_status NOT IN ('pending','accepted','rejected','corrected')) THEN
    RAISE EXCEPTION 'invalid fiscal status transition from % to %', v_previous_status, p_status USING ERRCODE = '22023';
  END IF;

  INSERT INTO localization.fiscal_submission_events(
    id, tenant_id, document_id, previous_event_id, provider_capability_id,
    payload_hash, idempotency_key, status, provider_reference, rejection_code,
    rejection_message, retry_after, actor_id, request_id, trace_id
  ) VALUES (
    p_event_id, v_tenant_id, p_document_id, v_previous_id, p_provider_capability_id,
    p_payload_hash, p_idempotency_key, p_status, p_provider_reference,
    p_rejection_code, p_rejection_message, p_retry_after, v_actor_id,
    v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.fiscal.status_changed.v1',
    'localization.fiscal.submit', 'success', v_actor_id, 'localization.legal_document',
    p_document_id::text, v_request_id, v_trace_id,
    jsonb_build_object('fromStatus', v_previous_status, 'toStatus', p_status, 'providerReference', p_provider_reference),
    v_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.fiscal.status_changed.v1',
    'localization.legal_document', p_document_id::text, '1.0',
    jsonb_build_object('documentId', p_document_id, 'fromStatus', v_previous_status, 'toStatus', p_status),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_event_id, p_status, false;
END $$;

CREATE OR REPLACE FUNCTION localization.request_privacy_operation_v1(
  p_operation_id uuid,
  p_subject_reference text,
  p_operation_type text,
  p_retention_policy_id uuid,
  p_reason text
) RETURNS TABLE(
  operation_id uuid,
  status text,
  replayed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, localization AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_policy localization.retention_policies%ROWTYPE;
  v_existing localization.privacy_operations%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR btrim(COALESCE(p_subject_reference, '')) = ''
     OR p_operation_type NOT IN ('access','export','correct','anonymize','erase','restrict')
     OR p_retention_policy_id IS NULL OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'privacy operation payload is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'localization.privacy.operation:' || v_tenant_id::text || ':' || p_operation_id::text,
    0
  ));

  SELECT * INTO v_existing
  FROM localization.privacy_operations
  WHERE tenant_id = v_tenant_id AND id = p_operation_id;
  IF FOUND THEN
    IF v_existing.subject_reference <> p_subject_reference
       OR v_existing.operation_type <> p_operation_type
       OR v_existing.retention_policy_id <> p_retention_policy_id THEN
      RAISE EXCEPTION 'privacy operation identity payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.status, true;
    RETURN;
  END IF;

  SELECT * INTO v_policy
  FROM localization.retention_policies
  WHERE tenant_id = v_tenant_id AND id = p_retention_policy_id
    AND effective_from <= v_business_date
    AND (effective_until IS NULL OR effective_until > v_business_date);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'effective retention policy does not exist' USING ERRCODE = '23503';
  END IF;
  IF p_operation_type = 'erase' AND NOT v_policy.anonymization_allowed THEN
    RAISE EXCEPTION 'retention policy blocks erasure and anonymization' USING ERRCODE = '42501';
  END IF;

  INSERT INTO localization.privacy_operations(
    id, tenant_id, subject_reference, operation_type, retention_policy_id,
    retention_policy_version, status, requested_by, reason
  ) VALUES (
    p_operation_id, v_tenant_id, p_subject_reference, p_operation_type,
    p_retention_policy_id, v_policy.version, 'requested', v_actor_id, p_reason
  );

  INSERT INTO localization.privacy_operation_events(
    id, tenant_id, operation_id, from_status, to_status, actor_id, reason,
    request_id, trace_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_operation_id, NULL, 'requested',
    v_actor_id, p_reason, v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.privacy.requested.v1',
    'localization.privacy.manage', 'success', v_actor_id, 'localization.privacy_operation',
    p_operation_id::text, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('operationType', p_operation_type, 'subjectReference', p_subject_reference),
    v_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.privacy.requested.v1',
    'localization.privacy_operation', p_operation_id::text, '1.0',
    jsonb_build_object('operationId', p_operation_id, 'operationType', p_operation_type),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_operation_id, 'requested'::text, false;
END $$;

CREATE OR REPLACE FUNCTION localization.transition_privacy_operation_v1(
  p_operation_id uuid,
  p_status text,
  p_preserved_evidence_references text[] DEFAULT '{}',
  p_affected_resource_references text[] DEFAULT '{}',
  p_reason text DEFAULT ''
) RETURNS TABLE(
  operation_id uuid,
  status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform, localization AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_operation localization.privacy_operations%ROWTYPE;
  v_policy localization.retention_policies%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant and actor context are required' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR p_status NOT IN ('approved','running','completed','partially_completed','rejected')
     OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'privacy transition payload is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_operation
  FROM localization.privacy_operations
  WHERE tenant_id = v_tenant_id AND id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy operation does not exist' USING ERRCODE = '23503';
  END IF;

  IF (v_operation.status = 'requested' AND p_status NOT IN ('approved','rejected'))
     OR (v_operation.status = 'approved' AND p_status NOT IN ('running','rejected'))
     OR (v_operation.status = 'running' AND p_status NOT IN ('completed','partially_completed','rejected'))
     OR v_operation.status IN ('completed','partially_completed','rejected') THEN
    RAISE EXCEPTION 'invalid privacy status transition from % to %', v_operation.status, p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_policy
  FROM localization.retention_policies
  WHERE tenant_id = v_tenant_id AND id = v_operation.retention_policy_id;
  IF p_status IN ('completed','partially_completed')
     AND v_policy.immutable_evidence_required
     AND cardinality(COALESCE(p_preserved_evidence_references, '{}')) = 0 THEN
    RAISE EXCEPTION 'legally required evidence must be preserved' USING ERRCODE = '42501';
  END IF;

  UPDATE localization.privacy_operations
     SET status = p_status,
         preserved_evidence_references = COALESCE(p_preserved_evidence_references, '{}'),
         affected_resource_references = COALESCE(p_affected_resource_references, '{}'),
         completed_at = CASE WHEN p_status IN ('completed','partially_completed') THEN now() ELSE NULL END,
         updated_at = now()
   WHERE tenant_id = v_tenant_id AND id = p_operation_id;

  INSERT INTO localization.privacy_operation_events(
    id, tenant_id, operation_id, from_status, to_status, actor_id, reason,
    preserved_evidence_references, affected_resource_references, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_operation_id, v_operation.status, p_status,
    v_actor_id, p_reason, COALESCE(p_preserved_evidence_references, '{}'),
    COALESCE(p_affected_resource_references, '{}'), v_request_id, v_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.privacy.status_changed.v1',
    'localization.privacy.manage', 'success', v_actor_id, 'localization.privacy_operation',
    p_operation_id::text, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('fromStatus', v_operation.status, 'toStatus', p_status),
    v_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'localization.privacy.status_changed.v1',
    'localization.privacy_operation', p_operation_id::text, '1.0',
    jsonb_build_object('operationId', p_operation_id, 'fromStatus', v_operation.status, 'toStatus', p_status),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  RETURN QUERY SELECT p_operation_id, p_status;
END $$;

GRANT USAGE ON SCHEMA localization TO store_app_runtime, store_app_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA localization TO store_app_runtime, store_app_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA localization GRANT SELECT ON TABLES TO store_app_runtime, store_app_reporting;

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA localization FROM store_app_runtime, store_app_reporting;

REVOKE ALL ON FUNCTION localization.activate_country_pack_v1(uuid,uuid,uuid,uuid,date,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.allocate_legal_number_v1(uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.publish_legal_document_v1(uuid,uuid,date,timestamptz,uuid,text,text,text,text,text,text,text,jsonb,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.record_fiscal_transition_v1(uuid,uuid,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.request_privacy_operation_v1(uuid,text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.transition_privacy_operation_v1(uuid,text,text[],text[],text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION localization.activate_country_pack_v1(uuid,uuid,uuid,uuid,date,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.allocate_legal_number_v1(uuid,text,text,uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.publish_legal_document_v1(uuid,uuid,date,timestamptz,uuid,text,text,text,text,text,text,text,jsonb,text,text,text,text,uuid) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.record_fiscal_transition_v1(uuid,uuid,text,text,text,text,text,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.request_privacy_operation_v1(uuid,text,text,uuid,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.transition_privacy_operation_v1(uuid,text,text[],text[],text) TO store_app_runtime;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('localization.pack.read','localization','Read country-pack versions and activations','standard'),
  ('localization.pack.manage','localization','Publish and activate country packs','privileged'),
  ('localization.number.read','localization','Read legal numbering scopes and allocations','sensitive'),
  ('localization.number.allocate','localization','Allocate collision-free legal numbers','sensitive'),
  ('localization.number.manage','localization','Manage legal numbering scopes','privileged'),
  ('localization.document.read','localization','Read immutable legal documents','sensitive'),
  ('localization.document.publish','localization','Publish immutable legal documents','privileged'),
  ('localization.fiscal.submit','localization','Submit and reconcile fiscal documents','privileged'),
  ('localization.privacy.read','localization','Read privacy and retention workflows','sensitive'),
  ('localization.privacy.manage','localization','Approve and execute privacy operations','privileged'),
  ('localization.residency.read','localization','Read data-residency policies','sensitive'),
  ('localization.residency.manage','localization','Manage data-residency policies','privileged')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('LOC-0001','MOD-F-LOCALIZATION','manifest:LOC-0001-localization-compliance.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
