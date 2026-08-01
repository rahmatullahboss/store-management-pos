BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'store_key_governance_runtime'
  ) THEN
    CREATE ROLE store_key_governance_runtime NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO store_key_governance_runtime;

CREATE TABLE IF NOT EXISTS platform.internal_token_provider_signing_journal (
  id uuid PRIMARY KEY,
  request_digest text NOT NULL UNIQUE CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  signing_input_digest text NOT NULL CHECK (signing_input_digest ~ '^[A-Za-z0-9_-]{43}$'),
  key_reference_digest text NOT NULL CHECK (key_reference_digest ~ '^[A-Za-z0-9_-]{43}$'),
  key_version_digest text NOT NULL CHECK (key_version_digest ~ '^[A-Za-z0-9_-]{43}$'),
  audit_reference_digest text NOT NULL CHECK (audit_reference_digest ~ '^[A-Za-z0-9_-]{43}$'),
  operation_digest text NOT NULL UNIQUE CHECK (operation_digest ~ '^[A-Za-z0-9_-]{43}$'),
  signature_digest text NOT NULL UNIQUE CHECK (signature_digest ~ '^[A-Za-z0-9_-]{43}$'),
  purpose text NOT NULL CHECK (purpose IN ('read-token','command-token')),
  provider_class text NOT NULL CHECK (
    provider_class IN ('cloud-kms','managed-hsm','pkcs11-hsm')
  ),
  algorithm text NOT NULL CHECK (algorithm = 'RS256'),
  digest_algorithm text NOT NULL CHECK (digest_algorithm = 'SHA-256'),
  non_exportable boolean NOT NULL CHECK (non_exportable),
  hardware_protected boolean NOT NULL CHECK (hardware_protected),
  receipt_validated boolean NOT NULL CHECK (receipt_validated),
  signature_byte_length smallint NOT NULL CHECK (signature_byte_length BETWEEN 256 AND 512),
  latency_ms integer NOT NULL CHECK (latency_ms BETWEEN 0 AND 5000),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    request_digest <> signing_input_digest
    AND request_digest <> key_reference_digest
    AND request_digest <> key_version_digest
    AND request_digest <> audit_reference_digest
    AND request_digest <> operation_digest
    AND request_digest <> signature_digest
    AND signing_input_digest <> key_reference_digest
    AND signing_input_digest <> key_version_digest
    AND signing_input_digest <> audit_reference_digest
    AND signing_input_digest <> operation_digest
    AND signing_input_digest <> signature_digest
    AND key_reference_digest <> key_version_digest
    AND key_reference_digest <> audit_reference_digest
    AND key_reference_digest <> operation_digest
    AND key_reference_digest <> signature_digest
    AND key_version_digest <> audit_reference_digest
    AND key_version_digest <> operation_digest
    AND key_version_digest <> signature_digest
    AND audit_reference_digest <> operation_digest
    AND audit_reference_digest <> signature_digest
    AND operation_digest <> signature_digest
  )
);

CREATE INDEX IF NOT EXISTS internal_token_provider_signing_journal_occurred_idx
  ON platform.internal_token_provider_signing_journal(occurred_at DESC);

DROP TRIGGER IF EXISTS internal_token_provider_signing_journal_append_only
  ON platform.internal_token_provider_signing_journal;
CREATE TRIGGER internal_token_provider_signing_journal_append_only
  BEFORE UPDATE OR DELETE ON platform.internal_token_provider_signing_journal
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.append_internal_token_provider_signing_journal(
  p_request_digest text,
  p_signing_input_digest text,
  p_key_reference_digest text,
  p_key_version_digest text,
  p_audit_reference_digest text,
  p_operation_digest text,
  p_signature_digest text,
  p_purpose text,
  p_provider_class text,
  p_algorithm text,
  p_digest_algorithm text,
  p_non_exportable boolean,
  p_hardware_protected boolean,
  p_receipt_validated boolean,
  p_signature_byte_length smallint,
  p_latency_ms integer,
  p_occurred_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_digest_count integer;
BEGIN
  IF p_request_digest IS NULL OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_signing_input_digest IS NULL OR p_signing_input_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_key_reference_digest IS NULL OR p_key_reference_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_key_version_digest IS NULL OR p_key_version_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_audit_reference_digest IS NULL OR p_audit_reference_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_operation_digest IS NULL OR p_operation_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_signature_digest IS NULL OR p_signature_digest !~ '^[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION 'provider signing digest is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT digest)
    INTO v_digest_count
    FROM unnest(ARRAY[
      p_request_digest,
      p_signing_input_digest,
      p_key_reference_digest,
      p_key_version_digest,
      p_audit_reference_digest,
      p_operation_digest,
      p_signature_digest
    ]) AS digests(digest);
  IF v_digest_count <> 7 THEN
    RAISE EXCEPTION 'provider signing digests must have distinct purposes'
      USING ERRCODE = '22023';
  END IF;
  IF p_purpose IS NULL OR p_purpose NOT IN ('read-token','command-token') THEN
    RAISE EXCEPTION 'provider signing purpose is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_provider_class IS NULL OR p_provider_class NOT IN (
    'cloud-kms','managed-hsm','pkcs11-hsm'
  ) THEN
    RAISE EXCEPTION 'provider class is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_algorithm IS DISTINCT FROM 'RS256'
    OR p_digest_algorithm IS DISTINCT FROM 'SHA-256'
  THEN
    RAISE EXCEPTION 'provider signing algorithm is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_non_exportable IS DISTINCT FROM true
    OR p_hardware_protected IS DISTINCT FROM true
    OR p_receipt_validated IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'provider signing attestation is incomplete' USING ERRCODE = '22023';
  END IF;
  IF p_signature_byte_length IS NULL OR p_signature_byte_length < 256
    OR p_signature_byte_length > 512
  THEN
    RAISE EXCEPTION 'provider signature length is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_latency_ms IS NULL OR p_latency_ms < 0 OR p_latency_ms > 5000 THEN
    RAISE EXCEPTION 'provider signing latency is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL
    OR p_occurred_at < now() - interval '5 minutes'
    OR p_occurred_at > now() + interval '30 seconds'
  THEN
    RAISE EXCEPTION 'provider signing timestamp is outside the recording window'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_digest, 0));

  INSERT INTO platform.internal_token_provider_signing_journal(
    id,
    request_digest,
    signing_input_digest,
    key_reference_digest,
    key_version_digest,
    audit_reference_digest,
    operation_digest,
    signature_digest,
    purpose,
    provider_class,
    algorithm,
    digest_algorithm,
    non_exportable,
    hardware_protected,
    receipt_validated,
    signature_byte_length,
    latency_ms,
    occurred_at
  ) VALUES (
    v_id,
    p_request_digest,
    p_signing_input_digest,
    p_key_reference_digest,
    p_key_version_digest,
    p_audit_reference_digest,
    p_operation_digest,
    p_signature_digest,
    p_purpose,
    p_provider_class,
    p_algorithm,
    p_digest_algorithm,
    p_non_exportable,
    p_hardware_protected,
    p_receipt_validated,
    p_signature_byte_length,
    p_latency_ms,
    p_occurred_at
  );

  RETURN v_id;
END $$;

REVOKE ALL ON TABLE platform.internal_token_provider_signing_journal FROM PUBLIC;
REVOKE ALL ON TABLE platform.internal_token_provider_signing_journal FROM store_app_runtime;
REVOKE ALL ON TABLE platform.internal_token_provider_signing_journal FROM store_app_reporting;
REVOKE ALL ON FUNCTION platform.append_internal_token_provider_signing_journal(
  text,text,text,text,text,text,text,text,text,text,text,
  boolean,boolean,boolean,smallint,integer,timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE platform.internal_token_provider_signing_journal
  TO store_key_governance_runtime;
GRANT EXECUTE ON FUNCTION platform.append_internal_token_provider_signing_journal(
  text,text,text,text,text,text,text,text,text,text,text,
  boolean,boolean,boolean,smallint,integer,timestamptz
) TO store_key_governance_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0016',
  'FOUNDATION',
  'manifest:FND-0016-internal-token-provider-signing-journal.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
