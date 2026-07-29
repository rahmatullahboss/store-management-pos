BEGIN;

ALTER TABLE integration.api_clients
  ADD COLUMN idempotency_key text NULL,
  ADD COLUMN request_hash text NULL,
  ADD COLUMN credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  ADD COLUMN last_rotated_at timestamptz NULL,
  ADD CONSTRAINT api_clients_credential_reference_format
    CHECK (credential_reference ~ '^(secret|vault|kms|provider)://[A-Za-z0-9][A-Za-z0-9._-]{1,63}/[A-Za-z0-9][A-Za-z0-9._/-]{1,190}$') NOT VALID;

CREATE UNIQUE INDEX api_clients_idempotency_unique
  ON integration.api_clients(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE integration.api_client_security_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('issued','rotated','suspended','reactivated','revoked')),
  credential_version bigint NOT NULL CHECK (credential_version > 0),
  credential_reference text NOT NULL,
  previous_status text NULL CHECK (previous_status IS NULL OR previous_status IN ('active','suspended','revoked')),
  resulting_status text NOT NULL CHECK (resulting_status IN ('active','suspended','revoked')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  actor_id uuid NOT NULL REFERENCES platform.users(id),
  occurred_at timestamptz NOT NULL,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, client_id) REFERENCES integration.api_clients(tenant_id, id),
  CHECK (credential_reference ~ '^(secret|vault|kms|provider)://[A-Za-z0-9][A-Za-z0-9._-]{1,63}/[A-Za-z0-9][A-Za-z0-9._/-]{1,190}$'),
  CHECK (btrim(request_hash) <> ''),
  CHECK (btrim(request_id) <> ''),
  CHECK (btrim(trace_id) <> '')
);

CREATE INDEX api_client_security_events_client_idx
  ON integration.api_client_security_events(tenant_id, client_id, occurred_at, id);

CREATE TRIGGER api_client_security_events_append_only
  BEFORE UPDATE OR DELETE ON integration.api_client_security_events
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

ALTER TABLE integration.api_client_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration.api_client_security_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration.api_client_security_events
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

GRANT SELECT ON integration.api_client_security_events TO store_app_runtime, store_app_reporting;
REVOKE INSERT, UPDATE, DELETE ON integration.api_client_security_events FROM store_app_runtime;

CREATE OR REPLACE FUNCTION integration.register_api_client(
  p_id uuid,
  p_tenant_id uuid,
  p_display_name text,
  p_authentication text,
  p_credential_reference text,
  p_scopes text[],
  p_rate_limit_per_minute integer,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_created_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(client_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_existing integration.api_clients%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_authentication NOT IN ('api_key','oauth2_client_credentials') THEN
    RAISE EXCEPTION 'unsupported API client authentication' USING ERRCODE = '22023';
  END IF;
  IF p_credential_reference !~ '^(secret|vault|kms|provider)://[A-Za-z0-9][A-Za-z0-9._-]{1,63}/[A-Za-z0-9][A-Za-z0-9._/-]{1,190}$' THEN
    RAISE EXCEPTION 'API client credential reference is invalid' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_scopes) IS NULL OR cardinality(p_scopes) = 0
     OR cardinality(p_scopes) <> cardinality(ARRAY(SELECT DISTINCT scope FROM unnest(p_scopes) AS scope)) THEN
    RAISE EXCEPTION 'API client scopes must be non-empty and unique' USING ERRCODE = '22023';
  END IF;
  IF p_rate_limit_per_minute < 1 OR p_rate_limit_per_minute > 100000 THEN
    RAISE EXCEPTION 'API client rate limit is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= p_created_at THEN
    RAISE EXCEPTION 'API client expiry must follow creation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM integration.api_clients
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'API client idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, true;
    RETURN;
  END IF;

  INSERT INTO integration.api_clients(
    id, tenant_id, display_name, authentication, credential_reference, scopes,
    status, rate_limit_per_minute, expires_at, created_by, created_at,
    idempotency_key, request_hash, credential_version, last_rotated_at
  ) VALUES (
    p_id, p_tenant_id, p_display_name, p_authentication, p_credential_reference, p_scopes,
    'active', p_rate_limit_per_minute, p_expires_at, p_created_by, p_created_at,
    p_idempotency_key, p_request_hash, 1, p_created_at
  );

  INSERT INTO integration.api_client_security_events(
    id, tenant_id, client_id, event_type, credential_version, credential_reference,
    previous_status, resulting_status, idempotency_key, request_hash, actor_id,
    occurred_at, request_id, trace_id
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_id, 'issued', 1, p_credential_reference,
    NULL, 'active', p_idempotency_key, p_request_hash, p_created_by,
    p_created_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.api_client.created.v1',
    'integration.api_client.create', 'success', p_created_by,
    'integration.api_client', p_id::text, p_request_id, p_trace_id,
    jsonb_build_object(
      'authentication', p_authentication,
      'scopes', p_scopes,
      'rateLimitPerMinute', p_rate_limit_per_minute,
      'credentialVersion', 1
    ),
    p_created_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.api_client.created.v1',
    'integration.api_client', p_id::text, '1.0',
    jsonb_build_object(
      'authentication', p_authentication,
      'scopes', p_scopes,
      'rateLimitPerMinute', p_rate_limit_per_minute,
      'credentialVersion', 1
    ),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_created_at, p_business_date
  );

  RETURN QUERY SELECT p_id, false;
END $$;

CREATE OR REPLACE FUNCTION integration.rotate_api_client_credential(
  p_event_id uuid,
  p_tenant_id uuid,
  p_client_id uuid,
  p_expected_credential_version bigint,
  p_credential_reference text,
  p_rotated_by uuid,
  p_rotated_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(credential_version bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_client integration.api_clients%ROWTYPE;
  v_existing integration.api_client_security_events%ROWTYPE;
  v_next_version bigint;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_credential_reference !~ '^(secret|vault|kms|provider)://[A-Za-z0-9][A-Za-z0-9._-]{1,63}/[A-Za-z0-9][A-Za-z0-9._/-]{1,190}$' THEN
    RAISE EXCEPTION 'API client credential reference is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM integration.api_client_security_events
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.client_id IS DISTINCT FROM p_client_id
       OR v_existing.event_type IS DISTINCT FROM 'rotated' THEN
      RAISE EXCEPTION 'API client credential rotation idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.credential_version, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));
  SELECT * INTO v_client
  FROM integration.api_clients
  WHERE tenant_id = p_tenant_id AND id = p_client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'API client not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_client.status = 'revoked' THEN
    RAISE EXCEPTION 'revoked API client credentials cannot rotate' USING ERRCODE = '22023';
  END IF;
  IF v_client.credential_version IS DISTINCT FROM p_expected_credential_version THEN
    RAISE EXCEPTION 'API client credential version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_client.credential_reference IS NOT DISTINCT FROM p_credential_reference THEN
    RAISE EXCEPTION 'API client credential rotation requires a new reference' USING ERRCODE = '22023';
  END IF;
  IF p_rotated_at < COALESCE(v_client.last_rotated_at, v_client.created_at) THEN
    RAISE EXCEPTION 'API client credential rotation precedes current credential' USING ERRCODE = '22023';
  END IF;

  v_next_version := v_client.credential_version + 1;
  UPDATE integration.api_clients
  SET credential_reference = p_credential_reference,
      credential_version = v_next_version,
      last_rotated_at = p_rotated_at,
      version = version + 1
  WHERE tenant_id = p_tenant_id AND id = p_client_id;

  INSERT INTO integration.api_client_security_events(
    id, tenant_id, client_id, event_type, credential_version, credential_reference,
    previous_status, resulting_status, idempotency_key, request_hash, actor_id,
    occurred_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_client_id, 'rotated', v_next_version, p_credential_reference,
    v_client.status, v_client.status, p_idempotency_key, p_request_hash, p_rotated_by,
    p_rotated_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.api_client.credential_rotated.v1',
    'integration.api_client.credential.rotate', 'success', p_rotated_by,
    'integration.api_client', p_client_id::text, p_request_id, p_trace_id,
    jsonb_build_object('credentialVersion', v_next_version),
    p_rotated_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.api_client.credential_rotated.v1',
    'integration.api_client', p_client_id::text, '1.0',
    jsonb_build_object('credentialVersion', v_next_version),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_rotated_at, p_business_date
  );

  RETURN QUERY SELECT v_next_version, false;
END $$;

CREATE OR REPLACE FUNCTION integration.change_api_client_status(
  p_event_id uuid,
  p_tenant_id uuid,
  p_client_id uuid,
  p_expected_version bigint,
  p_target_status text,
  p_actor_id uuid,
  p_observed_at timestamptz,
  p_idempotency_key text,
  p_request_hash text,
  p_request_id text,
  p_trace_id text,
  p_business_date date
) RETURNS TABLE(status text, version bigint, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, integration, platform AS $$
DECLARE
  v_client integration.api_clients%ROWTYPE;
  v_existing integration.api_client_security_events%ROWTYPE;
  v_event_type text;
  v_next_version bigint;
BEGIN
  IF p_tenant_id IS DISTINCT FROM platform.current_tenant_id() THEN
    RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_target_status NOT IN ('active','suspended','revoked') THEN
    RAISE EXCEPTION 'unsupported API client status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM integration.api_client_security_events
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash
       OR v_existing.client_id IS DISTINCT FROM p_client_id
       OR v_existing.resulting_status IS DISTINCT FROM p_target_status THEN
      RAISE EXCEPTION 'API client status idempotency conflict' USING ERRCODE = '23505';
    END IF;
    SELECT c.version INTO v_next_version
    FROM integration.api_clients c
    WHERE c.tenant_id = p_tenant_id AND c.id = p_client_id;
    RETURN QUERY SELECT v_existing.resulting_status, v_next_version, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));
  SELECT * INTO v_client
  FROM integration.api_clients
  WHERE tenant_id = p_tenant_id AND id = p_client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'API client not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_client.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'API client version conflict' USING ERRCODE = '40001';
  END IF;
  IF v_client.status = 'revoked' THEN
    RAISE EXCEPTION 'revoked API client status is terminal' USING ERRCODE = '22023';
  END IF;
  IF v_client.status = p_target_status THEN
    RAISE EXCEPTION 'API client status is unchanged' USING ERRCODE = '22023';
  END IF;
  IF v_client.status = 'suspended' AND p_target_status NOT IN ('active','revoked') THEN
    RAISE EXCEPTION 'unsupported API client status transition' USING ERRCODE = '22023';
  END IF;

  v_event_type := CASE p_target_status
    WHEN 'active' THEN 'reactivated'
    WHEN 'suspended' THEN 'suspended'
    WHEN 'revoked' THEN 'revoked'
    ELSE NULL
  END;
  v_next_version := v_client.version + 1;

  UPDATE integration.api_clients
  SET status = p_target_status,
      revoked_at = CASE WHEN p_target_status = 'revoked' THEN p_observed_at ELSE NULL END,
      version = v_next_version
  WHERE tenant_id = p_tenant_id AND id = p_client_id;

  INSERT INTO integration.api_client_security_events(
    id, tenant_id, client_id, event_type, credential_version, credential_reference,
    previous_status, resulting_status, idempotency_key, request_hash, actor_id,
    occurred_at, request_id, trace_id
  ) VALUES (
    p_event_id, p_tenant_id, p_client_id, v_event_type, v_client.credential_version, v_client.credential_reference,
    v_client.status, p_target_status, p_idempotency_key, p_request_hash, p_actor_id,
    p_observed_at, p_request_id, p_trace_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type, target_id,
    request_id, trace_id, metadata, occurred_at, business_date, source_version
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.api_client.status_changed.v1',
    'integration.api_client.status.change', 'success', p_actor_id,
    'integration.api_client', p_client_id::text, p_request_id, p_trace_id,
    jsonb_build_object('previousStatus', v_client.status, 'status', p_target_status),
    p_observed_at, p_business_date, 'mod-g-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), p_tenant_id, 'integration.api_client.status_changed.v1',
    'integration.api_client', p_client_id::text, '1.0',
    jsonb_build_object('previousStatus', v_client.status, 'status', p_target_status),
    jsonb_build_object('requestId', p_request_id, 'traceId', p_trace_id, 'source', 'mod-g'),
    p_request_id, p_observed_at, p_business_date
  );

  RETURN QUERY SELECT p_target_status, v_next_version, false;
END $$;

REVOKE ALL ON FUNCTION integration.register_api_client(
  uuid,uuid,text,text,text,text[],integer,timestamptz,uuid,timestamptz,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.rotate_api_client_credential(
  uuid,uuid,uuid,bigint,text,uuid,timestamptz,text,text,text,text,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration.change_api_client_status(
  uuid,uuid,uuid,bigint,text,uuid,timestamptz,text,text,text,text,date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION integration.register_api_client(
  uuid,uuid,text,text,text,text[],integer,timestamptz,uuid,timestamptz,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.rotate_api_client_credential(
  uuid,uuid,uuid,bigint,text,uuid,timestamptz,text,text,text,text,date
) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION integration.change_api_client_status(
  uuid,uuid,uuid,bigint,text,uuid,timestamptz,text,text,text,text,date
) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('INT-0003','MOD-G-INTEGRATION','manifest:INT-0003-api-client-credentials.sql');

COMMIT;
