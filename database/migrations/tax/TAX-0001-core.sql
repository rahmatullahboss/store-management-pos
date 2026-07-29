BEGIN;

CREATE SCHEMA IF NOT EXISTS tax;

CREATE TABLE IF NOT EXISTS tax.jurisdictions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  parent_id uuid NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  country_code char(2) NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,code),
  FOREIGN KEY (tenant_id,parent_id) REFERENCES tax.jurisdictions(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS tax.codes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  current_version bigint NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  active_version bigint NULL CHECK (active_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE IF NOT EXISTS tax.code_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  tax_code_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  default_treatment text NOT NULL CHECK (default_treatment IN ('standard','zero_rated','exempt','reverse_charge','out_of_scope')),
  price_mode text NOT NULL CHECK (price_mode IN ('exclusive','inclusive')),
  rounding_mode text NOT NULL CHECK (rounding_mode IN ('half_up','half_even','floor','ceiling','toward_zero')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','scheduled','active','retired')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,tax_code_id,version),
  FOREIGN KEY (tenant_id,tax_code_id) REFERENCES tax.codes(tenant_id,id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS tax_code_versions_effective_idx ON tax.code_versions(tenant_id,tax_code_id,status,effective_from DESC);

CREATE TABLE IF NOT EXISTS tax.rate_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  tax_code_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  compound boolean NOT NULL DEFAULT false,
  recoverable_basis_points integer NOT NULL DEFAULT 0 CHECK (recoverable_basis_points BETWEEN 0 AND 10000),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  priority integer NOT NULL DEFAULT 0,
  version bigint NOT NULL CHECK (version > 0),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','scheduled','active','retired')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,tax_code_id,jurisdiction_id,code,version),
  FOREIGN KEY (tenant_id,tax_code_id) REFERENCES tax.codes(tenant_id,id),
  FOREIGN KEY (tenant_id,jurisdiction_id) REFERENCES tax.jurisdictions(tenant_id,id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS tax_rate_versions_effective_idx ON tax.rate_versions(tenant_id,tax_code_id,jurisdiction_id,status,effective_from DESC,priority);

CREATE TABLE IF NOT EXISTS tax.exemptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  customer_id text NULL,
  customer_group_id text NULL,
  tax_code_id uuid NULL,
  jurisdiction_id uuid NULL,
  certificate_number text NOT NULL,
  reason text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  document_url text NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,certificate_number),
  FOREIGN KEY (tenant_id,tax_code_id) REFERENCES tax.codes(tenant_id,id),
  FOREIGN KEY (tenant_id,jurisdiction_id) REFERENCES tax.jurisdictions(tenant_id,id),
  CHECK (customer_id IS NOT NULL OR customer_group_id IS NOT NULL),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS tax_exemptions_resolution_idx ON tax.exemptions(tenant_id,status,customer_id,customer_group_id,valid_from DESC);

CREATE TABLE IF NOT EXISTS tax.exemption_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  exemption_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update','revoke','expire','reinstate')),
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,exemption_id) REFERENCES tax.exemptions(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS tax.calculation_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  source_line_id text NOT NULL,
  tax_code_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  exemption_id uuid NULL,
  treatment text NOT NULL CHECK (treatment IN ('standard','zero_rated','exempt','reverse_charge','out_of_scope')),
  price_mode text NOT NULL CHECK (price_mode IN ('exclusive','inclusive')),
  currency char(3) NOT NULL,
  money_scale integer NOT NULL CHECK (money_scale BETWEEN 0 AND 12),
  net_minor numeric(38,0) NOT NULL CHECK (net_minor >= 0),
  tax_minor numeric(38,0) NOT NULL CHECK (tax_minor >= 0),
  gross_minor numeric(38,0) NOT NULL CHECK (gross_minor >= 0),
  calculation_version text NOT NULL,
  calculation_hash text NOT NULL CHECK (calculation_hash ~ '^[a-f0-9]{64}$'),
  calculated_at timestamptz NOT NULL,
  request_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,tax_code_id) REFERENCES tax.codes(tenant_id,id),
  FOREIGN KEY (tenant_id,jurisdiction_id) REFERENCES tax.jurisdictions(tenant_id,id),
  FOREIGN KEY (tenant_id,exemption_id) REFERENCES tax.exemptions(tenant_id,id),
  CHECK (net_minor + tax_minor = gross_minor)
);
CREATE INDEX IF NOT EXISTS tax_calculation_snapshots_source_idx ON tax.calculation_snapshots(tenant_id,source_line_id,created_at DESC);

CREATE TABLE IF NOT EXISTS tax.calculation_components (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  snapshot_id uuid NOT NULL,
  rate_id uuid NOT NULL,
  code text NOT NULL,
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  compound boolean NOT NULL,
  taxable_base_minor numeric(38,0) NOT NULL CHECK (taxable_base_minor >= 0),
  tax_minor numeric(38,0) NOT NULL CHECK (tax_minor >= 0),
  recoverable_tax_minor numeric(38,0) NOT NULL CHECK (recoverable_tax_minor >= 0),
  reporting_tax_minor numeric(38,0) NOT NULL CHECK (reporting_tax_minor >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,snapshot_id,rate_id),
  FOREIGN KEY (tenant_id,snapshot_id) REFERENCES tax.calculation_snapshots(tenant_id,id),
  FOREIGN KEY (tenant_id,rate_id) REFERENCES tax.rate_versions(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS tax.return_allocations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  original_snapshot_id uuid NOT NULL,
  return_source_line_id text NOT NULL,
  net_minor numeric(38,0) NOT NULL CHECK (net_minor >= 0),
  tax_minor numeric(38,0) NOT NULL CHECK (tax_minor >= 0),
  gross_minor numeric(38,0) NOT NULL CHECK (gross_minor >= 0),
  allocation_hash text NOT NULL CHECK (allocation_hash ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,original_snapshot_id,return_source_line_id),
  FOREIGN KEY (tenant_id,original_snapshot_id) REFERENCES tax.calculation_snapshots(tenant_id,id),
  CHECK (net_minor + tax_minor = gross_minor)
);

CREATE OR REPLACE FUNCTION tax.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='55000'; END $$;

DO $append_only$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['code_versions','rate_versions','exemption_actions','calculation_snapshots','calculation_components','return_allocations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS append_only ON tax.%I',table_name);
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON tax.%I FOR EACH ROW EXECUTE FUNCTION tax.reject_append_only_mutation()',table_name);
  END LOOP;
END $append_only$;

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['jurisdictions','codes','code_versions','rate_versions','exemptions','exemption_actions','calculation_snapshots','calculation_components','return_allocations'] LOOP
    EXECUTE format('ALTER TABLE tax.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tax.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON tax.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON tax.%I USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id())',table_name);
  END LOOP;
END $rls$;

CREATE OR REPLACE FUNCTION tax.record_calculation_snapshot(
  p_idempotency_key text,
  p_request_hash text,
  p_snapshot_id uuid,
  p_calculation_hash text,
  p_calculation jsonb,
  p_request_id text
) RETURNS TABLE(
  snapshot_id uuid,
  source_line_id text,
  treatment text,
  currency text,
  scale integer,
  net_minor numeric,
  tax_minor numeric,
  gross_minor numeric,
  calculation_hash text,
  replayed boolean,
  created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,platform,tax AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_created_at timestamptz;
  v_component jsonb;
  v_component_order integer := 0;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE='42501'; END IF;
  IF char_length(p_idempotency_key)<8 OR p_request_hash !~ '^[a-fA-F0-9]{64}$' OR p_calculation_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid tax idempotency or calculation hash' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing FROM platform.idempotency_records
  WHERE tenant_id=v_tenant_id AND scope='tax.calculation.snapshot' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE='P0001'; END IF;
    IF v_existing.status='completed' THEN
      RETURN QUERY SELECT s.id,s.source_line_id,s.treatment,s.currency::text,s.money_scale,s.net_minor,s.tax_minor,s.gross_minor,s.calculation_hash,true,s.created_at
      FROM tax.calculation_snapshots s WHERE s.tenant_id=v_tenant_id AND s.id=(v_existing.response_json->>'snapshotId')::uuid;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE='55P03';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id,scope,idempotency_key,request_hash,status)
  VALUES (v_tenant_id,'tax.calculation.snapshot',p_idempotency_key,p_request_hash,'processing');

  INSERT INTO tax.calculation_snapshots(
    id,tenant_id,source_line_id,tax_code_id,jurisdiction_id,exemption_id,treatment,price_mode,currency,money_scale,
    net_minor,tax_minor,gross_minor,calculation_version,calculation_hash,calculated_at,request_id,actor_id,business_date
  ) VALUES (
    p_snapshot_id,v_tenant_id,p_calculation->>'sourceLineId',(p_calculation->>'taxCodeId')::uuid,(p_calculation->>'jurisdictionId')::uuid,
    NULLIF(p_calculation->>'exemptionId','')::uuid,p_calculation->>'treatment',p_calculation->>'priceMode',p_calculation->>'currency',
    (p_calculation->>'scale')::integer,(p_calculation->'net'->>'amountMinor')::numeric,(p_calculation->'tax'->>'amountMinor')::numeric,
    (p_calculation->'gross'->>'amountMinor')::numeric,p_calculation->>'calculationVersion',p_calculation_hash,
    (p_calculation->>'calculatedAt')::timestamptz,p_request_id,v_actor_id,v_business_date
  ) RETURNING tax.calculation_snapshots.created_at INTO v_created_at;

  FOR v_component IN SELECT value FROM jsonb_array_elements(COALESCE(p_calculation->'components','[]'::jsonb)) LOOP
    v_component_order := v_component_order + 1;
    INSERT INTO tax.calculation_components(
      id,tenant_id,snapshot_id,rate_id,code,rate_basis_points,compound,taxable_base_minor,tax_minor,recoverable_tax_minor,reporting_tax_minor,sort_order
    ) VALUES (
      gen_random_uuid(),v_tenant_id,p_snapshot_id,(v_component->>'rateId')::uuid,v_component->>'code',(v_component->>'rateBasisPoints')::integer,
      COALESCE((v_component->>'compound')::boolean,false),(v_component->'taxableBase'->>'amountMinor')::numeric,
      (v_component->'tax'->>'amountMinor')::numeric,(v_component->'recoverableTax'->>'amountMinor')::numeric,
      (v_component->'reportingTax'->>'amountMinor')::numeric,v_component_order
    );
  END LOOP;

  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,request_id,trace_id,metadata,business_date,source_version)
  VALUES (gen_random_uuid(),v_tenant_id,'tax.calculation.snapshotted.v1','tax.calculation.read','success',v_actor_id,'tax.calculation_snapshot',p_snapshot_id::text,p_request_id,v_trace_id,
    jsonb_build_object('sourceLineId',p_calculation->>'sourceLineId','treatment',p_calculation->>'treatment','calculationHash',p_calculation_hash),v_business_date,'mod-a-v1');

  INSERT INTO platform.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,correlation_id,occurred_at,business_date)
  VALUES (gen_random_uuid(),v_tenant_id,'tax.calculation.snapshotted.v1','tax.calculation_snapshot',p_snapshot_id::text,'1.0',
    jsonb_build_object('snapshotId',p_snapshot_id,'sourceLineId',p_calculation->>'sourceLineId','taxMinor',p_calculation->'tax'->>'amountMinor','grossMinor',p_calculation->'gross'->>'amountMinor','currency',p_calculation->>'currency','calculationHash',p_calculation_hash),
    jsonb_build_object('requestId',p_request_id),p_request_id,v_created_at,v_business_date);

  UPDATE platform.idempotency_records SET status='completed',response_status=201,response_json=jsonb_build_object('snapshotId',p_snapshot_id),
    resource_type='tax.calculation_snapshot',resource_id=p_snapshot_id::text,updated_at=now()
  WHERE tenant_id=v_tenant_id AND scope='tax.calculation.snapshot' AND idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT s.id,s.source_line_id,s.treatment,s.currency::text,s.money_scale,s.net_minor,s.tax_minor,s.gross_minor,s.calculation_hash,false,s.created_at
  FROM tax.calculation_snapshots s WHERE s.tenant_id=v_tenant_id AND s.id=p_snapshot_id;
END $$;

INSERT INTO platform.permissions(code,module,description,risk_level) VALUES
  ('tax.calculation.read','tax','Calculate tax and read immutable tax snapshots','standard'),
  ('tax.configuration.manage','tax','Create and edit draft tax jurisdictions, codes and rates','sensitive'),
  ('tax.configuration.publish','tax','Publish effective tax code and rate versions','privileged'),
  ('tax.exemption.manage','tax','Manage customer tax exemptions and certificates','privileged')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description,risk_level=EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA tax TO store_app_runtime,store_app_reporting;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA tax TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA tax TO store_app_reporting;
REVOKE UPDATE,DELETE ON tax.code_versions,tax.rate_versions,tax.exemption_actions,tax.calculation_snapshots,tax.calculation_components,tax.return_allocations FROM store_app_runtime;
REVOKE DELETE ON tax.jurisdictions,tax.codes,tax.exemptions FROM store_app_runtime;
REVOKE ALL ON FUNCTION tax.record_calculation_snapshot(text,text,uuid,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tax.record_calculation_snapshot(text,text,uuid,text,jsonb,text) TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA tax GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA tax GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id,module,checksum)
VALUES ('TAX-0001','MOD-A-TAX','manifest:TAX-0001-core.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
