BEGIN;

ALTER TABLE reporting.metric_definitions
  ADD COLUMN idempotency_key text NOT NULL,
  ADD COLUMN request_hash text NOT NULL,
  ADD CONSTRAINT metric_definitions_idempotency_unique UNIQUE (tenant_id, idempotency_key);

ALTER TABLE reporting.projection_reconciliations
  ADD CONSTRAINT projection_reconciliations_snapshot_unique UNIQUE (tenant_id, metric_snapshot_id);

CREATE OR REPLACE FUNCTION reporting.publish_metric_definition(
  p_id uuid,
  p_tenant_id uuid,
  p_metric_id text,
  p_version text,
  p_owner_module text,
  p_display_name text,
  p_description text,
  p_value_kind text,
  p_formula text,
  p_supported_dimensions text[],
  p_source_event_types text[],
  p_control_total_metric_id text,
  p_freshness_seconds integer,
  p_effective_from timestamptz,
  p_published_by uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(metric_definition_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, reporting, platform AS $$
DECLARE
  v_existing reporting.metric_definitions%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM reporting.metric_definitions
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'metric publication idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO reporting.metric_definitions(
    id, tenant_id, metric_id, version, owner_module, display_name, description,
    value_kind, formula, supported_dimensions, source_event_types,
    control_total_metric_id, freshness_seconds, status, effective_from,
    published_by, idempotency_key, request_hash
  ) VALUES (
    p_id, p_tenant_id, p_metric_id, p_version, p_owner_module, p_display_name, p_description,
    p_value_kind, p_formula, p_supported_dimensions, p_source_event_types,
    p_control_total_metric_id, p_freshness_seconds, 'active', p_effective_from,
    p_published_by, p_idempotency_key, p_request_hash
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.metric.published.v1', 'reporting.metric.publish',
    'success', p_published_by, 'reporting.metric_definition', p_id::text,
    p_request_id, p_trace_id,
    jsonb_build_object('metricId', p_metric_id, 'metricVersion', p_version, 'ownerModule', p_owner_module),
    now(), p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.metric.published.v1',
    'reporting.metric_definition', p_id::text, '1.0',
    jsonb_build_object('metricId', p_metric_id, 'metricVersion', p_version, 'ownerModule', p_owner_module),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, now(), p_business_date
  );

  RETURN QUERY SELECT p_id, false;
END $$;

CREATE OR REPLACE FUNCTION reporting.consume_projection_event(
  p_receipt_id uuid,
  p_cursor_id uuid,
  p_tenant_id uuid,
  p_projection_name text,
  p_source_stream text,
  p_source_event_id text,
  p_source_event_type text,
  p_source_sequence numeric,
  p_aggregate_type text,
  p_aggregate_id text,
  p_payload_hash text,
  p_received_at timestamptz,
  p_business_date date,
  p_request_id text,
  p_trace_id text,
  p_actor_id uuid
) RETURNS TABLE(disposition text, replayed boolean, high_water_sequence numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, reporting, platform AS $$
DECLARE
  v_existing reporting.projection_event_receipts%ROWTYPE;
  v_cursor reporting.projection_cursors%ROWTYPE;
  v_disposition text;
  v_high_water_sequence numeric;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_source_sequence <= 0 THEN
    RAISE EXCEPTION 'projection event sequence must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM reporting.projection_event_receipts
  WHERE tenant_id = p_tenant_id
    AND projection_name = p_projection_name
    AND source_event_id = p_source_event_id;
  IF FOUND THEN
    IF v_existing.payload_hash IS DISTINCT FROM p_payload_hash
       OR v_existing.source_sequence IS DISTINCT FROM p_source_sequence
       OR v_existing.source_event_type IS DISTINCT FROM p_source_event_type THEN
      RAISE EXCEPTION 'projection event replay payload differs' USING ERRCODE = '23505';
    END IF;
    SELECT c.high_water_sequence INTO v_high_water_sequence
    FROM reporting.projection_cursors c
    WHERE c.tenant_id = p_tenant_id
      AND c.projection_name = p_projection_name
      AND c.source_stream = p_source_stream;
    RETURN QUERY SELECT v_existing.disposition, true, COALESCE(v_high_water_sequence, 0);
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_tenant_id::text, p_projection_name, p_source_stream), 0
  ));
  SELECT * INTO v_cursor
  FROM reporting.projection_cursors
  WHERE tenant_id = p_tenant_id
    AND projection_name = p_projection_name
    AND source_stream = p_source_stream
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO reporting.projection_cursors(
      id, tenant_id, projection_name, source_stream, high_water_sequence,
      last_event_id, last_occurred_at, status
    ) VALUES (
      p_cursor_id, p_tenant_id, p_projection_name, p_source_stream, p_source_sequence,
      p_source_event_id, p_received_at, 'fresh'
    );
    v_disposition := 'applied';
    v_high_water_sequence := p_source_sequence;
  ELSIF p_source_sequence <= v_cursor.high_water_sequence THEN
    v_disposition := 'review';
    v_high_water_sequence := v_cursor.high_water_sequence;
  ELSE
    UPDATE reporting.projection_cursors
    SET high_water_sequence = p_source_sequence,
        last_event_id = p_source_event_id,
        last_occurred_at = p_received_at,
        status = 'fresh',
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id AND id = v_cursor.id;
    v_disposition := 'applied';
    v_high_water_sequence := p_source_sequence;
  END IF;

  INSERT INTO reporting.projection_event_receipts(
    id, tenant_id, projection_name, source_event_id, source_event_type,
    source_sequence, aggregate_type, aggregate_id, payload_hash, disposition,
    reason_code, received_at, processed_at, business_date, request_id, trace_id
  ) VALUES (
    p_receipt_id, p_tenant_id, p_projection_name, p_source_event_id, p_source_event_type,
    p_source_sequence, p_aggregate_type, p_aggregate_id, p_payload_hash, v_disposition,
    CASE WHEN v_disposition = 'review' THEN 'OUT_OF_ORDER' ELSE NULL END,
    p_received_at, CASE WHEN v_disposition = 'applied' THEN now() ELSE NULL END,
    p_business_date, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.projection.event_received.v1',
    'reporting.projection.consume', v_disposition, p_actor_id,
    'reporting.projection', p_projection_name, p_request_id, p_trace_id,
    jsonb_build_object(
      'sourceEventId', p_source_event_id,
      'sourceEventType', p_source_event_type,
      'sourceSequence', p_source_sequence::text,
      'aggregateType', p_aggregate_type,
      'aggregateId', p_aggregate_id
    ),
    p_received_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id,
    CASE WHEN v_disposition = 'applied'
      THEN 'reporting.projection.event_applied.v1'
      ELSE 'reporting.projection.event_review_required.v1'
    END,
    'reporting.projection', p_projection_name, '1.0',
    jsonb_build_object(
      'sourceEventId', p_source_event_id,
      'sourceSequence', p_source_sequence::text,
      'highWaterSequence', v_high_water_sequence::text,
      'disposition', v_disposition
    ),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_source_event_id, p_received_at, p_business_date
  );

  RETURN QUERY SELECT v_disposition, false, v_high_water_sequence;
END $$;

CREATE OR REPLACE FUNCTION reporting.record_metric_snapshot(
  p_snapshot_id uuid,
  p_reconciliation_id uuid,
  p_tenant_id uuid,
  p_metric_definition_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_time_zone text,
  p_currency text,
  p_scale smallint,
  p_unit text,
  p_projected_amount numeric,
  p_control_amount numeric,
  p_dimensions jsonb,
  p_dimensions_hash text,
  p_source_count numeric,
  p_source_cursor text,
  p_freshness_observed_at timestamptz,
  p_freshness_seconds integer,
  p_health text,
  p_checked_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_actor_id uuid,
  p_business_date date
) RETURNS TABLE(metric_snapshot_id uuid, reconciled boolean, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, reporting, platform AS $$
DECLARE
  v_existing reporting.metric_snapshots%ROWTYPE;
  v_difference numeric;
  v_reconciled boolean;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM reporting.metric_snapshots
  WHERE tenant_id = p_tenant_id
    AND metric_definition_id = p_metric_definition_id
    AND period_start = p_period_start
    AND period_end = p_period_end
    AND dimensions_hash = p_dimensions_hash
    AND source_cursor = p_source_cursor;
  IF FOUND THEN
    IF v_existing.amount IS DISTINCT FROM p_projected_amount
       OR v_existing.source_count IS DISTINCT FROM p_source_count
       OR v_existing.scale IS DISTINCT FROM p_scale
       OR v_existing.unit IS DISTINCT FROM p_unit
       OR v_existing.currency IS DISTINCT FROM p_currency THEN
      RAISE EXCEPTION 'metric snapshot replay payload differs' USING ERRCODE = '23505';
    END IF;
    SELECT r.reconciled INTO v_reconciled
    FROM reporting.projection_reconciliations r
    WHERE r.tenant_id = p_tenant_id AND r.metric_snapshot_id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, COALESCE(v_reconciled, false), true;
    RETURN;
  END IF;

  v_difference := p_projected_amount - p_control_amount;
  INSERT INTO reporting.metric_snapshots(
    id, tenant_id, metric_definition_id, period_start, period_end, time_zone,
    currency, scale, unit, amount, dimensions, dimensions_hash, source_count,
    source_cursor, freshness_observed_at, freshness_seconds, health
  ) VALUES (
    p_snapshot_id, p_tenant_id, p_metric_definition_id, p_period_start, p_period_end, p_time_zone,
    p_currency, p_scale, p_unit, p_projected_amount, p_dimensions, p_dimensions_hash, p_source_count,
    p_source_cursor, p_freshness_observed_at, p_freshness_seconds, p_health
  );

  INSERT INTO reporting.projection_reconciliations(
    id, tenant_id, metric_definition_id, metric_snapshot_id, projected_amount,
    control_amount, difference_amount, scale, unit, currency, reconciled,
    source_cursor, checked_at, request_id, trace_id
  ) VALUES (
    p_reconciliation_id, p_tenant_id, p_metric_definition_id, p_snapshot_id,
    p_projected_amount, p_control_amount, v_difference, p_scale, p_unit, p_currency,
    v_difference = 0, p_source_cursor, p_checked_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.metric.snapshot_recorded.v1',
    'reporting.metric.snapshot', CASE WHEN v_difference = 0 THEN 'success' ELSE 'review' END,
    p_actor_id, 'reporting.metric_snapshot', p_snapshot_id::text,
    p_request_id, p_trace_id,
    jsonb_build_object(
      'metricDefinitionId', p_metric_definition_id,
      'sourceCursor', p_source_cursor,
      'reconciled', v_difference = 0,
      'difference', v_difference::text
    ),
    p_checked_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.metric.snapshot_recorded.v1',
    'reporting.metric_snapshot', p_snapshot_id::text, '1.0',
    jsonb_build_object(
      'metricDefinitionId', p_metric_definition_id,
      'sourceCursor', p_source_cursor,
      'reconciled', v_difference = 0,
      'difference', v_difference::text
    ),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_checked_at, p_business_date
  );

  RETURN QUERY SELECT p_snapshot_id, v_difference = 0, false;
END $$;

CREATE OR REPLACE FUNCTION reporting.request_export(
  p_export_id uuid,
  p_tenant_id uuid,
  p_report_id text,
  p_format text,
  p_parameters jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_requested_by uuid,
  p_requested_at timestamptz,
  p_expires_at timestamptz,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(export_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, reporting, platform AS $$
DECLARE
  v_existing reporting.export_requests%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing
  FROM reporting.export_requests
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'export request idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO reporting.export_requests(
    id, tenant_id, report_id, format, parameters, idempotency_key, request_hash,
    requested_by, requested_at, expires_at, request_id, trace_id
  ) VALUES (
    p_export_id, p_tenant_id, p_report_id, p_format, p_parameters, p_idempotency_key, p_request_hash,
    p_requested_by, p_requested_at, p_expires_at, p_request_id, p_trace_id
  );

  INSERT INTO reporting.export_events(
    id, tenant_id, export_request_id, prior_status, new_status,
    observed_at, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_export_id, NULL, 'queued',
    p_requested_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.export.requested.v1',
    'reporting.export.request', 'success', p_requested_by,
    'reporting.export_request', p_export_id::text, p_request_id, p_trace_id,
    jsonb_build_object('reportId', p_report_id, 'format', p_format),
    p_requested_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.export.requested.v1',
    'reporting.export_request', p_export_id::text, '1.0',
    jsonb_build_object('reportId', p_report_id, 'format', p_format),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_requested_at, p_business_date
  );

  RETURN QUERY SELECT p_export_id, false;
END $$;

CREATE OR REPLACE FUNCTION reporting.transition_export(
  p_event_id uuid,
  p_tenant_id uuid,
  p_export_id uuid,
  p_new_status text,
  p_reason_code text,
  p_object_reference text,
  p_content_hash text,
  p_row_count numeric,
  p_observed_at timestamptz,
  p_actor_id uuid,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, reporting, platform AS $$
DECLARE
  v_export reporting.export_requests%ROWTYPE;
  v_existing_event reporting.export_events%ROWTYPE;
  v_allowed boolean;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing_event
  FROM reporting.export_events
  WHERE tenant_id = p_tenant_id AND id = p_event_id;
  IF FOUND THEN
    IF v_existing_event.export_request_id IS DISTINCT FROM p_export_id
       OR v_existing_event.new_status IS DISTINCT FROM p_new_status THEN
      RAISE EXCEPTION 'export transition replay payload differs' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing_event.new_status;
  END IF;

  SELECT * INTO v_export
  FROM reporting.export_requests
  WHERE tenant_id = p_tenant_id AND id = p_export_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export request not found' USING ERRCODE = 'P0002';
  END IF;

  v_allowed := CASE v_export.status
    WHEN 'queued' THEN p_new_status IN ('running','cancelled')
    WHEN 'running' THEN p_new_status IN ('review','completed','failed','cancelled')
    WHEN 'review' THEN p_new_status IN ('running','completed','failed','cancelled')
    WHEN 'completed' THEN p_new_status = 'expired'
    WHEN 'failed' THEN p_new_status IN ('queued','cancelled')
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid export transition: % -> %', v_export.status, p_new_status USING ERRCODE = '22023';
  END IF;
  IF p_new_status = 'completed' AND (p_object_reference IS NULL OR p_content_hash IS NULL) THEN
    RAISE EXCEPTION 'completed export requires object reference and content hash' USING ERRCODE = '22023';
  END IF;

  INSERT INTO reporting.export_events(
    id, tenant_id, export_request_id, prior_status, new_status, reason_code,
    observed_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_export_id, v_export.status, p_new_status, p_reason_code,
    p_observed_at, p_request_id, p_trace_id
  );

  UPDATE reporting.export_requests
  SET status = p_new_status,
      object_reference = COALESCE(p_object_reference, object_reference),
      content_hash = COALESCE(p_content_hash, content_hash),
      row_count = COALESCE(p_row_count, row_count),
      completed_at = CASE WHEN p_new_status = 'completed' THEN p_observed_at ELSE completed_at END
  WHERE tenant_id = p_tenant_id AND id = p_export_id;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.export.status_changed.v1',
    'reporting.export.transition', 'success', p_actor_id,
    'reporting.export_request', p_export_id::text, p_request_id, p_trace_id,
    jsonb_build_object('priorStatus', v_export.status, 'newStatus', p_new_status, 'reasonCode', p_reason_code),
    p_observed_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'reporting.export.status_changed.v1',
    'reporting.export_request', p_export_id::text, '1.0',
    jsonb_build_object('priorStatus', v_export.status, 'newStatus', p_new_status, 'reasonCode', p_reason_code),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );

  RETURN p_new_status;
END $$;

REVOKE ALL ON FUNCTION reporting.publish_metric_definition(
  uuid,uuid,text,text,text,text,text,text,text,text[],text[],text,integer,timestamptz,
  uuid,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION reporting.consume_projection_event(
  uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,timestamptz,date,text,text,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION reporting.record_metric_snapshot(
  uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,smallint,text,numeric,numeric,
  jsonb,text,numeric,text,timestamptz,integer,text,timestamptz,text,text,uuid,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION reporting.request_export(
  uuid,uuid,text,text,jsonb,text,text,uuid,timestamptz,timestamptz,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION reporting.transition_export(
  uuid,uuid,uuid,text,text,text,text,numeric,timestamptz,uuid,text,text,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION reporting.publish_metric_definition(
  uuid,uuid,text,text,text,text,text,text,text,text[],text[],text,integer,timestamptz,
  uuid,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION reporting.consume_projection_event(
  uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,timestamptz,date,text,text,uuid
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION reporting.record_metric_snapshot(
  uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,smallint,text,numeric,numeric,
  jsonb,text,numeric,text,timestamptz,integer,text,timestamptz,text,text,uuid,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION reporting.request_export(
  uuid,uuid,text,text,jsonb,text,text,uuid,timestamptz,timestamptz,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION reporting.transition_export(
  uuid,uuid,uuid,text,text,text,text,numeric,timestamptz,uuid,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('RPT-0002','MOD-G-REPORTING','manifest:RPT-0002-reporting-commands.sql');

COMMIT;
