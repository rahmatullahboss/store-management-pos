BEGIN;

CREATE OR REPLACE FUNCTION localization.publish_command_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, localization, platform AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_tenant_id uuid := NULLIF(v_row ->> 'tenant_id', '')::uuid;
  v_event_type text;
  v_action text;
  v_aggregate_type text;
  v_aggregate_id text := v_row ->> 'id';
  v_actor_id uuid;
  v_request_id text;
  v_trace_id text;
  v_business_date date;
  v_occurred_at timestamptz;
  v_payload jsonb;
BEGIN
  IF v_tenant_id IS NULL OR v_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'localization evidence tenant context mismatch' USING ERRCODE = '42501';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'country_pack_versions' THEN
      IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
      v_event_type := 'localization.country_pack.published.v1';
      v_action := 'localization.country_pack.publish';
      v_aggregate_type := 'localization.country_pack_version';
    WHEN 'country_pack_activations' THEN
      IF TG_OP = 'UPDATE' AND (v_old ->> 'status') IS NOT DISTINCT FROM (v_row ->> 'status') THEN RETURN NEW; END IF;
      v_event_type := CASE
        WHEN TG_OP = 'INSERT' THEN 'localization.country_pack.activated.v1'
        ELSE 'localization.country_pack.activation_status_changed.v1'
      END;
      v_action := CASE
        WHEN TG_OP = 'INSERT' THEN 'localization.country_pack.activate'
        ELSE 'localization.country_pack.activation_status_change'
      END;
      v_aggregate_type := 'localization.country_pack_activation';
    WHEN 'legal_number_allocations' THEN
      IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
      v_event_type := 'localization.legal_number.allocated.v1';
      v_action := 'localization.legal_number.allocate';
      v_aggregate_type := 'localization.legal_number_allocation';
    WHEN 'legal_documents' THEN
      IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
      v_event_type := 'localization.legal_document.published.v1';
      v_action := 'localization.legal_document.publish';
      v_aggregate_type := 'localization.legal_document';
    WHEN 'fiscal_submissions' THEN
      IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
      v_event_type := 'localization.fiscal_submission.created.v1';
      v_action := 'localization.fiscal_submission.create';
      v_aggregate_type := 'localization.fiscal_submission';
    WHEN 'fiscal_submission_events' THEN
      IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
      v_event_type := 'localization.fiscal_submission.status_observed.v1';
      v_action := 'localization.fiscal_submission.observe_status';
      v_aggregate_type := 'localization.fiscal_submission';
      v_aggregate_id := v_row ->> 'fiscal_submission_id';
    WHEN 'retention_policies' THEN
      IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
      v_event_type := 'localization.retention_policy.published.v1';
      v_action := 'localization.retention_policy.publish';
      v_aggregate_type := 'localization.retention_policy';
    WHEN 'privacy_operations' THEN
      IF TG_OP = 'UPDATE' AND (v_old ->> 'status') IS NOT DISTINCT FROM (v_row ->> 'status') THEN RETURN NEW; END IF;
      v_event_type := CASE
        WHEN TG_OP = 'INSERT' THEN 'localization.privacy_operation.requested.v1'
        ELSE 'localization.privacy_operation.status_changed.v1'
      END;
      v_action := CASE
        WHEN TG_OP = 'INSERT' THEN 'localization.privacy_operation.request'
        ELSE 'localization.privacy_operation.transition'
      END;
      v_aggregate_type := 'localization.privacy_operation';
    ELSE
      RETURN NEW;
  END CASE;

  v_actor_id := COALESCE(
    NULLIF(v_row ->> 'published_by', '')::uuid,
    NULLIF(v_row ->> 'approved_by', '')::uuid,
    NULLIF(v_row ->> 'allocated_by', '')::uuid,
    NULLIF(v_row ->> 'issued_by', '')::uuid,
    NULLIF(v_row ->> 'requested_by', '')::uuid,
    NULLIF(v_row ->> 'created_by', '')::uuid,
    NULLIF(v_row ->> 'actor_id', '')::uuid,
    platform.current_actor_id()
  );
  v_request_id := COALESCE(NULLIF(v_row ->> 'request_id', ''), platform.current_request_id(), v_event_type || ':' || v_aggregate_id);
  v_trace_id := COALESCE(NULLIF(v_row ->> 'trace_id', ''), platform.current_trace_id(), v_request_id);
  v_business_date := COALESCE(
    NULLIF(v_row ->> 'business_date', '')::date,
    NULLIF(v_row ->> 'effective_from', '')::date,
    NULLIF(v_row ->> 'requested_at', '')::timestamptz::date,
    NULLIF(v_row ->> 'issued_at', '')::timestamptz::date,
    NULLIF(v_row ->> 'submitted_at', '')::timestamptz::date,
    NULLIF(v_row ->> 'observed_at', '')::timestamptz::date,
    NULLIF(v_row ->> 'activated_at', '')::timestamptz::date,
    NULLIF(v_row ->> 'allocated_at', '')::timestamptz::date,
    platform.current_business_date()
  );
  IF v_business_date IS NULL THEN
    RAISE EXCEPTION 'localization evidence business date is required' USING ERRCODE = '22023';
  END IF;
  v_occurred_at := COALESCE(
    NULLIF(v_row ->> 'published_at', '')::timestamptz,
    NULLIF(v_row ->> 'activated_at', '')::timestamptz,
    NULLIF(v_row ->> 'allocated_at', '')::timestamptz,
    NULLIF(v_row ->> 'issued_at', '')::timestamptz,
    NULLIF(v_row ->> 'submitted_at', '')::timestamptz,
    NULLIF(v_row ->> 'observed_at', '')::timestamptz,
    NULLIF(v_row ->> 'requested_at', '')::timestamptz,
    now()
  );

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'id', v_aggregate_id,
    'eventRecordId', CASE WHEN v_aggregate_id IS DISTINCT FROM (v_row ->> 'id') THEN v_row ->> 'id' ELSE NULL END,
    'packId', v_row ->> 'pack_id',
    'packVersion', v_row ->> 'version',
    'packVersionId', v_row ->> 'pack_version_id',
    'supportLevel', v_row ->> 'support_level',
    'legalEntityId', v_row ->> 'legal_entity_id',
    'storeId', v_row ->> 'store_id',
    'scopeId', v_row ->> 'scope_id',
    'documentType', v_row ->> 'document_type',
    'businessDate', v_row ->> 'business_date',
    'countryPackVersion', v_row ->> 'country_pack_version',
    'operationType', v_row ->> 'operation_type',
    'status', v_row ->> 'status',
    'priorStatus', COALESCE(v_row ->> 'prior_status', v_old ->> 'status'),
    'newStatus', COALESCE(v_row ->> 'new_status', v_row ->> 'status'),
    'effectiveFrom', v_row ->> 'effective_from',
    'effectiveTo', v_row ->> 'effective_to'
  ));

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_event_type, v_action, 'success', v_actor_id,
    v_aggregate_type, v_aggregate_id, v_request_id, v_trace_id,
    jsonb_build_object('schemaVersion', '1.0', 'eventPayload', v_payload),
    v_occurred_at, v_business_date, 'mod-f-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_event_type, v_aggregate_type, v_aggregate_id, '1.0',
    v_payload,
    jsonb_build_object('requestId', v_request_id, 'traceId', v_trace_id, 'source', 'mod-f'),
    v_request_id, v_occurred_at, v_business_date
  );

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION localization.publish_command_evidence() FROM PUBLIC;

CREATE TRIGGER country_pack_versions_evidence
  AFTER INSERT ON localization.country_pack_versions
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER country_pack_activations_evidence
  AFTER INSERT OR UPDATE ON localization.country_pack_activations
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER legal_number_allocations_evidence
  AFTER INSERT ON localization.legal_number_allocations
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER legal_documents_evidence
  AFTER INSERT ON localization.legal_documents
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER fiscal_submissions_evidence
  AFTER INSERT ON localization.fiscal_submissions
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER fiscal_submission_events_evidence
  AFTER INSERT ON localization.fiscal_submission_events
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER retention_policies_evidence
  AFTER INSERT ON localization.retention_policies
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();
CREATE TRIGGER privacy_operations_evidence
  AFTER INSERT OR UPDATE ON localization.privacy_operations
  FOR EACH ROW EXECUTE FUNCTION localization.publish_command_evidence();

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('LOC-0005','MOD-F-LOCALIZATION','manifest:LOC-0005-audit-outbox-evidence.sql');

COMMIT;
