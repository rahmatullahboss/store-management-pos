BEGIN;

CREATE OR REPLACE FUNCTION localization.publish_legal_document(
  p_document_id uuid, p_tenant_id uuid, p_legal_entity_id uuid, p_store_id uuid,
  p_document_type text, p_legal_number text, p_business_date date, p_issued_at timestamptz,
  p_pack_version_id uuid, p_template_id text, p_template_version text,
  p_tax_rule_version text, p_currency_metadata_version text,
  p_source_type text, p_source_id text, p_source_version text,
  p_totals jsonb, p_semantic_payload_hash text, p_rendered_document_hash text,
  p_archive_object_key text, p_fiscal_status text, p_correction_of_document_id uuid,
  p_issued_by uuid, p_request_id text, p_trace_id text
) RETURNS TABLE(document_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_existing localization.legal_documents%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM localization.legal_documents
  WHERE tenant_id = p_tenant_id
    AND source_type = p_source_type
    AND source_id = p_source_id
    AND source_version = p_source_version
    AND document_type = p_document_type;
  IF FOUND THEN
    IF v_existing.legal_number IS DISTINCT FROM p_legal_number
       OR v_existing.pack_version_id IS DISTINCT FROM p_pack_version_id
       OR v_existing.template_id IS DISTINCT FROM p_template_id
       OR v_existing.template_version IS DISTINCT FROM p_template_version
       OR v_existing.tax_rule_version IS DISTINCT FROM p_tax_rule_version
       OR v_existing.currency_metadata_version IS DISTINCT FROM p_currency_metadata_version
       OR v_existing.semantic_payload_hash IS DISTINCT FROM p_semantic_payload_hash
       OR v_existing.rendered_document_hash IS DISTINCT FROM p_rendered_document_hash
       OR v_existing.archive_object_key IS DISTINCT FROM p_archive_object_key THEN
      RAISE EXCEPTION 'legal-document replay payload differs' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO localization.legal_documents(
    id, tenant_id, legal_entity_id, store_id, document_type, legal_number,
    business_date, issued_at, pack_version_id, template_id, template_version,
    tax_rule_version, currency_metadata_version, source_type, source_id, source_version,
    totals, semantic_payload_hash, rendered_document_hash, archive_object_key,
    fiscal_status, correction_of_document_id, issued_by, request_id, trace_id
  ) VALUES (
    p_document_id, p_tenant_id, p_legal_entity_id, p_store_id, p_document_type, p_legal_number,
    p_business_date, p_issued_at, p_pack_version_id, p_template_id, p_template_version,
    p_tax_rule_version, p_currency_metadata_version, p_source_type, p_source_id, p_source_version,
    p_totals, p_semantic_payload_hash, p_rendered_document_hash, p_archive_object_key,
    p_fiscal_status, p_correction_of_document_id, p_issued_by, p_request_id, p_trace_id
  );
  RETURN QUERY SELECT p_document_id, false;
END $$;

CREATE OR REPLACE FUNCTION localization.create_fiscal_submission(
  p_submission_id uuid, p_tenant_id uuid, p_document_id uuid,
  p_provider_capability_id text, p_country_pack_version text, p_payload_hash text,
  p_idempotency_key text, p_request_hash text, p_submitted_at timestamptz
) RETURNS TABLE(submission_id uuid, status text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_existing localization.fiscal_submissions%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM localization.fiscal_submissions
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'fiscal submission idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.status, true;
    RETURN;
  END IF;
  INSERT INTO localization.fiscal_submissions(
    id, tenant_id, document_id, provider_capability_id, country_pack_version,
    payload_hash, idempotency_key, request_hash, status, submitted_at, last_observed_at
  ) VALUES (
    p_submission_id, p_tenant_id, p_document_id, p_provider_capability_id, p_country_pack_version,
    p_payload_hash, p_idempotency_key, p_request_hash, 'pending', p_submitted_at, p_submitted_at
  );
  RETURN QUERY SELECT p_submission_id, 'pending'::text, false;
END $$;

CREATE OR REPLACE FUNCTION localization.create_privacy_operation(
  p_operation_id uuid, p_tenant_id uuid, p_subject_reference text,
  p_operation_type text, p_retention_policy_id uuid, p_reason text,
  p_requested_by uuid, p_requested_at timestamptz,
  p_idempotency_key text, p_request_hash text
) RETURNS TABLE(operation_id uuid, status text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_existing localization.privacy_operations%ROWTYPE;
  v_policy localization.retention_policies%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM localization.privacy_operations
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'privacy operation idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.status, true;
    RETURN;
  END IF;
  SELECT * INTO v_policy FROM localization.retention_policies
  WHERE tenant_id = p_tenant_id AND id = p_retention_policy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'retention policy not found' USING ERRCODE = 'P0002'; END IF;
  IF p_requested_at::date < v_policy.effective_from
     OR (v_policy.effective_to IS NOT NULL AND p_requested_at::date > v_policy.effective_to) THEN
    RAISE EXCEPTION 'retention policy is not effective' USING ERRCODE = '22023';
  END IF;
  IF p_operation_type = 'erase' AND v_policy.immutable_evidence_required AND NOT v_policy.anonymization_allowed THEN
    RAISE EXCEPTION 'erasure is blocked by immutable evidence retention' USING ERRCODE = '42501';
  END IF;
  INSERT INTO localization.privacy_operations(
    id, tenant_id, subject_reference, operation_type, retention_policy_id,
    status, reason, requested_by, requested_at, idempotency_key, request_hash
  ) VALUES (
    p_operation_id, p_tenant_id, p_subject_reference, p_operation_type, p_retention_policy_id,
    'requested', p_reason, p_requested_by, p_requested_at, p_idempotency_key, p_request_hash
  );
  RETURN QUERY SELECT p_operation_id, 'requested'::text, false;
END $$;

CREATE OR REPLACE FUNCTION localization.transition_privacy_operation(
  p_tenant_id uuid, p_operation_id uuid, p_new_status text,
  p_preserved_evidence_references text[], p_affected_resource_references text[],
  p_completed_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_operation localization.privacy_operations%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_operation FROM localization.privacy_operations
  WHERE tenant_id = p_tenant_id AND id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy operation not found' USING ERRCODE = 'P0002'; END IF;
  v_allowed := CASE v_operation.status
    WHEN 'requested' THEN p_new_status IN ('requested','approved','rejected')
    WHEN 'approved' THEN p_new_status IN ('approved','running','rejected')
    WHEN 'running' THEN p_new_status IN ('running','completed','partially_completed','rejected')
    WHEN 'completed' THEN p_new_status = 'completed'
    WHEN 'partially_completed' THEN p_new_status IN ('partially_completed','completed')
    WHEN 'rejected' THEN p_new_status = 'rejected'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid privacy transition: % -> %', v_operation.status, p_new_status USING ERRCODE = '22023';
  END IF;
  UPDATE localization.privacy_operations
  SET status = p_new_status,
      preserved_evidence_references = COALESCE(p_preserved_evidence_references, preserved_evidence_references),
      affected_resource_references = COALESCE(p_affected_resource_references, affected_resource_references),
      completed_at = CASE WHEN p_new_status IN ('completed','partially_completed','rejected') THEN p_completed_at ELSE completed_at END,
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_operation_id;
  RETURN p_new_status;
END $$;

REVOKE ALL ON FUNCTION localization.publish_legal_document(uuid,uuid,uuid,uuid,text,text,date,timestamptz,uuid,text,text,text,text,text,text,text,jsonb,text,text,text,text,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.create_fiscal_submission(uuid,uuid,uuid,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.create_privacy_operation(uuid,uuid,text,text,uuid,text,uuid,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION localization.transition_privacy_operation(uuid,uuid,text,text[],text[],timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION localization.publish_legal_document(uuid,uuid,uuid,uuid,text,text,date,timestamptz,uuid,text,text,text,text,text,text,text,jsonb,text,text,text,text,uuid,uuid,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.create_fiscal_submission(uuid,uuid,uuid,text,text,text,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.create_privacy_operation(uuid,uuid,text,text,uuid,text,uuid,timestamptz,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION localization.transition_privacy_operation(uuid,uuid,text,text[],text[],timestamptz) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('LOC-0003','MOD-F-LOCALIZATION','manifest:LOC-0003-compliance-commands.sql');

COMMIT;
