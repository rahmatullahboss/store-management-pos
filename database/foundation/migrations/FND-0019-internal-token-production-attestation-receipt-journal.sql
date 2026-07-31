BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'store_key_governance_runtime'
  ) THEN
    CREATE ROLE store_key_governance_runtime NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO store_key_governance_runtime;

CREATE TABLE IF NOT EXISTS platform.internal_token_production_attestation_receipt_journal_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  journal_version bigint NOT NULL CHECK (journal_version >= 0),
  genesis_digest text NOT NULL CHECK (genesis_digest ~ '^[A-Za-z0-9_-]{43}$'),
  head_digest text NOT NULL CHECK (head_digest ~ '^[A-Za-z0-9_-]{43}$'),
  latest_sequence_checkpoint_digest text NOT NULL
    CHECK (latest_sequence_checkpoint_digest ~ '^[A-Za-z0-9_-]{43}$'),
  entry_count bigint NOT NULL CHECK (entry_count >= 0 AND entry_count = journal_version),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    genesis_digest <> latest_sequence_checkpoint_digest
    AND head_digest <> latest_sequence_checkpoint_digest
  )
);

CREATE TABLE IF NOT EXISTS platform.internal_token_production_attestation_receipt_journal (
  journal_version bigint PRIMARY KEY CHECK (journal_version > 0),
  entry_digest text NOT NULL UNIQUE CHECK (entry_digest ~ '^[A-Za-z0-9_-]{43}$'),
  batch_digest text NOT NULL UNIQUE CHECK (batch_digest ~ '^[A-Za-z0-9_-]{43}$'),
  batch_nonce_digest text NOT NULL UNIQUE CHECK (batch_nonce_digest ~ '^[A-Za-z0-9_-]{43}$'),
  evidence_digest text NOT NULL UNIQUE CHECK (evidence_digest ~ '^[A-Za-z0-9_-]{43}$'),
  previous_journal_digest text NOT NULL
    CHECK (previous_journal_digest ~ '^[A-Za-z0-9_-]{43}$'),
  previous_sequence_checkpoint_digest text NOT NULL
    CHECK (previous_sequence_checkpoint_digest ~ '^[A-Za-z0-9_-]{43}$'),
  next_sequence_checkpoint_digest text NOT NULL UNIQUE
    CHECK (next_sequence_checkpoint_digest ~ '^[A-Za-z0-9_-]{43}$'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^[A-Za-z0-9_-]{43}$'),
  release_digest text NOT NULL CHECK (release_digest ~ '^[A-Za-z0-9_-]{43}$'),
  receipt_count smallint NOT NULL CHECK (receipt_count = 13),
  recorded_at_epoch_ms bigint NOT NULL CHECK (recorded_at_epoch_ms > 0),
  inserted_at timestamptz NOT NULL DEFAULT now(),
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  CHECK (
    entry_digest <> batch_digest
    AND entry_digest <> batch_nonce_digest
    AND entry_digest <> evidence_digest
    AND entry_digest <> previous_journal_digest
    AND entry_digest <> previous_sequence_checkpoint_digest
    AND entry_digest <> next_sequence_checkpoint_digest
    AND entry_digest <> registry_digest
    AND entry_digest <> release_digest
    AND batch_digest <> batch_nonce_digest
    AND batch_digest <> evidence_digest
    AND batch_digest <> previous_journal_digest
    AND batch_digest <> previous_sequence_checkpoint_digest
    AND batch_digest <> next_sequence_checkpoint_digest
    AND batch_digest <> registry_digest
    AND batch_digest <> release_digest
    AND batch_nonce_digest <> evidence_digest
    AND batch_nonce_digest <> previous_journal_digest
    AND batch_nonce_digest <> previous_sequence_checkpoint_digest
    AND batch_nonce_digest <> next_sequence_checkpoint_digest
    AND batch_nonce_digest <> registry_digest
    AND batch_nonce_digest <> release_digest
    AND evidence_digest <> previous_journal_digest
    AND evidence_digest <> previous_sequence_checkpoint_digest
    AND evidence_digest <> next_sequence_checkpoint_digest
    AND evidence_digest <> registry_digest
    AND evidence_digest <> release_digest
    AND previous_journal_digest <> previous_sequence_checkpoint_digest
    AND previous_journal_digest <> next_sequence_checkpoint_digest
    AND previous_journal_digest <> registry_digest
    AND previous_journal_digest <> release_digest
    AND previous_sequence_checkpoint_digest <> next_sequence_checkpoint_digest
    AND previous_sequence_checkpoint_digest <> registry_digest
    AND previous_sequence_checkpoint_digest <> release_digest
    AND next_sequence_checkpoint_digest <> registry_digest
    AND next_sequence_checkpoint_digest <> release_digest
    AND registry_digest <> release_digest
  )
);

CREATE INDEX IF NOT EXISTS internal_token_production_attestation_receipt_recorded_idx
  ON platform.internal_token_production_attestation_receipt_journal(recorded_at_epoch_ms DESC);

DROP TRIGGER IF EXISTS internal_token_production_attestation_receipt_journal_append_only
  ON platform.internal_token_production_attestation_receipt_journal;
CREATE TRIGGER internal_token_production_attestation_receipt_journal_append_only
  BEFORE UPDATE OR DELETE ON platform.internal_token_production_attestation_receipt_journal
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.internal_token_production_attestation_digest(
  p_canonical text
) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, platform
AS $$
  SELECT rtrim(
    translate(encode(public.digest(convert_to(p_canonical, 'UTF8'), 'sha256'), 'base64'), '+/', '-_'),
    '='
  )
$$;

CREATE OR REPLACE FUNCTION platform.internal_token_production_attestation_batch_digest(
  p_batch_nonce_digest text,
  p_evidence_digest text,
  p_next_sequence_checkpoint_digest text,
  p_previous_sequence_checkpoint_digest text,
  p_receipt_digests text[],
  p_registry_digest text,
  p_release_digest text,
  p_schema_version smallint
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_receipt_digests text[];
  v_receipt_json text;
  v_canonical text;
BEGIN
  SELECT array_agg(receipt_digest ORDER BY receipt_digest)
    INTO v_receipt_digests
    FROM unnest(p_receipt_digests) AS receipts(receipt_digest);

  SELECT '[' || string_agg(to_json(receipt_digest)::text, ',' ORDER BY receipt_digest) || ']'
    INTO v_receipt_json
    FROM unnest(v_receipt_digests) AS receipts(receipt_digest);

  v_canonical :=
    '{"batchNonceDigest":' || to_json(p_batch_nonce_digest)::text ||
    ',"evidenceDigest":' || to_json(p_evidence_digest)::text ||
    ',"nextSequenceCheckpointDigest":' || to_json(p_next_sequence_checkpoint_digest)::text ||
    ',"previousSequenceCheckpointDigest":' || to_json(p_previous_sequence_checkpoint_digest)::text ||
    ',"receiptDigests":' || v_receipt_json ||
    ',"registryDigest":' || to_json(p_registry_digest)::text ||
    ',"releaseDigest":' || to_json(p_release_digest)::text ||
    ',"schemaVersion":' || p_schema_version::text || '}';

  RETURN platform.internal_token_production_attestation_digest(v_canonical);
END $$;

CREATE OR REPLACE FUNCTION platform.internal_token_production_attestation_entry_digest(
  p_batch_digest text,
  p_batch_nonce_digest text,
  p_evidence_digest text,
  p_journal_version bigint,
  p_next_sequence_checkpoint_digest text,
  p_previous_journal_digest text,
  p_previous_sequence_checkpoint_digest text,
  p_receipt_count smallint,
  p_recorded_at_epoch_ms bigint,
  p_registry_digest text,
  p_release_digest text,
  p_schema_version smallint
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_canonical text;
BEGIN
  v_canonical :=
    '{"batchDigest":' || to_json(p_batch_digest)::text ||
    ',"batchNonceDigest":' || to_json(p_batch_nonce_digest)::text ||
    ',"evidenceDigest":' || to_json(p_evidence_digest)::text ||
    ',"journalVersion":' || p_journal_version::text ||
    ',"nextSequenceCheckpointDigest":' || to_json(p_next_sequence_checkpoint_digest)::text ||
    ',"previousJournalDigest":' || to_json(p_previous_journal_digest)::text ||
    ',"previousSequenceCheckpointDigest":' || to_json(p_previous_sequence_checkpoint_digest)::text ||
    ',"receiptCount":' || p_receipt_count::text ||
    ',"recordedAt":' || p_recorded_at_epoch_ms::text ||
    ',"registryDigest":' || to_json(p_registry_digest)::text ||
    ',"releaseDigest":' || to_json(p_release_digest)::text ||
    ',"schemaVersion":' || p_schema_version::text || '}';

  RETURN platform.internal_token_production_attestation_digest(v_canonical);
END $$;

CREATE OR REPLACE FUNCTION platform.append_internal_token_production_attestation_receipt_journal(
  p_schema_version smallint,
  p_batch_digest text,
  p_batch_nonce_digest text,
  p_evidence_digest text,
  p_previous_journal_digest text,
  p_previous_sequence_checkpoint_digest text,
  p_next_sequence_checkpoint_digest text,
  p_registry_digest text,
  p_release_digest text,
  p_receipt_digests text[],
  p_expected_journal_version bigint,
  p_recorded_at_epoch_ms bigint,
  p_entry_digest text
) RETURNS TABLE (
  status text,
  journal_version bigint,
  entry_digest text,
  batch_digest text,
  batch_nonce_digest text,
  evidence_digest text,
  previous_journal_digest text,
  previous_sequence_checkpoint_digest text,
  next_sequence_checkpoint_digest text,
  registry_digest text,
  release_digest text,
  receipt_count smallint,
  recorded_at_epoch_ms bigint,
  schema_version smallint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_state platform.internal_token_production_attestation_receipt_journal_state%ROWTYPE;
  v_existing platform.internal_token_production_attestation_receipt_journal%ROWTYPE;
  v_sorted_receipts text[];
  v_distinct_count integer;
  v_batch_digest text;
  v_entry_digest text;
  v_now_epoch_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_next_version bigint;
  v_updated integer;
BEGIN
  IF p_schema_version IS DISTINCT FROM 1
    OR p_expected_journal_version IS NULL
    OR p_expected_journal_version < 0
    OR p_recorded_at_epoch_ms IS NULL
    OR p_recorded_at_epoch_ms < v_now_epoch_ms - 300000
    OR p_recorded_at_epoch_ms > v_now_epoch_ms + 30000
  THEN
    RAISE EXCEPTION 'attestation receipt journal command is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_batch_digest IS NULL OR p_batch_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_batch_nonce_digest IS NULL OR p_batch_nonce_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_evidence_digest IS NULL OR p_evidence_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_previous_journal_digest IS NULL OR p_previous_journal_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_previous_sequence_checkpoint_digest IS NULL
      OR p_previous_sequence_checkpoint_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_next_sequence_checkpoint_digest IS NULL
      OR p_next_sequence_checkpoint_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_registry_digest IS NULL OR p_registry_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_release_digest IS NULL OR p_release_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_entry_digest IS NULL OR p_entry_digest !~ '^[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION 'attestation receipt journal digest is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_receipt_digests IS NULL OR cardinality(p_receipt_digests) <> 13 THEN
    RAISE EXCEPTION 'attestation receipt journal requires exactly thirteen receipt digests'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(p_receipt_digests) AS receipts(receipt_digest)
     WHERE receipt_digest IS NULL OR receipt_digest !~ '^[A-Za-z0-9_-]{43}$'
  ) THEN
    RAISE EXCEPTION 'attestation receipt digest is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(receipt_digest ORDER BY receipt_digest),
         count(DISTINCT receipt_digest)
    INTO v_sorted_receipts, v_distinct_count
    FROM unnest(p_receipt_digests) AS receipts(receipt_digest);

  IF v_distinct_count <> 13 THEN
    RAISE EXCEPTION 'attestation receipt digests must be distinct' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT digest_value)
    INTO v_distinct_count
    FROM unnest(ARRAY[
      p_batch_digest,
      p_batch_nonce_digest,
      p_evidence_digest,
      p_previous_journal_digest,
      p_previous_sequence_checkpoint_digest,
      p_next_sequence_checkpoint_digest,
      p_registry_digest,
      p_release_digest,
      p_entry_digest
    ] || v_sorted_receipts) AS digest_values(digest_value);

  IF v_distinct_count <> 22 THEN
    RAISE EXCEPTION 'attestation receipt journal digests must have distinct purposes'
      USING ERRCODE = '22023';
  END IF;

  v_batch_digest := platform.internal_token_production_attestation_batch_digest(
    p_batch_nonce_digest,
    p_evidence_digest,
    p_next_sequence_checkpoint_digest,
    p_previous_sequence_checkpoint_digest,
    v_sorted_receipts,
    p_registry_digest,
    p_release_digest,
    p_schema_version
  );
  IF v_batch_digest <> p_batch_digest THEN
    RAISE EXCEPTION 'attestation receipt batch digest does not match'
      USING ERRCODE = '22023';
  END IF;

  v_next_version := p_expected_journal_version + 1;
  v_entry_digest := platform.internal_token_production_attestation_entry_digest(
    p_batch_digest,
    p_batch_nonce_digest,
    p_evidence_digest,
    v_next_version,
    p_next_sequence_checkpoint_digest,
    p_previous_journal_digest,
    p_previous_sequence_checkpoint_digest,
    13,
    p_recorded_at_epoch_ms,
    p_registry_digest,
    p_release_digest,
    p_schema_version
  );
  IF v_entry_digest <> p_entry_digest THEN
    RAISE EXCEPTION 'attestation receipt entry digest does not match'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742901, 19);

  SELECT *
    INTO v_existing
    FROM platform.internal_token_production_attestation_receipt_journal
   WHERE batch_nonce_digest = p_batch_nonce_digest;

  IF FOUND THEN
    IF v_existing.entry_digest <> p_entry_digest
      OR v_existing.batch_digest <> p_batch_digest
      OR v_existing.evidence_digest <> p_evidence_digest
      OR v_existing.previous_journal_digest <> p_previous_journal_digest
      OR v_existing.previous_sequence_checkpoint_digest
        <> p_previous_sequence_checkpoint_digest
      OR v_existing.next_sequence_checkpoint_digest <> p_next_sequence_checkpoint_digest
      OR v_existing.registry_digest <> p_registry_digest
      OR v_existing.release_digest <> p_release_digest
      OR v_existing.receipt_count <> 13
      OR v_existing.recorded_at_epoch_ms <> p_recorded_at_epoch_ms
      OR v_existing.schema_version <> p_schema_version
    THEN
      RAISE EXCEPTION 'attestation receipt batch nonce conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN QUERY SELECT
      'idempotent'::text,
      v_existing.journal_version,
      v_existing.entry_digest,
      v_existing.batch_digest,
      v_existing.batch_nonce_digest,
      v_existing.evidence_digest,
      v_existing.previous_journal_digest,
      v_existing.previous_sequence_checkpoint_digest,
      v_existing.next_sequence_checkpoint_digest,
      v_existing.registry_digest,
      v_existing.release_digest,
      v_existing.receipt_count,
      v_existing.recorded_at_epoch_ms,
      v_existing.schema_version;
    RETURN;
  END IF;

  INSERT INTO platform.internal_token_production_attestation_receipt_journal_state(
    singleton,
    schema_version,
    journal_version,
    genesis_digest,
    head_digest,
    latest_sequence_checkpoint_digest,
    entry_count
  )
  SELECT
    true,
    1,
    0,
    p_previous_journal_digest,
    p_previous_journal_digest,
    p_previous_sequence_checkpoint_digest,
    0
  WHERE p_expected_journal_version = 0
  ON CONFLICT (singleton) DO NOTHING;

  SELECT *
    INTO v_state
    FROM platform.internal_token_production_attestation_receipt_journal_state
   WHERE singleton = true
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attestation receipt journal state is not initialized'
      USING ERRCODE = '55000';
  END IF;

  IF v_state.schema_version <> p_schema_version
    OR v_state.journal_version <> p_expected_journal_version
    OR v_state.head_digest <> p_previous_journal_digest
    OR v_state.latest_sequence_checkpoint_digest
      <> p_previous_sequence_checkpoint_digest
    OR v_state.entry_count <> v_state.journal_version
  THEN
    RAISE EXCEPTION 'attestation receipt journal compare-and-swap failed'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO platform.internal_token_production_attestation_receipt_journal(
    journal_version,
    entry_digest,
    batch_digest,
    batch_nonce_digest,
    evidence_digest,
    previous_journal_digest,
    previous_sequence_checkpoint_digest,
    next_sequence_checkpoint_digest,
    registry_digest,
    release_digest,
    receipt_count,
    recorded_at_epoch_ms,
    schema_version
  ) VALUES (
    v_next_version,
    p_entry_digest,
    p_batch_digest,
    p_batch_nonce_digest,
    p_evidence_digest,
    p_previous_journal_digest,
    p_previous_sequence_checkpoint_digest,
    p_next_sequence_checkpoint_digest,
    p_registry_digest,
    p_release_digest,
    13,
    p_recorded_at_epoch_ms,
    p_schema_version
  );

  UPDATE platform.internal_token_production_attestation_receipt_journal_state
     SET journal_version = v_next_version,
         head_digest = p_entry_digest,
         latest_sequence_checkpoint_digest = p_next_sequence_checkpoint_digest,
         entry_count = v_next_version,
         updated_at = clock_timestamp()
   WHERE singleton = true
     AND journal_version = p_expected_journal_version
     AND head_digest = p_previous_journal_digest
     AND latest_sequence_checkpoint_digest = p_previous_sequence_checkpoint_digest;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'attestation receipt journal state update failed'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    'recorded'::text,
    v_next_version,
    p_entry_digest,
    p_batch_digest,
    p_batch_nonce_digest,
    p_evidence_digest,
    p_previous_journal_digest,
    p_previous_sequence_checkpoint_digest,
    p_next_sequence_checkpoint_digest,
    p_registry_digest,
    p_release_digest,
    13::smallint,
    p_recorded_at_epoch_ms,
    p_schema_version;
END $$;

CREATE OR REPLACE FUNCTION platform.read_internal_token_production_attestation_receipt_journal_state()
RETURNS TABLE (
  schema_version smallint,
  journal_version bigint,
  genesis_digest text,
  head_digest text,
  latest_sequence_checkpoint_digest text,
  entry_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT
    state.schema_version,
    state.journal_version,
    state.genesis_digest,
    state.head_digest,
    state.latest_sequence_checkpoint_digest,
    state.entry_count
  FROM platform.internal_token_production_attestation_receipt_journal_state AS state
  WHERE state.singleton = true
$$;

REVOKE ALL ON TABLE platform.internal_token_production_attestation_receipt_journal_state
  FROM PUBLIC;
REVOKE ALL ON TABLE platform.internal_token_production_attestation_receipt_journal_state
  FROM store_app_runtime;
REVOKE ALL ON TABLE platform.internal_token_production_attestation_receipt_journal_state
  FROM store_app_reporting;
REVOKE ALL ON TABLE platform.internal_token_production_attestation_receipt_journal
  FROM PUBLIC;
REVOKE ALL ON TABLE platform.internal_token_production_attestation_receipt_journal
  FROM store_app_runtime;
REVOKE ALL ON TABLE platform.internal_token_production_attestation_receipt_journal
  FROM store_app_reporting;

REVOKE ALL ON FUNCTION platform.internal_token_production_attestation_digest(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.internal_token_production_attestation_batch_digest(
  text,text,text,text,text[],text,text,smallint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.internal_token_production_attestation_entry_digest(
  text,text,text,bigint,text,text,text,smallint,bigint,text,text,smallint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.append_internal_token_production_attestation_receipt_journal(
  smallint,text,text,text,text,text,text,text,text,text[],bigint,bigint,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.read_internal_token_production_attestation_receipt_journal_state()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.append_internal_token_production_attestation_receipt_journal(
  smallint,text,text,text,text,text,text,text,text,text[],bigint,bigint,text
) TO store_key_governance_runtime;
GRANT EXECUTE ON FUNCTION platform.read_internal_token_production_attestation_receipt_journal_state()
  TO store_key_governance_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0019',
  'FOUNDATION',
  'manifest:FND-0019-internal-token-production-attestation-receipt-journal.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
