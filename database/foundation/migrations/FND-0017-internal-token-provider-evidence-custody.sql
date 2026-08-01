BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'store_key_governance_runtime'
  ) THEN
    CREATE ROLE store_key_governance_runtime NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO store_key_governance_runtime;

CREATE TABLE IF NOT EXISTS platform.internal_token_provider_evidence_custody_journal (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE CHECK (sequence > 0),
  export_digest text NOT NULL UNIQUE CHECK (export_digest ~ '^[A-Za-z0-9_-]{43}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[A-Za-z0-9_-]{43}$'),
  chain_root_digest text NOT NULL UNIQUE CHECK (chain_root_digest ~ '^[A-Za-z0-9_-]{43}$'),
  custody_digest text NOT NULL UNIQUE CHECK (custody_digest ~ '^[A-Za-z0-9_-]{43}$'),
  previous_custody_digest text NULL REFERENCES platform.internal_token_provider_evidence_custody_journal(custody_digest),
  record_count integer NOT NULL CHECK (record_count BETWEEN 1 AND 100000),
  legal_hold_count integer NOT NULL CHECK (
    legal_hold_count >= 0 AND legal_hold_count <= record_count
  ),
  eligible_for_disposal_count integer NOT NULL CHECK (
    eligible_for_disposal_count >= 0
    AND eligible_for_disposal_count <= record_count - legal_hold_count
  ),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  generated_at timestamptz NOT NULL,
  minimum_retained_until timestamptz NOT NULL,
  privacy_profile text NOT NULL CHECK (privacy_profile = 'digest-only-v1'),
  status text NOT NULL CHECK (status = 'sealed'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_retained_until >= generated_at),
  CHECK (export_digest <> policy_digest),
  CHECK (export_digest <> chain_root_digest),
  CHECK (export_digest <> custody_digest),
  CHECK (policy_digest <> chain_root_digest),
  CHECK (policy_digest <> custody_digest),
  CHECK (chain_root_digest <> custody_digest)
);

CREATE INDEX IF NOT EXISTS internal_token_provider_evidence_custody_recorded_idx
  ON platform.internal_token_provider_evidence_custody_journal(recorded_at DESC);

DROP TRIGGER IF EXISTS internal_token_provider_evidence_custody_append_only
  ON platform.internal_token_provider_evidence_custody_journal;
CREATE TRIGGER internal_token_provider_evidence_custody_append_only
  BEFORE UPDATE OR DELETE ON platform.internal_token_provider_evidence_custody_journal
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.append_internal_token_provider_evidence_custody(
  p_sequence bigint,
  p_export_digest text,
  p_policy_digest text,
  p_chain_root_digest text,
  p_previous_custody_digest text,
  p_custody_digest text,
  p_record_count integer,
  p_legal_hold_count integer,
  p_eligible_for_disposal_count integer,
  p_retention_days integer,
  p_generated_at timestamptz,
  p_minimum_retained_until timestamptz,
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
BEGIN
  IF p_sequence IS NULL OR p_sequence <= 0 THEN
    RAISE EXCEPTION 'provider evidence custody sequence is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_export_digest IS NULL OR p_export_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_policy_digest IS NULL OR p_policy_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_chain_root_digest IS NULL OR p_chain_root_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_custody_digest IS NULL OR p_custody_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR (
      p_previous_custody_digest IS NOT NULL
      AND p_previous_custody_digest !~ '^[A-Za-z0-9_-]{43}$'
    )
  THEN
    RAISE EXCEPTION 'provider evidence custody digest is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF cardinality(ARRAY[
    p_export_digest,
    p_policy_digest,
    p_chain_root_digest,
    p_custody_digest
  ]) <> cardinality(ARRAY(
    SELECT DISTINCT digest
    FROM unnest(ARRAY[
      p_export_digest,
      p_policy_digest,
      p_chain_root_digest,
      p_custody_digest
    ]) AS digests(digest)
  )) THEN
    RAISE EXCEPTION 'provider evidence custody digests must have distinct purposes'
      USING ERRCODE = '22023';
  END IF;
  IF p_record_count IS NULL OR p_record_count < 1 OR p_record_count > 100000 THEN
    RAISE EXCEPTION 'provider evidence custody record count is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_legal_hold_count IS NULL
    OR p_legal_hold_count < 0
    OR p_legal_hold_count > p_record_count
  THEN
    RAISE EXCEPTION 'provider evidence custody legal-hold count is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_eligible_for_disposal_count IS NULL
    OR p_eligible_for_disposal_count < 0
    OR p_eligible_for_disposal_count > p_record_count - p_legal_hold_count
  THEN
    RAISE EXCEPTION 'provider evidence custody disposal count is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'provider evidence custody retention is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_generated_at IS NULL
    OR p_generated_at < now() - interval '24 hours'
    OR p_generated_at > now() + interval '30 seconds'
  THEN
    RAISE EXCEPTION 'provider evidence custody generation time is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_minimum_retained_until IS NULL
    OR p_minimum_retained_until < p_generated_at
    OR p_minimum_retained_until > p_generated_at + interval '3650 days'
  THEN
    RAISE EXCEPTION 'provider evidence custody retained-until time is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_privacy_profile IS DISTINCT FROM 'digest-only-v1'
    OR p_status IS DISTINCT FROM 'sealed'
  THEN
    RAISE EXCEPTION 'provider evidence custody profile is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('internal-token-provider-evidence-custody', 0)
  );

  SELECT sequence, custody_digest
    INTO v_previous_sequence, v_previous_digest
    FROM platform.internal_token_provider_evidence_custody_journal
    ORDER BY sequence DESC
    LIMIT 1
    FOR UPDATE;

  IF v_previous_sequence IS NULL THEN
    IF p_sequence <> 1 OR p_previous_custody_digest IS NOT NULL THEN
      RAISE EXCEPTION 'provider evidence custody must begin at sequence 1'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_sequence <> v_previous_sequence + 1 THEN
      RAISE EXCEPTION 'provider evidence custody sequence is not contiguous'
        USING ERRCODE = '22023';
    END IF;
    IF p_previous_custody_digest IS DISTINCT FROM v_previous_digest THEN
      RAISE EXCEPTION 'provider evidence custody linkage is invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO platform.internal_token_provider_evidence_custody_journal(
    id,
    sequence,
    export_digest,
    policy_digest,
    chain_root_digest,
    previous_custody_digest,
    custody_digest,
    record_count,
    legal_hold_count,
    eligible_for_disposal_count,
    retention_days,
    generated_at,
    minimum_retained_until,
    privacy_profile,
    status
  ) VALUES (
    v_id,
    p_sequence,
    p_export_digest,
    p_policy_digest,
    p_chain_root_digest,
    p_previous_custody_digest,
    p_custody_digest,
    p_record_count,
    p_legal_hold_count,
    p_eligible_for_disposal_count,
    p_retention_days,
    p_generated_at,
    p_minimum_retained_until,
    p_privacy_profile,
    p_status
  );

  RETURN v_id;
END $$;

REVOKE ALL ON TABLE platform.internal_token_provider_evidence_custody_journal
  FROM PUBLIC;
REVOKE ALL ON TABLE platform.internal_token_provider_evidence_custody_journal
  FROM store_app_runtime;
REVOKE ALL ON TABLE platform.internal_token_provider_evidence_custody_journal
  FROM store_app_reporting;
REVOKE ALL ON FUNCTION platform.append_internal_token_provider_evidence_custody(
  bigint,text,text,text,text,text,integer,integer,integer,integer,
  timestamptz,timestamptz,text,text
) FROM PUBLIC;

GRANT SELECT ON TABLE platform.internal_token_provider_evidence_custody_journal
  TO store_key_governance_runtime;
GRANT EXECUTE ON FUNCTION platform.append_internal_token_provider_evidence_custody(
  bigint,text,text,text,text,text,integer,integer,integer,integer,
  timestamptz,timestamptz,text,text
) TO store_key_governance_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0017',
  'FOUNDATION',
  'manifest:FND-0017-internal-token-provider-evidence-custody.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
