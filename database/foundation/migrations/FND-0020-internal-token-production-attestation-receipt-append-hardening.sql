BEGIN;

REVOKE EXECUTE ON FUNCTION platform.append_internal_token_production_attestation_receipt_journal(
  smallint,text,text,text,text,text,text,text,text,text[],bigint,bigint,text
) FROM store_key_governance_runtime;

CREATE OR REPLACE FUNCTION platform.record_internal_token_production_attestation_receipt_batch(
  p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_schema_version smallint;
  v_batch_digest text;
  v_batch_nonce_digest text;
  v_evidence_digest text;
  v_previous_journal_digest text;
  v_previous_sequence_checkpoint_digest text;
  v_next_sequence_checkpoint_digest text;
  v_registry_digest text;
  v_release_digest text;
  v_receipt_digests text[];
  v_expected_journal_version bigint;
  v_recorded_at_epoch_ms bigint;
  v_entry_digest text;
  v_recomputed_batch_digest text;
  v_recomputed_entry_digest text;
  v_distinct_count integer;
  v_now_epoch_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_next_version bigint;
  v_updated integer;
  v_state platform.internal_token_production_attestation_receipt_journal_state%ROWTYPE;
  v_existing platform.internal_token_production_attestation_receipt_journal%ROWTYPE;
BEGIN
  IF p_command IS NULL
    OR jsonb_typeof(p_command) <> 'object'
    OR jsonb_object_length(p_command) <> 13
    OR NOT p_command ?& ARRAY[
      'schemaVersion',
      'batchDigest',
      'batchNonceDigest',
      'evidenceDigest',
      'previousJournalDigest',
      'previousSequenceCheckpointDigest',
      'nextSequenceCheckpointDigest',
      'registryDigest',
      'releaseDigest',
      'receiptDigests',
      'expectedJournalVersion',
      'recordedAt',
      'entryDigest'
    ]
  THEN
    RAISE EXCEPTION 'attestation receipt journal command shape is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (p_command->>'schemaVersion') !~ '^[0-9]+$'
    OR (p_command->>'expectedJournalVersion') !~ '^[0-9]+$'
    OR (p_command->>'recordedAt') !~ '^[0-9]+$'
  THEN
    RAISE EXCEPTION 'attestation receipt journal numeric field is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_schema_version := (p_command->>'schemaVersion')::smallint;
  v_expected_journal_version := (p_command->>'expectedJournalVersion')::bigint;
  v_recorded_at_epoch_ms := (p_command->>'recordedAt')::bigint;
  v_batch_digest := p_command->>'batchDigest';
  v_batch_nonce_digest := p_command->>'batchNonceDigest';
  v_evidence_digest := p_command->>'evidenceDigest';
  v_previous_journal_digest := p_command->>'previousJournalDigest';
  v_previous_sequence_checkpoint_digest :=
    p_command->>'previousSequenceCheckpointDigest';
  v_next_sequence_checkpoint_digest :=
    p_command->>'nextSequenceCheckpointDigest';
  v_registry_digest := p_command->>'registryDigest';
  v_release_digest := p_command->>'releaseDigest';
  v_entry_digest := p_command->>'entryDigest';

  IF v_schema_version <> 1
    OR v_expected_journal_version < 0
    OR v_recorded_at_epoch_ms < v_now_epoch_ms - 300000
    OR v_recorded_at_epoch_ms > v_now_epoch_ms + 30000
  THEN
    RAISE EXCEPTION 'attestation receipt journal command is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_batch_digest IS NULL OR v_batch_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_batch_nonce_digest IS NULL
      OR v_batch_nonce_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_evidence_digest IS NULL OR v_evidence_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_previous_journal_digest IS NULL
      OR v_previous_journal_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_previous_sequence_checkpoint_digest IS NULL
      OR v_previous_sequence_checkpoint_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_next_sequence_checkpoint_digest IS NULL
      OR v_next_sequence_checkpoint_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_registry_digest IS NULL OR v_registry_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_release_digest IS NULL OR v_release_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR v_entry_digest IS NULL OR v_entry_digest !~ '^[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION 'attestation receipt journal digest is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_command->'receiptDigests') <> 'array'
    OR jsonb_array_length(p_command->'receiptDigests') <> 13
  THEN
    RAISE EXCEPTION 'attestation receipt journal requires exactly thirteen receipt digests'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    array_agg(receipt_digest ORDER BY receipt_digest),
    count(DISTINCT receipt_digest)
  INTO v_receipt_digests, v_distinct_count
  FROM jsonb_array_elements_text(p_command->'receiptDigests')
    AS receipts(receipt_digest)
  WHERE receipt_digest ~ '^[A-Za-z0-9_-]{43}$';

  IF cardinality(v_receipt_digests) <> 13 OR v_distinct_count <> 13 THEN
    RAISE EXCEPTION 'attestation receipt digests must be valid and distinct'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT digest_value)
  INTO v_distinct_count
  FROM unnest(ARRAY[
    v_batch_digest,
    v_batch_nonce_digest,
    v_evidence_digest,
    v_previous_journal_digest,
    v_previous_sequence_checkpoint_digest,
    v_next_sequence_checkpoint_digest,
    v_registry_digest,
    v_release_digest,
    v_entry_digest
  ] || v_receipt_digests) AS digest_values(digest_value);

  IF v_distinct_count <> 22 THEN
    RAISE EXCEPTION 'attestation receipt journal digests must have distinct purposes'
      USING ERRCODE = '22023';
  END IF;

  v_recomputed_batch_digest :=
    platform.internal_token_production_attestation_batch_digest(
      v_batch_nonce_digest,
      v_evidence_digest,
      v_next_sequence_checkpoint_digest,
      v_previous_sequence_checkpoint_digest,
      v_receipt_digests,
      v_registry_digest,
      v_release_digest,
      v_schema_version
    );
  IF v_recomputed_batch_digest <> v_batch_digest THEN
    RAISE EXCEPTION 'attestation receipt batch digest does not match'
      USING ERRCODE = '22023';
  END IF;

  v_next_version := v_expected_journal_version + 1;
  v_recomputed_entry_digest :=
    platform.internal_token_production_attestation_entry_digest(
      v_batch_digest,
      v_batch_nonce_digest,
      v_evidence_digest,
      v_next_version,
      v_next_sequence_checkpoint_digest,
      v_previous_journal_digest,
      v_previous_sequence_checkpoint_digest,
      13,
      v_recorded_at_epoch_ms,
      v_registry_digest,
      v_release_digest,
      v_schema_version
    );
  IF v_recomputed_entry_digest <> v_entry_digest THEN
    RAISE EXCEPTION 'attestation receipt entry digest does not match'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742901, 20);

  SELECT journal.*
  INTO v_existing
  FROM platform.internal_token_production_attestation_receipt_journal AS journal
  WHERE journal.batch_nonce_digest = v_batch_nonce_digest;

  IF FOUND THEN
    IF v_existing.entry_digest <> v_entry_digest
      OR v_existing.batch_digest <> v_batch_digest
      OR v_existing.evidence_digest <> v_evidence_digest
      OR v_existing.previous_journal_digest <> v_previous_journal_digest
      OR v_existing.previous_sequence_checkpoint_digest
        <> v_previous_sequence_checkpoint_digest
      OR v_existing.next_sequence_checkpoint_digest
        <> v_next_sequence_checkpoint_digest
      OR v_existing.registry_digest <> v_registry_digest
      OR v_existing.release_digest <> v_release_digest
      OR v_existing.receipt_count <> 13
      OR v_existing.recorded_at_epoch_ms <> v_recorded_at_epoch_ms
      OR v_existing.schema_version <> v_schema_version
    THEN
      RAISE EXCEPTION 'attestation receipt batch nonce conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'status', 'idempotent',
      'journalVersion', v_existing.journal_version,
      'entryDigest', v_existing.entry_digest,
      'batchDigest', v_existing.batch_digest,
      'batchNonceDigest', v_existing.batch_nonce_digest,
      'evidenceDigest', v_existing.evidence_digest,
      'previousJournalDigest', v_existing.previous_journal_digest,
      'previousSequenceCheckpointDigest',
        v_existing.previous_sequence_checkpoint_digest,
      'nextSequenceCheckpointDigest',
        v_existing.next_sequence_checkpoint_digest,
      'registryDigest', v_existing.registry_digest,
      'releaseDigest', v_existing.release_digest,
      'receiptCount', v_existing.receipt_count,
      'recordedAt', v_existing.recorded_at_epoch_ms,
      'schemaVersion', v_existing.schema_version
    );
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
    v_previous_journal_digest,
    v_previous_journal_digest,
    v_previous_sequence_checkpoint_digest,
    0
  WHERE v_expected_journal_version = 0
  ON CONFLICT (singleton) DO NOTHING;

  SELECT state.*
  INTO v_state
  FROM platform.internal_token_production_attestation_receipt_journal_state AS state
  WHERE state.singleton = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attestation receipt journal state is not initialized'
      USING ERRCODE = '55000';
  END IF;

  IF v_state.schema_version <> v_schema_version
    OR v_state.journal_version <> v_expected_journal_version
    OR v_state.head_digest <> v_previous_journal_digest
    OR v_state.latest_sequence_checkpoint_digest
      <> v_previous_sequence_checkpoint_digest
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
    v_entry_digest,
    v_batch_digest,
    v_batch_nonce_digest,
    v_evidence_digest,
    v_previous_journal_digest,
    v_previous_sequence_checkpoint_digest,
    v_next_sequence_checkpoint_digest,
    v_registry_digest,
    v_release_digest,
    13,
    v_recorded_at_epoch_ms,
    v_schema_version
  );

  UPDATE platform.internal_token_production_attestation_receipt_journal_state
  SET journal_version = v_next_version,
      head_digest = v_entry_digest,
      latest_sequence_checkpoint_digest = v_next_sequence_checkpoint_digest,
      entry_count = v_next_version,
      updated_at = clock_timestamp()
  WHERE singleton = true
    AND journal_version = v_expected_journal_version
    AND head_digest = v_previous_journal_digest
    AND latest_sequence_checkpoint_digest =
      v_previous_sequence_checkpoint_digest;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'attestation receipt journal state update failed'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'status', 'recorded',
    'journalVersion', v_next_version,
    'entryDigest', v_entry_digest,
    'batchDigest', v_batch_digest,
    'batchNonceDigest', v_batch_nonce_digest,
    'evidenceDigest', v_evidence_digest,
    'previousJournalDigest', v_previous_journal_digest,
    'previousSequenceCheckpointDigest',
      v_previous_sequence_checkpoint_digest,
    'nextSequenceCheckpointDigest', v_next_sequence_checkpoint_digest,
    'registryDigest', v_registry_digest,
    'releaseDigest', v_release_digest,
    'receiptCount', 13,
    'recordedAt', v_recorded_at_epoch_ms,
    'schemaVersion', v_schema_version
  );
END $$;

REVOKE ALL ON FUNCTION platform.record_internal_token_production_attestation_receipt_batch(jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.record_internal_token_production_attestation_receipt_batch(jsonb)
  TO store_key_governance_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0020',
  'FOUNDATION',
  'manifest:FND-0020-internal-token-production-attestation-receipt-append-hardening.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
