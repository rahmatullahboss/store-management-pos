BEGIN;

CREATE OR REPLACE FUNCTION localization.activate_country_pack(
  p_activation_id uuid, p_tenant_id uuid, p_legal_entity_id uuid, p_store_id uuid,
  p_pack_version_id uuid, p_effective_from date, p_approved_by uuid,
  p_reason text, p_idempotency_key text, p_request_hash text
) RETURNS TABLE(activation_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_existing localization.country_pack_activations%ROWTYPE;
  v_pack localization.country_pack_versions%ROWTYPE;
  v_previous_id uuid;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM localization.country_pack_activations
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'country-pack activation idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_legal_entity_id::text, COALESCE(p_store_id::text, 'all-stores')), 0
  ));
  SELECT * INTO v_pack FROM localization.country_pack_versions
  WHERE tenant_id = p_tenant_id AND id = p_pack_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'country-pack version not found' USING ERRCODE = 'P0002'; END IF;
  IF p_effective_from < v_pack.effective_from OR (v_pack.effective_to IS NOT NULL AND p_effective_from > v_pack.effective_to) THEN
    RAISE EXCEPTION 'activation date is outside the country-pack effective range' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_previous_id FROM localization.country_pack_activations
  WHERE tenant_id = p_tenant_id AND legal_entity_id = p_legal_entity_id
    AND store_id IS NOT DISTINCT FROM p_store_id AND status = 'active' FOR UPDATE;
  IF v_previous_id IS NOT NULL THEN
    UPDATE localization.country_pack_activations
    SET status = 'superseded', effective_to = p_effective_from - 1, version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_previous_id;
  END IF;

  INSERT INTO localization.country_pack_activations(
    id, tenant_id, legal_entity_id, store_id, pack_version_id, effective_from,
    previous_activation_id, approved_by, reason, idempotency_key, request_hash
  ) VALUES (
    p_activation_id, p_tenant_id, p_legal_entity_id, p_store_id, p_pack_version_id, p_effective_from,
    v_previous_id, p_approved_by, p_reason, p_idempotency_key, p_request_hash
  );
  RETURN QUERY SELECT p_activation_id, false;
END $$;

CREATE OR REPLACE FUNCTION localization.allocate_legal_number(
  p_allocation_id uuid, p_tenant_id uuid, p_scope_id uuid, p_business_date date,
  p_operation_id text, p_allocation_mode text, p_device_id text,
  p_allocated_by uuid, p_request_id text, p_trace_id text
) RETURNS TABLE(allocation_id uuid, legal_number text, numeric_value numeric, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_scope localization.legal_number_scopes%ROWTYPE;
  v_existing localization.legal_number_allocations%ROWTYPE;
  v_value numeric(40,0);
  v_legal_number text;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM localization.legal_number_allocations
  WHERE tenant_id = p_tenant_id AND scope_id = p_scope_id AND operation_id = p_operation_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.legal_number, v_existing.numeric_value, true;
    RETURN;
  END IF;

  SELECT * INTO v_scope FROM localization.legal_number_scopes
  WHERE tenant_id = p_tenant_id AND id = p_scope_id FOR UPDATE;
  IF NOT FOUND OR v_scope.status <> 'active' THEN
    RAISE EXCEPTION 'active legal-number scope not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_business_date < v_scope.effective_from OR (v_scope.effective_to IS NOT NULL AND p_business_date > v_scope.effective_to) THEN
    RAISE EXCEPTION 'legal-number scope is not effective' USING ERRCODE = '22023';
  END IF;
  IF p_allocation_mode = 'offline_block' AND (NOT v_scope.offline_allocation_allowed OR p_device_id IS NULL) THEN
    RAISE EXCEPTION 'offline legal-number allocation is unsupported' USING ERRCODE = '42501';
  END IF;
  IF v_scope.next_value > v_scope.maximum_value THEN
    UPDATE localization.legal_number_scopes SET status = 'exhausted', version = version + 1
    WHERE tenant_id = p_tenant_id AND id = p_scope_id;
    RAISE EXCEPTION 'legal-number range is exhausted' USING ERRCODE = '22000';
  END IF;

  v_value := v_scope.next_value;
  v_legal_number := v_scope.prefix || lpad(v_value::text, v_scope.width, '0') || v_scope.suffix;
  INSERT INTO localization.legal_number_allocations(
    id, tenant_id, scope_id, operation_id, numeric_value, legal_number,
    allocation_mode, device_id, allocated_by, request_id, trace_id
  ) VALUES (
    p_allocation_id, p_tenant_id, p_scope_id, p_operation_id, v_value, v_legal_number,
    p_allocation_mode, p_device_id, p_allocated_by, p_request_id, p_trace_id
  );
  UPDATE localization.legal_number_scopes
  SET next_value = next_value + 1,
      status = CASE WHEN next_value + 1 > maximum_value THEN 'exhausted' ELSE status END,
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_scope_id;
  RETURN QUERY SELECT p_allocation_id, v_legal_number, v_value, false;
END $$;

CREATE OR REPLACE FUNCTION localization.record_fiscal_transition(
  p_event_id uuid, p_tenant_id uuid, p_submission_id uuid, p_new_status text,
  p_provider_reference text, p_rejection_code text, p_observed_at timestamptz,
  p_actor_id uuid, p_request_id text, p_trace_id text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_submission localization.fiscal_submissions%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_submission FROM localization.fiscal_submissions
  WHERE tenant_id = p_tenant_id AND id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal submission not found' USING ERRCODE = 'P0002'; END IF;
  v_allowed := CASE v_submission.status
    WHEN 'pending' THEN p_new_status IN ('pending','accepted','rejected','unknown')
    WHEN 'unknown' THEN p_new_status IN ('unknown','accepted','rejected')
    WHEN 'rejected' THEN p_new_status IN ('rejected','corrected')
    WHEN 'accepted' THEN p_new_status IN ('accepted','corrected')
    WHEN 'corrected' THEN p_new_status = 'corrected'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid fiscal transition: % -> %', v_submission.status, p_new_status USING ERRCODE = '22023';
  END IF;
  INSERT INTO localization.fiscal_submission_events(
    id, tenant_id, fiscal_submission_id, prior_status, new_status,
    provider_reference, rejection_code, observed_at, actor_id, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_submission_id, v_submission.status, p_new_status,
    p_provider_reference, p_rejection_code, p_observed_at, p_actor_id, p_request_id, p_trace_id
  );
  UPDATE localization.fiscal_submissions
  SET status = p_new_status, provider_reference = COALESCE(p_provider_reference, provider_reference),
      last_observed_at = p_observed_at, version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_submission_id;
  RETURN p_new_status;
END $$;

REVOKE ALL ON FUNCTION localization.activate_country_pack(uuid,uuid,uuid,uuid,uuid,date,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.allocate_legal_number(uuid,uuid,uuid,date,text,text,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.record_fiscal_transition(uuid,uuid,uuid,text,text,text,timestamptz,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION localization.activate_country_pack(uuid,uuid,uuid,uuid,uuid,date,uuid,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.allocate_legal_number(uuid,uuid,uuid,date,text,text,text,uuid,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.record_fiscal_transition(uuid,uuid,uuid,text,text,text,timestamptz,uuid,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('LOC-0002','MOD-F-LOCALIZATION','manifest:LOC-0002-localization-commands.sql');

COMMIT;
