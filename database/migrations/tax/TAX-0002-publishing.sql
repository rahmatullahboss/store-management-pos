BEGIN;

CREATE OR REPLACE FUNCTION tax.publish_configuration(
  p_idempotency_key text,
  p_request_hash text,
  p_jurisdiction jsonb,
  p_tax_code jsonb,
  p_code_version jsonb,
  p_rates jsonb,
  p_request_id text
) RETURNS TABLE(tax_code_id uuid, version bigint, status text, replayed boolean, effective_from timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,platform,tax AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_business_date date := COALESCE(platform.current_business_date(),CURRENT_DATE);
  v_trace_id text := COALESCE(platform.current_trace_id(),p_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_jurisdiction tax.jurisdictions%ROWTYPE;
  v_root tax.codes%ROWTYPE;
  v_jurisdiction_id uuid := (p_jurisdiction->>'id')::uuid;
  v_code_id uuid := (p_tax_code->>'id')::uuid;
  v_code_version_id uuid := (p_code_version->>'id')::uuid;
  v_expected_jurisdiction bigint := COALESCE((p_jurisdiction->>'expectedVersion')::bigint,0);
  v_expected_code bigint := COALESCE((p_tax_code->>'expectedCurrentVersion')::bigint,0);
  v_next bigint;
  v_status text := p_code_version->>'status';
  v_from timestamptz := (p_code_version->>'effectiveFrom')::timestamptz;
  v_until timestamptz := NULLIF(p_code_version->>'effectiveUntil','')::timestamptz;
  v_rate jsonb;
  v_rate_count integer := 0;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN RAISE EXCEPTION 'request context is required' USING ERRCODE='42501'; END IF;
  IF char_length(p_idempotency_key)<8 OR p_request_hash !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION 'invalid idempotency input' USING ERRCODE='22023'; END IF;
  IF v_status NOT IN ('scheduled','active') THEN RAISE EXCEPTION 'published tax status must be scheduled or active' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_rates)<>'array' OR jsonb_array_length(p_rates)=0 THEN RAISE EXCEPTION 'at least one tax rate is required' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(COALESCE(p_code_version->>'reason','')))<4 OR (v_until IS NOT NULL AND v_until<=v_from) THEN RAISE EXCEPTION 'invalid tax publish reason or range' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_existing FROM platform.idempotency_records
  WHERE tenant_id=v_tenant_id AND scope='tax.configuration.publish' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE='P0001'; END IF;
    IF v_existing.status='completed' THEN
      RETURN QUERY SELECT (v_existing.response_json->>'taxCodeId')::uuid,(v_existing.response_json->>'version')::bigint,
        v_existing.response_json->>'status',true,(v_existing.response_json->>'effectiveFrom')::timestamptz;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE='55P03';
  END IF;
  INSERT INTO platform.idempotency_records(tenant_id,scope,idempotency_key,request_hash,status)
  VALUES(v_tenant_id,'tax.configuration.publish',p_idempotency_key,p_request_hash,'processing');

  SELECT * INTO v_jurisdiction FROM tax.jurisdictions WHERE tenant_id=v_tenant_id AND id=v_jurisdiction_id FOR UPDATE;
  IF FOUND THEN
    IF v_jurisdiction.version<>v_expected_jurisdiction THEN RAISE EXCEPTION 'tax jurisdiction version conflict' USING ERRCODE='40001'; END IF;
    IF v_jurisdiction.code<>upper(btrim(p_jurisdiction->>'code')) OR v_jurisdiction.country_code<>upper(p_jurisdiction->>'countryCode') THEN
      RAISE EXCEPTION 'tax jurisdiction identity fields are immutable' USING ERRCODE='55000';
    END IF;
    UPDATE tax.jurisdictions SET display_name=btrim(p_jurisdiction->>'name'),parent_id=NULLIF(p_jurisdiction->>'parentId','')::uuid,
      priority=COALESCE((p_jurisdiction->>'priority')::integer,0),status='active',updated_by=v_actor_id,updated_at=now(),version=version+1
    WHERE tenant_id=v_tenant_id AND id=v_jurisdiction_id RETURNING * INTO v_jurisdiction;
  ELSE
    IF v_expected_jurisdiction<>0 THEN RAISE EXCEPTION 'tax jurisdiction does not exist' USING ERRCODE='40001'; END IF;
    INSERT INTO tax.jurisdictions(id,tenant_id,parent_id,code,display_name,country_code,priority,status,metadata,created_by,updated_by)
    VALUES(v_jurisdiction_id,v_tenant_id,NULLIF(p_jurisdiction->>'parentId','')::uuid,upper(btrim(p_jurisdiction->>'code')),btrim(p_jurisdiction->>'name'),
      upper(p_jurisdiction->>'countryCode'),COALESCE((p_jurisdiction->>'priority')::integer,0),'active',COALESCE(p_jurisdiction->'metadata','{}'::jsonb),v_actor_id,v_actor_id)
    RETURNING * INTO v_jurisdiction;
  END IF;

  SELECT * INTO v_root FROM tax.codes WHERE tenant_id=v_tenant_id AND id=v_code_id FOR UPDATE;
  IF FOUND THEN
    IF v_root.current_version<>v_expected_code THEN RAISE EXCEPTION 'tax code version conflict' USING ERRCODE='40001'; END IF;
    IF v_root.code<>upper(btrim(p_tax_code->>'code')) THEN RAISE EXCEPTION 'tax code is immutable' USING ERRCODE='55000'; END IF;
  ELSE
    IF v_expected_code<>0 THEN RAISE EXCEPTION 'tax code does not exist' USING ERRCODE='40001'; END IF;
    INSERT INTO tax.codes(id,tenant_id,code,display_name,current_version,status,created_by,updated_by)
    VALUES(v_code_id,v_tenant_id,upper(btrim(p_tax_code->>'code')),btrim(p_tax_code->>'name'),0,'active',v_actor_id,v_actor_id)
    RETURNING * INTO v_root;
  END IF;
  v_next:=v_root.current_version+1;

  IF EXISTS(SELECT 1 FROM tax.code_versions existing WHERE existing.tenant_id=v_tenant_id AND existing.tax_code_id=v_code_id
    AND existing.status IN('scheduled','active') AND tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(v_from,v_until,'[)')) THEN
    RAISE EXCEPTION 'tax code effective range overlaps an existing published version' USING ERRCODE='23P01';
  END IF;

  INSERT INTO tax.code_versions(id,tenant_id,tax_code_id,version,default_treatment,price_mode,rounding_mode,effective_from,effective_until,reason,status,created_by)
  VALUES(v_code_version_id,v_tenant_id,v_code_id,v_next,p_code_version->>'defaultTreatment',p_code_version->>'priceMode',p_code_version->>'roundingMode',
    v_from,v_until,btrim(p_code_version->>'reason'),v_status,v_actor_id);

  FOR v_rate IN SELECT value FROM jsonb_array_elements(p_rates) LOOP
    v_rate_count:=v_rate_count+1;
    IF (v_rate->>'rateBasisPoints')::integer<0 OR (v_rate->>'rateBasisPoints')::integer>10000 OR
       COALESCE((v_rate->>'recoverableBasisPoints')::integer,0)<0 OR COALESCE((v_rate->>'recoverableBasisPoints')::integer,0)>10000 THEN
      RAISE EXCEPTION 'tax rate basis points are invalid' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM tax.rate_versions existing WHERE existing.tenant_id=v_tenant_id AND existing.tax_code_id=v_code_id
      AND existing.jurisdiction_id=v_jurisdiction_id AND existing.code=upper(btrim(v_rate->>'code')) AND existing.status IN('scheduled','active')
      AND tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(COALESCE(NULLIF(v_rate->>'effectiveFrom','')::timestamptz,v_from),COALESCE(NULLIF(v_rate->>'effectiveUntil','')::timestamptz,v_until),'[)')) THEN
      RAISE EXCEPTION 'tax rate effective range overlaps an existing published version' USING ERRCODE='23P01';
    END IF;
    INSERT INTO tax.rate_versions(id,tenant_id,tax_code_id,jurisdiction_id,code,display_name,rate_basis_points,compound,recoverable_basis_points,
      effective_from,effective_until,priority,version,reason,status,created_by)
    VALUES((v_rate->>'id')::uuid,v_tenant_id,v_code_id,v_jurisdiction_id,upper(btrim(v_rate->>'code')),btrim(v_rate->>'name'),
      (v_rate->>'rateBasisPoints')::integer,COALESCE((v_rate->>'compound')::boolean,false),COALESCE((v_rate->>'recoverableBasisPoints')::integer,0),
      COALESCE(NULLIF(v_rate->>'effectiveFrom','')::timestamptz,v_from),COALESCE(NULLIF(v_rate->>'effectiveUntil','')::timestamptz,v_until),
      COALESCE((v_rate->>'priority')::integer,0),v_next,btrim(p_code_version->>'reason'),v_status,v_actor_id);
  END LOOP;

  UPDATE tax.codes SET display_name=btrim(p_tax_code->>'name'),current_version=v_next,
    active_version=CASE WHEN v_status='active' THEN v_next ELSE active_version END,status='active',updated_by=v_actor_id,updated_at=now()
  WHERE tenant_id=v_tenant_id AND id=v_code_id;

  INSERT INTO platform.audit_events(id,tenant_id,event_type,action,outcome,actor_id,target_type,target_id,reason,request_id,trace_id,metadata,business_date,source_version)
  VALUES(gen_random_uuid(),v_tenant_id,'tax.configuration.published.v1','tax.configuration.publish','success',v_actor_id,'tax.code',v_code_id::text,
    btrim(p_code_version->>'reason'),p_request_id,v_trace_id,jsonb_build_object('version',v_next,'status',v_status,'jurisdictionId',v_jurisdiction_id,'rateCount',v_rate_count,'effectiveFrom',v_from),v_business_date,'mod-a-v1');
  INSERT INTO platform.outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,schema_version,payload,metadata,correlation_id,occurred_at,business_date)
  VALUES(gen_random_uuid(),v_tenant_id,'tax.configuration.published.v1','tax.code',v_code_id::text,'1.0',
    jsonb_build_object('taxCodeId',v_code_id,'taxCodeVersion',v_next,'jurisdictionId',v_jurisdiction_id,'status',v_status,'effectiveFrom',v_from,'effectiveUntil',v_until,
      'rateVersions',(SELECT jsonb_agg(jsonb_build_object('rateId',value->>'id','version',v_next,'rateBasisPoints',value->>'rateBasisPoints','compound',COALESCE((value->>'compound')::boolean,false))) FROM jsonb_array_elements(p_rates))),
    jsonb_build_object('requestId',p_request_id),p_request_id,now(),v_business_date);

  UPDATE platform.idempotency_records SET status='completed',response_status=201,
    response_json=jsonb_build_object('taxCodeId',v_code_id,'version',v_next,'status',v_status,'effectiveFrom',v_from),
    resource_type='tax.code',resource_id=v_code_id::text,updated_at=now()
  WHERE tenant_id=v_tenant_id AND scope='tax.configuration.publish' AND idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT v_code_id,v_next,v_status,false,v_from;
END $$;

REVOKE ALL ON FUNCTION tax.publish_configuration(text,text,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tax.publish_configuration(text,text,jsonb,jsonb,jsonb,jsonb,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id,module,checksum)
VALUES('TAX-0002','MOD-A-TAX','manifest:TAX-0002-publishing.sql') ON CONFLICT(migration_id) DO NOTHING;
COMMIT;
