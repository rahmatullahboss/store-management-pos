BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'store_key_governance_runtime'
  ) THEN
    CREATE ROLE store_key_governance_runtime NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO store_key_governance_runtime;

CREATE TABLE IF NOT EXISTS platform.internal_token_provider_evidence_disposition_journal (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE CHECK (sequence > 0),
  custody_digest text NOT NULL UNIQUE CHECK (custody_digest ~ '^[A-Za-z0-9_-]{43}$'),
  request_digest text NOT NULL UNIQUE CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  approval_digest text NOT NULL UNIQUE CHECK (approval_digest ~ '^[A-Za-z0-9_-]{43}$'),
  recheck_digest text NOT NULL UNIQUE CHECK (recheck_digest ~ '^[A-Za-z0-9_-]{43}$'),
  operation_digest text NOT NULL UNIQUE CHECK (operation_digest ~ '^[A-Za-z0-9_-]{43}$'),
  provider_audit_digest text NOT NULL UNIQUE CHECK (provider_audit_digest ~ '^[A-Za-z0-9_-]{43}$'),
  disposition_digest text NOT NULL UNIQUE CHECK (disposition_digest ~ '^[A-Za-z0-9_-]{43}$'),
  previous_disposition_digest text NULL REFERENCES platform.internal_token_provider_evidence_disposition_journal(disposition_digest),
  candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 1 AND 100000),
  approval_count smallint NOT NULL CHECK (approval_count = 2),
  legal_hold_count integer NOT NULL CHECK (legal_hold_count = 0),
  provider_class text NOT NULL CHECK (
    provider_class IN ('object-lock-archive', 'vault-archive', 'offline-custodian')
  ),
  occurred_at timestamptz NOT NULL,
  privacy_profile text NOT NULL CHECK (privacy_profile = 'digest-only-v1'),
  status text NOT NULL CHECK (status = 'destroyed'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_token_provider_evidence_disposition_recorded_idx
  ON platform.internal_token_provider_evidence_disposition_journal(recorded_at DESC);

DROP TRIGGER IF EXISTS internal_token_provider_evidence_disposition_append_only
  ON platform.internal_token_provider_evidence_disposition_journal;
CREATE TRIGGER internal_token_provider_evidence_disposition_append_only
  BEFORE UPDATE OR DELETE ON platform.internal_token_provider_evidence_disposition_journal
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.append_internal_token_provider_evidence_disposition(
  p_sequence bigint,
  p_custody_digest text,
  p_request_digest text,
  p_approval_digest text,
  p_recheck_digest text,
  p_operation_digest text,
  p_provider_audit_digest text,
  p_previous_disposition_digest text,
  p_disposition_digest text,
  p_candidate_count integer,
  p_approval_count smallint,
  p_legal_hold_count integer,
  p_provider_class text,
  p_occurred_at timestamptz,
  p_privacy_profile text,
  p_status text
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_previous_sequence bigint;
  v_previous_digest text;
  v_digest_count integer;
BEGIN
  IF p_sequence IS NULL OR p_sequence <= 0 THEN
    RAISE EXCEPTION 'provider evidence disposition sequence is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_custody_digest IS NULL OR p_custody_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_request_digest IS NULL OR p_request_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_approval_digest IS NULL OR p_approval_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_recheck_digest IS NULL OR p_recheck_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_operation_digest IS NULL OR p_operation_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_provider_audit_digest IS NULL OR p_provider_audit_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_disposition_digest IS NULL OR p_disposition_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR (
      p_previous_disposition_digest IS NOT NULL
      AND p_previous_disposition_digest !~ '^[A-Za-z0-9_-]{43}$'
    )
  THEN
    RAISE EXCEPTION 'provider evidence disposition digest is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT value)
    INTO v_digest_count
    FROM unnest(ARRAY[
      p_custody_digest,
      p_request_digest,
      p_approval_digest,
      p_recheck_digest,
      p_operation_digest,
      p_provider_audit_digest,
      p_disposition_digest
    ]) AS digests(value);
  IF v_digest_count <> 7 THEN
    RAISE EXCEPTION 'provider evidence disposition digests must have distinct purposes'
      USING ERRCODE = '22023';
  END IF;

  IF p_candidate_count IS NULL OR p_candidate_count < 1 OR p_candidate_count > 100000 THEN
    RAISE EXCEPTION 'provider evidence disposition candidate count is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_approval_count IS DISTINCT FROM 2 OR p_legal_hold_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'provider evidence disposition authorization state is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_class IS NULL OR p_provider_class NOT IN (
    'object-lock-archive',
    'vault-archive',
    'offline-custodian'
  ) THEN
    RAISE EXCEPTION 'provider evidence disposition provider class is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL
    OR p_occurred_at < now() - interval '24 hours'
    OR p_occurred_at > now() + interval '30 seconds'
  THEN
    RAISE EXCEPTION 'provider evidence disposition timestamp is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_privacy_profile IS DISTINCT FROM 'digest-only-v1'
    OR p_status IS DISTINCT FROM 'destroyed'
  THEN
    RAISE EXCEPTION 'provider evidence disposition profile is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('internal-token-provider-evidence-disposition', 0)
  );

  SELECT sequence, disposition_digest
    INTO v_previous_sequence, v_previous_digest
    FROM platform.internal_token_provider_evidence_disposition_journal
    ORDER BY sequence DESC
    LIMIT 1
    FOR UPDATE;

  IF v_previous_sequence IS NULL THEN
    IF p_sequence <> 1 OR p_previous_disposition_digest IS NOT NULL THEN
      RAISE EXCEPTION 'provider evidence disposition must begin at sequence 1'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_sequence <> v_previous_sequence + 1 THEN
      RAISE EXCEPTION 'provider evidence disposition sequence is not contiguous'
        USING ERRCODE = '22023';
    END IF;
    IF p_previous_disposition_digest IS DISTINCT FROM v_previous_digest THEN
      RAISE EXCEPTION 'provider evidence disposition linkage is invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO platform.internal_token_provider_evidence_disposition_journal(
    id,
    sequence,
    custody_digest,
    request_digest,
    approval_digest,
    recheck_digest,
    operation_digest,
    provider_audit_digest,
    previous_disposition_digest,
    disposition_digest,
    candidate_count,
    approval_count,
    legal_hold_count,
    provider_class,
    occurred_at,
    privacy_profile,
    status
  ) VALUES (
    v_id,
    p_sequence,
    p_custody_digest,
    p_request_digest,
    p_approval_digest,
    p_recheck_digest,
    p_operation_digest,
    p_provider_audit_digest,
    p_previous_disposition_digest,
    p_disposition_digest,
    p_candidate_count,
    p_approval_count,
    p_legal_hold_count,
    p_provider_class,
    p_occurred_at,
    p_privacy_profile,
    p_status
  );

  RETURN v_id;
END $$;

REVOKE ALL ON TABLE platform.internal_token_provider_evidence_disposition_journal
  FROM PUBLIC;
REVOKE ALL ON TABLE platform.internal_token_provider_evidence_disposition_journal
  FROM store_app_runtime;
REVOKE ALL ON TABLE platform.internal_token_provider_evidence_disposition_journal
  FROM store_app_reporting;
REVOKE ALL ON FUNCTION platform.append_internal_token_provider_evidence_disposition(
  bigint,text,text,text,text,text,text,text,text,integer,smallint,integer,text,timestamptz,text,text
) FROM PUBLIC;

GRANT SELECT ON TABLE platform.internal_token_provider_evidence_disposition_journal
  TO store_key_governance_runtime;
GRANT EXECUTE ON FUNCTION platform.append_internal_token_provider_evidence_disposition(
  bigint,text,text,text,text,text,text,text,text,integer,smallint,integer,text,timestamptz,text,text
) TO store_key_governance_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0018',
  'FOUNDATION',
  'manifest:FND-0018-internal-token-provider-evidence-disposition.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
