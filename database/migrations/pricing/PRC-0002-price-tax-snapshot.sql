BEGIN;

CREATE TABLE IF NOT EXISTS pricing.price_tax_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  source_line_id text NOT NULL,
  product_id uuid NULL,
  variant_id uuid NOT NULL,
  unit_code text NOT NULL,
  quantity_minor numeric(38,0) NOT NULL CHECK (quantity_minor > 0),
  quantity_scale integer NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  currency char(3) NOT NULL,
  money_scale integer NOT NULL CHECK (money_scale BETWEEN 0 AND 12),
  price_list_id uuid NOT NULL,
  price_rule_id uuid NOT NULL,
  price_list_version bigint NOT NULL CHECK (price_list_version > 0),
  price_rule_version bigint NOT NULL CHECK (price_rule_version > 0),
  unit_price_minor numeric(38,0) NOT NULL CHECK (unit_price_minor >= 0),
  subtotal_minor numeric(38,0) NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor numeric(38,0) NOT NULL CHECK (discount_minor >= 0),
  promoted_amount_minor numeric(38,0) NOT NULL CHECK (promoted_amount_minor >= 0),
  promotion_ids uuid[] NOT NULL DEFAULT '{}',
  tax_code_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  tax_treatment text NOT NULL CHECK (tax_treatment IN ('standard','zero_rated','exempt','reverse_charge','out_of_scope')),
  tax_price_mode text NOT NULL CHECK (tax_price_mode IN ('exclusive','inclusive')),
  exemption_id uuid NULL,
  net_minor numeric(38,0) NOT NULL CHECK (net_minor >= 0),
  tax_minor numeric(38,0) NOT NULL CHECK (tax_minor >= 0),
  gross_minor numeric(38,0) NOT NULL CHECK (gross_minor >= 0),
  tax_rate_ids uuid[] NOT NULL DEFAULT '{}',
  tax_calculation_version text NOT NULL,
  rounding_mode text NOT NULL CHECK (rounding_mode IN ('half_up','half_even','floor','ceiling','toward_zero')),
  calculation_hash text NOT NULL CHECK (calculation_hash ~ '^[a-f0-9]{64}$'),
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json)='object'),
  request_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  business_date date NOT NULL,
  calculated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES catalog.products(tenant_id,id),
  FOREIGN KEY (tenant_id,variant_id) REFERENCES catalog.variants(tenant_id,id),
  FOREIGN KEY (tenant_id,price_list_id) REFERENCES pricing.price_lists(tenant_id,id),
  FOREIGN KEY (tenant_id,price_rule_id) REFERENCES pricing.price_rules(tenant_id,id),
  CHECK (subtotal_minor - discount_minor = promoted_amount_minor),
  CHECK (net_minor + tax_minor = gross_minor),
  CHECK (snapshot_json->>'calculationHash' = calculation_hash)
);
CREATE INDEX IF NOT EXISTS price_tax_snapshots_source_idx
  ON pricing.price_tax_snapshots(tenant_id,source_line_id,created_at DESC);
CREATE INDEX IF NOT EXISTS price_tax_snapshots_variant_idx
  ON pricing.price_tax_snapshots(tenant_id,variant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS price_tax_snapshots_hash_idx
  ON pricing.price_tax_snapshots(tenant_id,calculation_hash);

DROP TRIGGER IF EXISTS append_only ON pricing.price_tax_snapshots;
CREATE TRIGGER append_only
BEFORE UPDATE OR DELETE ON pricing.price_tax_snapshots
FOR EACH ROW EXECUTE FUNCTION pricing.reject_append_only_mutation();

ALTER TABLE pricing.price_tax_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing.price_tax_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pricing.price_tax_snapshots;
CREATE POLICY tenant_isolation ON pricing.price_tax_snapshots
USING (tenant_id=platform.current_tenant_id())
WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE OR REPLACE FUNCTION pricing.record_price_tax_snapshot(
  p_idempotency_key text,
  p_request_hash text,
  p_snapshot jsonb,
  p_request_id text
) RETURNS TABLE(
  snapshot_id uuid,
  source_line_id text,
  variant_id uuid,
  currency text,
  scale integer,
  subtotal_minor numeric,
  discount_minor numeric,
  net_minor numeric,
  tax_minor numeric,
  gross_minor numeric,
  calculation_hash text,
  replayed boolean,
  created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,platform,pricing AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_id uuid := (p_snapshot->>'snapshotId')::uuid;
  v_created_at timestamptz;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'request context is required' USING ERRCODE='42501';
  END IF;
  IF char_length(p_idempotency_key)<8 OR p_request_hash !~ '^[a-fA-F0-9]{64}$' OR p_snapshot->>'calculationHash' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid price-tax idempotency input' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing
  FROM platform.idempotency_records
  WHERE tenant_id=v_tenant_id AND scope='pricing.price_tax.snapshot' AND idempotency_key=p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE='P0001';
    END IF;
    IF v_existing.status='completed' THEN
      RETURN QUERY
      SELECT s.id,s.source_line_id,s.variant_id,s.currency::text,s.money_scale,
        s.subtotal_minor,s.discount_minor,s.net_minor,s.tax_minor,s.gross_minor,
        s.calculation_hash,true,s.created_at
      FROM pricing.price_tax_snapshots s
      WHERE s.tenant_id=v_tenant_id AND s.id=(v_existing.response_json->>'snapshotId')::uuid;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE='55P03';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id,scope,idempotency_key,request_hash,status)
  VALUES (v_tenant_id,'pricing.price_tax.snapshot',p_idempotency_key,p_request_hash,'processing');

  INSERT INTO pricing.price_tax_snapshots(
    id,tenant_id,source_line_id,product_id,variant_id,unit_code,quantity_minor,quantity_scale,
    currency,money_scale,price_list_id,price_rule_id,price_list_version,price_rule_version,
    unit_price_minor,subtotal_minor,discount_minor,promoted_amount_minor,promotion_ids,
    tax_code_id,jurisdiction_id,tax_treatment,tax_price_mode,exemption_id,net_minor,tax_minor,gross_minor,
    tax_rate_ids,tax_calculation_version,rounding_mode,calculation_hash,snapshot_json,request_id,
    actor_id,business_date,calculated_at
  ) VALUES (
    v_id,v_tenant_id,p_snapshot->>'sourceLineId',NULLIF(p_snapshot->>'productId','')::uuid,
    (p_snapshot->>'variantId')::uuid,p_snapshot->>'unitCode',(p_snapshot->>'quantityMinor')::numeric,
    (p_snapshot->>'quantityScale')::integer,p_snapshot->>'currency',(p_snapshot->>'moneyScale')::integer,
    (p_snapshot->>'priceListId')::uuid,(p_snapshot->>'priceRuleId')::uuid,
    (p_snapshot->>'priceListVersion')::bigint,(p_snapshot->>'priceRuleVersion')::bigint,
    (p_snapshot->>'unitPriceMinor')::numeric,(p_snapshot->>'subtotalMinor')::numeric,
    (p_snapshot->>'discountMinor')::numeric,(p_snapshot->>'promotedAmountMinor')::numeric,
    ARRAY(SELECT (value->>'promotionId')::uuid FROM jsonb_array_elements(COALESCE(p_snapshot->'promotions','[]'::jsonb))),
    (p_snapshot->>'taxCodeId')::uuid,(p_snapshot->>'jurisdictionId')::uuid,p_snapshot->>'taxTreatment',
    p_snapshot->>'taxPriceMode',NULLIF(p_snapshot->>'exemptionId','')::uuid,
    (p_snapshot->>'netMinor')::numeric,(p_snapshot->>'taxMinor')::numeric,(p_snapshot->>'grossMinor')::numeric,
    ARRAY(SELECT (value->>'rateId')::uuid FROM jsonb_array_elements(COALESCE(p_snapshot->'taxComponents','[]'::jsonb))),
    p_snapshot->>'taxCalculationVersion',p_snapshot->>'roundingMode',p_snapshot->>'calculationHash',p_snapshot,
    p_request_id,v_actor_id,v_business_date,(p_snapshot->>'calculatedAt')::timestamptz
  ) RETURNING pricing.price_tax_snapshots.created_at INTO v_created_at;

  INSERT INTO platform.audit_events(
    id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,request_id,trace_id,
    metadata,business_date,source_version
  ) VALUES (
    gen_random_uuid(),v_tenant_id,'pricing.price_tax.snapshotted.v1','pricing.price_tax.calculate','success',
    v_actor_id,'pricing.price_tax_snapshot',v_id::text,p_request_id,v_trace_id,
    jsonb_build_object(
      'sourceLineId',p_snapshot->>'sourceLineId',
      'variantId',p_snapshot->>'variantId',
      'priceListId',p_snapshot->>'priceListId',
      'taxCodeId',p_snapshot->>'taxCodeId',
      'calculationHash',p_snapshot->>'calculationHash'
    ),v_business_date,'mod-a-v1'
  );

  INSERT INTO platform.outbox_events(
    id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,
    correlation_id,occurred_at,business_date
  ) VALUES (
    gen_random_uuid(),v_tenant_id,'pricing.price_tax.snapshotted.v1','pricing.price_tax_snapshot',v_id::text,'1.0',
    jsonb_build_object(
      'snapshotId',v_id,
      'sourceLineId',p_snapshot->>'sourceLineId',
      'variantId',p_snapshot->>'variantId',
      'netMinor',p_snapshot->>'netMinor',
      'taxMinor',p_snapshot->>'taxMinor',
      'grossMinor',p_snapshot->>'grossMinor',
      'currency',p_snapshot->>'currency',
      'calculationHash',p_snapshot->>'calculationHash'
    ),jsonb_build_object('requestId',p_request_id),p_request_id,v_created_at,v_business_date
  );

  UPDATE platform.idempotency_records
  SET status='completed',response_status=201,response_json=jsonb_build_object('snapshotId',v_id),
    resource_type='pricing.price_tax_snapshot',resource_id=v_id::text,updated_at=now()
  WHERE tenant_id=v_tenant_id AND scope='pricing.price_tax.snapshot' AND idempotency_key=p_idempotency_key;

  RETURN QUERY
  SELECT s.id,s.source_line_id,s.variant_id,s.currency::text,s.money_scale,
    s.subtotal_minor,s.discount_minor,s.net_minor,s.tax_minor,s.gross_minor,
    s.calculation_hash,false,s.created_at
  FROM pricing.price_tax_snapshots s
  WHERE s.tenant_id=v_tenant_id AND s.id=v_id;
END $$;

INSERT INTO platform.permissions(code,module,description,risk_level) VALUES
  ('pricing.price_tax.calculate','pricing','Calculate and persist an immutable combined price and tax snapshot','standard')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description,risk_level=EXCLUDED.risk_level;

GRANT SELECT,INSERT ON pricing.price_tax_snapshots TO store_app_runtime;
GRANT SELECT ON pricing.price_tax_snapshots TO store_app_reporting;
REVOKE UPDATE,DELETE ON pricing.price_tax_snapshots FROM store_app_runtime;
REVOKE ALL ON FUNCTION pricing.record_price_tax_snapshot(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pricing.record_price_tax_snapshot(text,text,jsonb,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id,module,checksum)
VALUES ('PRC-0002','MOD-A-PRICING','manifest:PRC-0002-price-tax-snapshot.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
