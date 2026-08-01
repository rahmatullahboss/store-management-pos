BEGIN;

CREATE OR REPLACE FUNCTION platform.internal_token_production_attestation_entry_digest(
  p_batch_digest text,
  p_batch_nonce_digest text,
  p_evidence_digest text,
  p_journal_version bigint,
  p_next_sequence_checkpoint_digest text,
  p_previous_journal_digest text,
  p_previous_sequence_checkpoint_digest text,
  p_receipt_count integer,
  p_recorded_at_epoch_ms bigint,
  p_registry_digest text,
  p_release_digest text,
  p_schema_version smallint
) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, platform
AS $$
  SELECT platform.internal_token_production_attestation_entry_digest(
    p_batch_digest,
    p_batch_nonce_digest,
    p_evidence_digest,
    p_journal_version,
    p_next_sequence_checkpoint_digest,
    p_previous_journal_digest,
    p_previous_sequence_checkpoint_digest,
    p_receipt_count::smallint,
    p_recorded_at_epoch_ms,
    p_registry_digest,
    p_release_digest,
    p_schema_version
  )
$$;

REVOKE ALL ON FUNCTION platform.internal_token_production_attestation_entry_digest(
  text,text,text,bigint,text,text,text,integer,bigint,text,text,smallint
) FROM PUBLIC;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0022',
  'FOUNDATION',
  'manifest:FND-0022-internal-token-production-attestation-receipt-count-cast-fix.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
