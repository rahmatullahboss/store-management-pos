BEGIN;

CREATE SCHEMA IF NOT EXISTS pricing;

CREATE TABLE IF NOT EXISTS pricing.price_lists (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  currency char(3) NOT NULL,
  money_scale integer NOT NULL CHECK (money_scale BETWEEN 0 AND 12),
  current_version bigint NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  active_version bigint NULL CHECK (active_version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','retired')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE IF NOT EXISTS pricing.price_list_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  price_list_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft','scheduled','active','retired')),
  priority integer NOT NULL DEFAULT 0,
  legal_entity_id uuid NULL,
  store_id uuid NULL,
  channel text NULL CHECK (channel IN ('admin','pos','web','mobile','marketplace','wholesale')),
  customer_group_id text NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,price_list_id,version),
  FOREIGN KEY (tenant_id,price_list_id) REFERENCES pricing.price_lists(tenant_id,id),
  FOREIGN KEY (tenant_id,legal_entity_id) REFERENCES platform.legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id,store_id) REFERENCES platform.stores(tenant_id,id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS price_list_versions_resolution_idx ON pricing.price_list_versions(tenant_id,status,effective_from,effective_until,priority DESC);

CREATE TABLE IF NOT EXISTS pricing.price_rules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  price_list_version_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  unit_code text NOT NULL,
  minimum_quantity_minor numeric(38,0) NOT NULL CHECK (minimum_quantity_minor > 0),
  quantity_scale integer NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  unit_price_minor numeric(38,0) NOT NULL CHECK (unit_price_minor >= 0),
  compare_at_price_minor numeric(38,0) NULL,
  minimum_margin_basis_points integer NULL CHECK (minimum_margin_basis_points BETWEEN 0 AND 9999),
  priority integer NOT NULL DEFAULT 0,
  effective_from timestamptz NULL,
  effective_until timestamptz NULL,
  rule_version bigint NOT NULL CHECK (rule_version > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,price_list_version_id,variant_id,unit_code,minimum_quantity_minor,quantity_scale,rule_version),
  FOREIGN KEY (tenant_id,price_list_version_id) REFERENCES pricing.price_list_versions(tenant_id,id),
  FOREIGN KEY (tenant_id,variant_id) REFERENCES catalog.variants(tenant_id,id),
  CHECK (compare_at_price_minor IS NULL OR compare_at_price_minor >= unit_price_minor),
  CHECK (effective_until IS NULL OR effective_from IS NOT NULL AND effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS price_rules_resolution_idx ON pricing.price_rules(tenant_id,variant_id,unit_code,minimum_quantity_minor DESC,priority DESC);

CREATE TABLE IF NOT EXISTS pricing.promotions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL,
  display_name text NOT NULL,
  current_version bigint NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  active_version bigint NULL CHECK (active_version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','paused','expired','retired')),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  updated_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,code)
);

CREATE TABLE IF NOT EXISTS pricing.promotion_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  promotion_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft','scheduled','active','paused','expired','retired')),
  priority integer NOT NULL DEFAULT 0,
  exclusive boolean NOT NULL DEFAULT false,
  stacking_group text NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  action jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  global_redemption_limit bigint NULL CHECK (global_redemption_limit > 0),
  customer_redemption_limit bigint NULL CHECK (customer_redemption_limit > 0),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,promotion_id,version),
  FOREIGN KEY (tenant_id,promotion_id) REFERENCES pricing.promotions(tenant_id,id),
  CHECK (jsonb_typeof(conditions)='array'),
  CHECK (jsonb_typeof(action)='object'),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS promotion_versions_resolution_idx ON pricing.promotion_versions(tenant_id,status,effective_from,effective_until,priority DESC);

CREATE TABLE IF NOT EXISTS pricing.coupons (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  promotion_id uuid NOT NULL,
  code text NOT NULL,
  normalized_code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired','revoked')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  global_limit bigint NULL CHECK (global_limit > 0),
  per_customer_limit bigint NULL CHECK (per_customer_limit > 0),
  created_by uuid NOT NULL REFERENCES platform.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,normalized_code),
  FOREIGN KEY (tenant_id,promotion_id) REFERENCES pricing.promotions(tenant_id,id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS pricing.coupon_redemptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  coupon_id uuid NOT NULL,
  customer_id text NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  amount_minor numeric(38,0) NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  money_scale integer NOT NULL CHECK (money_scale BETWEEN 0 AND 12),
  business_date date NOT NULL,
  request_id text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,coupon_id,source_type,source_id),
  FOREIGN KEY (tenant_id,coupon_id) REFERENCES pricing.coupons(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_limit_idx ON pricing.coupon_redemptions(tenant_id,coupon_id,customer_id,redeemed_at DESC);

CREATE TABLE IF NOT EXISTS pricing.quote_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  variant_id uuid NOT NULL,
  price_list_id uuid NOT NULL,
  price_rule_id uuid NOT NULL,
  currency char(3) NOT NULL,
  money_scale integer NOT NULL CHECK (money_scale BETWEEN 0 AND 12),
  unit_price_minor numeric(38,0) NOT NULL,
  quantity_minor numeric(38,0) NOT NULL CHECK (quantity_minor > 0),
  quantity_scale integer NOT NULL CHECK (quantity_scale BETWEEN 0 AND 18),
  subtotal_minor numeric(38,0) NOT NULL,
  discount_minor numeric(38,0) NOT NULL CHECK (discount_minor >= 0),
  total_minor numeric(38,0) NOT NULL,
  promotion_ids uuid[] NOT NULL DEFAULT '{}',
  calculation_hash text NOT NULL CHECK (calculation_hash ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,variant_id) REFERENCES catalog.variants(tenant_id,id),
  FOREIGN KEY (tenant_id,price_list_id) REFERENCES pricing.price_lists(tenant_id,id),
  FOREIGN KEY (tenant_id,price_rule_id) REFERENCES pricing.price_rules(tenant_id,id),
  CHECK (subtotal_minor - discount_minor = total_minor)
);
CREATE INDEX IF NOT EXISTS quote_snapshots_variant_idx ON pricing.quote_snapshots(tenant_id,variant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS pricing.manual_discount_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  target_type text NOT NULL,
  target_id text NOT NULL,
  currency char(3) NOT NULL,
  money_scale integer NOT NULL CHECK (money_scale BETWEEN 0 AND 12),
  original_amount_minor numeric(38,0) NOT NULL CHECK (original_amount_minor >= 0),
  requested_discount_minor numeric(38,0) NOT NULL CHECK (requested_discount_minor >= 0),
  minimum_allowed_amount_minor numeric(38,0) NULL CHECK (minimum_allowed_amount_minor >= 0),
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES platform.users(id),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  CHECK (requested_discount_minor <= original_amount_minor)
);

CREATE TABLE IF NOT EXISTS pricing.manual_discount_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve','reject','cancel','apply')),
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,request_id) REFERENCES pricing.manual_discount_requests(tenant_id,id)
);

CREATE OR REPLACE FUNCTION pricing.reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000'; END $$;

DO $append_only$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['price_list_versions','price_rules','promotion_versions','coupon_redemptions','quote_snapshots','manual_discount_requests','manual_discount_actions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS append_only ON pricing.%I',table_name);
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON pricing.%I FOR EACH ROW EXECUTE FUNCTION pricing.reject_append_only_mutation()',table_name);
  END LOOP;
END $append_only$;

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['price_lists','price_list_versions','price_rules','promotions','promotion_versions','coupons','coupon_redemptions','quote_snapshots','manual_discount_requests','manual_discount_actions'] LOOP
    EXECUTE format('ALTER TABLE pricing.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE pricing.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON pricing.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON pricing.%I USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id())',table_name);
  END LOOP;
END $rls$;

CREATE OR REPLACE FUNCTION pricing.record_quote_snapshot(p_idempotency_key text,p_request_hash text,p_snapshot jsonb,p_request_id text)
RETURNS TABLE(snapshot_id uuid,variant_id uuid,price_list_id uuid,price_rule_id uuid,currency text,scale integer,unit_price_minor numeric,quantity_minor numeric,quantity_scale integer,subtotal_minor numeric,discount_minor numeric,total_minor numeric,promotion_ids uuid[],calculation_hash text,replayed boolean,created_at timestamptz)
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
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE='42501'; END IF;
  IF char_length(p_idempotency_key)<8 OR p_request_hash !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION 'invalid idempotency input' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM platform.idempotency_records WHERE tenant_id=v_tenant_id AND scope='pricing.quote.snapshot' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE='P0001'; END IF;
    IF v_existing.status='completed' THEN
      RETURN QUERY SELECT q.id,q.variant_id,q.price_list_id,q.price_rule_id,q.currency::text,q.money_scale,q.unit_price_minor,q.quantity_minor,q.quantity_scale,q.subtotal_minor,q.discount_minor,q.total_minor,q.promotion_ids,q.calculation_hash,true,q.created_at FROM pricing.quote_snapshots q WHERE q.tenant_id=v_tenant_id AND q.id=(v_existing.response_json->>'snapshotId')::uuid;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE='55P03';
  END IF;
  INSERT INTO platform.idempotency_records(tenant_id,scope,idempotency_key,request_hash,status) VALUES (v_tenant_id,'pricing.quote.snapshot',p_idempotency_key,p_request_hash,'processing');
  INSERT INTO pricing.quote_snapshots(id,tenant_id,variant_id,price_list_id,price_rule_id,currency,money_scale,unit_price_minor,quantity_minor,quantity_scale,subtotal_minor,discount_minor,total_minor,promotion_ids,calculation_hash,request_id,actor_id,business_date)
  VALUES (v_id,v_tenant_id,(p_snapshot->>'variantId')::uuid,(p_snapshot->>'priceListId')::uuid,(p_snapshot->>'priceRuleId')::uuid,p_snapshot->>'currency',(p_snapshot->>'scale')::integer,(p_snapshot->>'unitPriceMinor')::numeric,(p_snapshot->>'quantityMinor')::numeric,(p_snapshot->>'quantityScale')::integer,(p_snapshot->>'subtotalMinor')::numeric,(p_snapshot->>'discountMinor')::numeric,(p_snapshot->>'totalMinor')::numeric,ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_snapshot->'promotionIds','[]'::jsonb))::uuid),p_snapshot->>'calculationHash',p_request_id,v_actor_id,v_business_date)
  RETURNING pricing.quote_snapshots.created_at INTO v_created_at;
  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,request_id,trace_id,metadata,business_date,source_version)
  VALUES (gen_random_uuid(),v_tenant_id,'pricing.quote.snapshotted.v1','pricing.price.read','success',v_actor_id,'pricing.quote_snapshot',v_id::text,p_request_id,v_trace_id,jsonb_build_object('variantId',p_snapshot->>'variantId','calculationHash',p_snapshot->>'calculationHash'),v_business_date,'mod-a-v1');
  INSERT INTO platform.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,correlation_id,occurred_at,business_date)
  VALUES (gen_random_uuid(),v_tenant_id,'pricing.quote.snapshotted.v1','pricing.quote_snapshot',v_id::text,'1.0',jsonb_build_object('snapshotId',v_id,'variantId',p_snapshot->>'variantId','totalMinor',p_snapshot->>'totalMinor','currency',p_snapshot->>'currency','calculationHash',p_snapshot->>'calculationHash'),jsonb_build_object('requestId',p_request_id),p_request_id,v_created_at,v_business_date);
  UPDATE platform.idempotency_records SET status='completed',response_status=201,response_json=jsonb_build_object('snapshotId',v_id),resource_type='pricing.quote_snapshot',resource_id=v_id::text,updated_at=now() WHERE tenant_id=v_tenant_id AND scope='pricing.quote.snapshot' AND idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT q.id,q.variant_id,q.price_list_id,q.price_rule_id,q.currency::text,q.money_scale,q.unit_price_minor,q.quantity_minor,q.quantity_scale,q.subtotal_minor,q.discount_minor,q.total_minor,q.promotion_ids,q.calculation_hash,false,q.created_at FROM pricing.quote_snapshots q WHERE q.tenant_id=v_tenant_id AND q.id=v_id;
END $$;

CREATE OR REPLACE FUNCTION pricing.request_manual_discount_approval(p_approval_id uuid,p_target_type text,p_target_id text,p_currency text,p_scale integer,p_original_amount_minor numeric,p_requested_discount_minor numeric,p_minimum_allowed_amount_minor numeric,p_reason text,p_request_id text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,platform,pricing AS $$
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE='42501'; END IF;
  IF char_length(btrim(p_reason))<4 OR char_length(p_reason)>500 THEN RAISE EXCEPTION 'discount reason is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO pricing.manual_discount_requests(id,tenant_id,target_type,target_id,currency,money_scale,original_amount_minor,requested_discount_minor,minimum_allowed_amount_minor,reason,requested_by,request_id)
  VALUES (p_approval_id,v_tenant_id,p_target_type,p_target_id,upper(p_currency),p_scale,p_original_amount_minor,p_requested_discount_minor,p_minimum_allowed_amount_minor,btrim(p_reason),v_actor_id,p_request_id);
  INSERT INTO platform.approval_requests(id,tenant_id,action_code,requested_by,target_type,target_id,reason,status,payload_hash)
  VALUES (p_approval_id,v_tenant_id,'pricing.discount.approve',v_actor_id,p_target_type,p_target_id,btrim(p_reason),'pending',encode(public.digest(concat_ws('|',p_target_type,p_target_id,p_currency,p_scale,p_original_amount_minor,p_requested_discount_minor,p_minimum_allowed_amount_minor),'sha256'),'hex'));
  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,reason,request_id,trace_id,metadata,business_date,source_version)
  VALUES (gen_random_uuid(),v_tenant_id,'pricing.manual_discount.requested.v1','pricing.discount.apply','pending',v_actor_id,p_target_type,p_target_id,btrim(p_reason),p_request_id,v_trace_id,jsonb_build_object('approvalId',p_approval_id,'requestedDiscountMinor',p_requested_discount_minor,'currency',upper(p_currency)),v_business_date,'mod-a-v1');
END $$;

INSERT INTO platform.permissions(code,module,description,risk_level) VALUES
('pricing.price.read','pricing','Resolve prices and read price lists','standard'),
('pricing.price.manage','pricing','Create price lists and rules','sensitive'),
('pricing.price.publish','pricing','Publish effective price list versions','privileged'),
('pricing.promotion.manage','pricing','Manage promotions and coupons','sensitive'),
('pricing.discount.apply','pricing','Apply discounts within assigned limits','sensitive'),
('pricing.discount.approve','pricing','Approve controlled manual discounts','privileged')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description,risk_level=EXCLUDED.risk_level;

GRANT USAGE ON SCHEMA pricing TO store_app_runtime,store_app_reporting;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pricing TO store_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA pricing TO store_app_reporting;
REVOKE UPDATE,DELETE ON pricing.price_list_versions,pricing.price_rules,pricing.promotion_versions,pricing.coupon_redemptions,pricing.quote_snapshots,pricing.manual_discount_requests,pricing.manual_discount_actions FROM store_app_runtime;
REVOKE DELETE ON pricing.price_lists,pricing.promotions,pricing.coupons FROM store_app_runtime;
REVOKE ALL ON FUNCTION pricing.record_quote_snapshot(text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pricing.request_manual_discount_approval(uuid,text,text,text,integer,numeric,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pricing.record_quote_snapshot(text,text,jsonb,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pricing.request_manual_discount_approval(uuid,text,text,text,integer,numeric,numeric,numeric,text,text) TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pricing GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO store_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pricing GRANT SELECT ON TABLES TO store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id,module,checksum) VALUES ('PRC-0001','MOD-A-PRICING','manifest:PRC-0001-core.sql') ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
