BEGIN;

CREATE OR REPLACE FUNCTION pricing.publish_price_list_version(
  p_idempotency_key text,
  p_request_hash text,
  p_price_list jsonb,
  p_version jsonb,
  p_rules jsonb,
  p_request_id text
) RETURNS TABLE(price_list_id uuid, version bigint, status text, replayed boolean, effective_from timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,platform,pricing,catalog AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_root pricing.price_lists%ROWTYPE;
  v_price_list_id uuid := (p_price_list->>'id')::uuid;
  v_version_id uuid := (p_version->>'id')::uuid;
  v_expected bigint := COALESCE((p_price_list->>'expectedCurrentVersion')::bigint,0);
  v_next bigint;
  v_status text := p_version->>'status';
  v_effective_from timestamptz := (p_version->>'effectiveFrom')::timestamptz;
  v_effective_until timestamptz := NULLIF(p_version->>'effectiveUntil','')::timestamptz;
  v_rule jsonb;
  v_rule_count integer := 0;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE='42501'; END IF;
  IF char_length(p_idempotency_key)<8 OR p_request_hash !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION 'invalid idempotency input' USING ERRCODE='22023'; END IF;
  IF v_status NOT IN ('scheduled','active') THEN RAISE EXCEPTION 'published price list status must be scheduled or active' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_rules)<>'array' OR jsonb_array_length(p_rules)=0 THEN RAISE EXCEPTION 'at least one price rule is required' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(COALESCE(p_version->>'reason','')))<4 THEN RAISE EXCEPTION 'publish reason is required' USING ERRCODE='22023'; END IF;
  IF v_effective_until IS NOT NULL AND v_effective_until<=v_effective_from THEN RAISE EXCEPTION 'effective range is invalid' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_existing FROM platform.idempotency_records
  WHERE tenant_id=v_tenant_id AND scope='pricing.price_list.publish' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE='P0001'; END IF;
    IF v_existing.status='completed' THEN
      RETURN QUERY SELECT (v_existing.response_json->>'priceListId')::uuid,(v_existing.response_json->>'version')::bigint,
        v_existing.response_json->>'status',true,(v_existing.response_json->>'effectiveFrom')::timestamptz;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE='55P03';
  END IF;
  INSERT INTO platform.idempotency_records(tenant_id,scope,idempotency_key,request_hash,status)
  VALUES (v_tenant_id,'pricing.price_list.publish',p_idempotency_key,p_request_hash,'processing');

  SELECT * INTO v_root FROM pricing.price_lists WHERE tenant_id=v_tenant_id AND id=v_price_list_id FOR UPDATE;
  IF FOUND THEN
    IF v_root.current_version<>v_expected THEN RAISE EXCEPTION 'price list version conflict' USING ERRCODE='40001'; END IF;
    IF v_root.code<>upper(btrim(p_price_list->>'code')) OR v_root.currency<>upper(p_price_list->>'currency') OR v_root.money_scale<>(p_price_list->>'scale')::integer THEN
      RAISE EXCEPTION 'price list identity fields are immutable' USING ERRCODE='55000';
    END IF;
  ELSE
    IF v_expected<>0 THEN RAISE EXCEPTION 'price list does not exist' USING ERRCODE='40001'; END IF;
    INSERT INTO pricing.price_lists(id,tenant_id,code,display_name,currency,money_scale,current_version,status,created_by,updated_by)
    VALUES (v_price_list_id,v_tenant_id,upper(btrim(p_price_list->>'code')),btrim(p_price_list->>'name'),upper(p_price_list->>'currency'),
      (p_price_list->>'scale')::integer,0,'draft',v_actor_id,v_actor_id)
    RETURNING * INTO v_root;
  END IF;
  v_next := v_root.current_version+1;

  IF EXISTS (
    SELECT 1 FROM pricing.price_list_versions existing
    WHERE existing.tenant_id=v_tenant_id AND existing.price_list_id=v_price_list_id
      AND existing.status IN ('scheduled','active')
      AND existing.legal_entity_id IS NOT DISTINCT FROM NULLIF(p_version->>'legalEntityId','')::uuid
      AND existing.store_id IS NOT DISTINCT FROM NULLIF(p_version->>'storeId','')::uuid
      AND existing.channel IS NOT DISTINCT FROM NULLIF(p_version->>'channel','')
      AND existing.customer_group_id IS NOT DISTINCT FROM NULLIF(p_version->>'customerGroupId','')
      AND tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(v_effective_from,v_effective_until,'[)')
  ) THEN RAISE EXCEPTION 'effective price list scope overlaps an existing published version' USING ERRCODE='23P01'; END IF;

  INSERT INTO pricing.price_list_versions(id,tenant_id,price_list_id,version,status,priority,legal_entity_id,store_id,channel,customer_group_id,effective_from,effective_until,reason,created_by)
  VALUES (v_version_id,v_tenant_id,v_price_list_id,v_next,v_status,COALESCE((p_version->>'priority')::integer,0),
    NULLIF(p_version->>'legalEntityId','')::uuid,NULLIF(p_version->>'storeId','')::uuid,NULLIF(p_version->>'channel',''),
    NULLIF(p_version->>'customerGroupId',''),v_effective_from,v_effective_until,btrim(p_version->>'reason'),v_actor_id);

  FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    v_rule_count := v_rule_count+1;
    INSERT INTO pricing.price_rules(id,tenant_id,price_list_version_id,variant_id,unit_code,minimum_quantity_minor,quantity_scale,
      unit_price_minor,compare_at_price_minor,minimum_margin_basis_points,priority,effective_from,effective_until,rule_version,metadata)
    VALUES ((v_rule->>'id')::uuid,v_tenant_id,v_version_id,(v_rule->>'variantId')::uuid,upper(btrim(v_rule->>'unitCode')),
      (v_rule->>'minimumQuantityMinor')::numeric,(v_rule->>'quantityScale')::integer,(v_rule->>'unitPriceMinor')::numeric,
      NULLIF(v_rule->>'compareAtPriceMinor','')::numeric,NULLIF(v_rule->>'minimumMarginBasisPoints','')::integer,
      COALESCE((v_rule->>'priority')::integer,0),NULLIF(v_rule->>'effectiveFrom','')::timestamptz,
      NULLIF(v_rule->>'effectiveUntil','')::timestamptz,COALESCE((v_rule->>'ruleVersion')::bigint,1),COALESCE(v_rule->'metadata','{}'::jsonb));
  END LOOP;

  UPDATE pricing.price_lists SET display_name=btrim(p_price_list->>'name'),current_version=v_next,
    active_version=CASE WHEN v_status='active' THEN v_next ELSE active_version END,status=v_status,updated_by=v_actor_id,updated_at=now()
  WHERE tenant_id=v_tenant_id AND id=v_price_list_id;

  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,reason,request_id,trace_id,metadata,business_date,source_version)
  VALUES (gen_random_uuid(),v_tenant_id,'pricing.price_list.published.v1','pricing.price.publish','success',v_actor_id,'pricing.price_list',
    v_price_list_id::text,btrim(p_version->>'reason'),p_request_id,v_trace_id,jsonb_build_object('version',v_next,'status',v_status,'ruleCount',v_rule_count,'effectiveFrom',v_effective_from),v_business_date,'mod-a-v1');
  INSERT INTO platform.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,correlation_id,occurred_at,business_date)
  VALUES (gen_random_uuid(),v_tenant_id,'pricing.price_list.published.v1','pricing.price_list',v_price_list_id::text,'1.0',
    jsonb_build_object('priceListId',v_price_list_id,'version',v_next,'currency',upper(p_price_list->>'currency'),'moneyScale',(p_price_list->>'scale')::integer,
      'status',v_status,'effectiveFrom',v_effective_from,'effectiveUntil',v_effective_until,'scope',jsonb_build_object('legalEntityId',p_version->>'legalEntityId','storeId',p_version->>'storeId','channel',p_version->>'channel','customerGroupId',p_version->>'customerGroupId')),
    jsonb_build_object('requestId',p_request_id),p_request_id,now(),v_business_date);

  UPDATE platform.idempotency_records SET status='completed',response_status=201,
    response_json=jsonb_build_object('priceListId',v_price_list_id,'version',v_next,'status',v_status,'effectiveFrom',v_effective_from),
    resource_type='pricing.price_list',resource_id=v_price_list_id::text,updated_at=now()
  WHERE tenant_id=v_tenant_id AND scope='pricing.price_list.publish' AND idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT v_price_list_id,v_next,v_status,false,v_effective_from;
END $$;

CREATE OR REPLACE FUNCTION pricing.publish_promotion_version(
  p_idempotency_key text,
  p_request_hash text,
  p_promotion jsonb,
  p_version jsonb,
  p_request_id text
) RETURNS TABLE(promotion_id uuid, version bigint, status text, replayed boolean, effective_from timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,platform,pricing AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id(); v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE); v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
  v_existing platform.idempotency_records%ROWTYPE; v_root pricing.promotions%ROWTYPE;
  v_id uuid := (p_promotion->>'id')::uuid; v_version_id uuid := (p_version->>'id')::uuid;
  v_expected bigint := COALESCE((p_promotion->>'expectedCurrentVersion')::bigint,0); v_next bigint;
  v_status text := p_version->>'status'; v_from timestamptz := (p_version->>'effectiveFrom')::timestamptz;
  v_until timestamptz := NULLIF(p_version->>'effectiveUntil','')::timestamptz;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE='42501'; END IF;
  IF char_length(p_idempotency_key)<8 OR p_request_hash !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION 'invalid idempotency input' USING ERRCODE='22023'; END IF;
  IF v_status NOT IN ('scheduled','active') OR jsonb_typeof(p_version->'conditions')<>'array' OR jsonb_typeof(p_version->'action')<>'object' THEN RAISE EXCEPTION 'invalid promotion version' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(COALESCE(p_version->>'reason','')))<4 OR (v_until IS NOT NULL AND v_until<=v_from) THEN RAISE EXCEPTION 'invalid promotion reason or range' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_existing FROM platform.idempotency_records WHERE tenant_id=v_tenant_id AND scope='pricing.promotion.publish' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE='P0001'; END IF;
    IF v_existing.status='completed' THEN RETURN QUERY SELECT (v_existing.response_json->>'promotionId')::uuid,(v_existing.response_json->>'version')::bigint,v_existing.response_json->>'status',true,(v_existing.response_json->>'effectiveFrom')::timestamptz; RETURN; END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE='55P03';
  END IF;
  INSERT INTO platform.idempotency_records(tenant_id,scope,idempotency_key,request_hash,status) VALUES(v_tenant_id,'pricing.promotion.publish',p_idempotency_key,p_request_hash,'processing');
  SELECT * INTO v_root FROM pricing.promotions WHERE tenant_id=v_tenant_id AND id=v_id FOR UPDATE;
  IF FOUND THEN
    IF v_root.current_version<>v_expected THEN RAISE EXCEPTION 'promotion version conflict' USING ERRCODE='40001'; END IF;
    IF v_root.code<>upper(btrim(p_promotion->>'code')) THEN RAISE EXCEPTION 'promotion code is immutable' USING ERRCODE='55000'; END IF;
  ELSE
    IF v_expected<>0 THEN RAISE EXCEPTION 'promotion does not exist' USING ERRCODE='40001'; END IF;
    INSERT INTO pricing.promotions(id,tenant_id,code,display_name,current_version,status,created_by,updated_by)
    VALUES(v_id,v_tenant_id,upper(btrim(p_promotion->>'code')),btrim(p_promotion->>'name'),0,'draft',v_actor_id,v_actor_id) RETURNING * INTO v_root;
  END IF;
  v_next:=v_root.current_version+1;
  IF EXISTS(SELECT 1 FROM pricing.promotion_versions e WHERE e.tenant_id=v_tenant_id AND e.promotion_id=v_id AND e.status IN('scheduled','active') AND tstzrange(e.effective_from,e.effective_until,'[)') && tstzrange(v_from,v_until,'[)')) THEN
    RAISE EXCEPTION 'promotion effective range overlaps an existing published version' USING ERRCODE='23P01';
  END IF;
  INSERT INTO pricing.promotion_versions(id,tenant_id,promotion_id,version,status,priority,exclusive,stacking_group,conditions,action,effective_from,effective_until,global_redemption_limit,customer_redemption_limit,reason,created_by)
  VALUES(v_version_id,v_tenant_id,v_id,v_next,v_status,COALESCE((p_version->>'priority')::integer,0),COALESCE((p_version->>'exclusive')::boolean,false),NULLIF(p_version->>'stackingGroup',''),p_version->'conditions',p_version->'action',v_from,v_until,NULLIF(p_version->>'globalRedemptionLimit','')::bigint,NULLIF(p_version->>'customerRedemptionLimit','')::bigint,btrim(p_version->>'reason'),v_actor_id);
  UPDATE pricing.promotions SET display_name=btrim(p_promotion->>'name'),current_version=v_next,active_version=CASE WHEN v_status='active' THEN v_next ELSE active_version END,status=v_status,updated_by=v_actor_id,updated_at=now() WHERE tenant_id=v_tenant_id AND id=v_id;
  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,reason,request_id,trace_id,metadata,business_date,source_version)
  VALUES(gen_random_uuid(),v_tenant_id,'pricing.promotion.changed.v1','pricing.promotion.manage','success',v_actor_id,'pricing.promotion',v_id::text,btrim(p_version->>'reason'),p_request_id,v_trace_id,jsonb_build_object('version',v_next,'status',v_status,'effectiveFrom',v_from),v_business_date,'mod-a-v1');
  INSERT INTO platform.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,correlation_id,occurred_at,business_date)
  VALUES(gen_random_uuid(),v_tenant_id,'pricing.promotion.changed.v1','pricing.promotion',v_id::text,'1.0',jsonb_build_object('promotionId',v_id,'version',v_next,'status',v_status,'effectiveFrom',v_from,'effectiveUntil',v_until),jsonb_build_object('requestId',p_request_id),p_request_id,now(),v_business_date);
  UPDATE platform.idempotency_records SET status='completed',response_status=201,response_json=jsonb_build_object('promotionId',v_id,'version',v_next,'status',v_status,'effectiveFrom',v_from),resource_type='pricing.promotion',resource_id=v_id::text,updated_at=now() WHERE tenant_id=v_tenant_id AND scope='pricing.promotion.publish' AND idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT v_id,v_next,v_status,false,v_from;
END $$;

REVOKE ALL ON FUNCTION pricing.publish_price_list_version(text,text,jsonb,jsonb,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pricing.publish_promotion_version(text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pricing.publish_price_list_version(text,text,jsonb,jsonb,jsonb,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION pricing.publish_promotion_version(text,text,jsonb,jsonb,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id,module,checksum) VALUES('PRC-0003','MOD-A-PRICING','manifest:PRC-0003-publishing.sql') ON CONFLICT(migration_id) DO NOTHING;
COMMIT;
