BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'store_key_governance_runtime'
  ) THEN
    CREATE ROLE store_key_governance_runtime NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO store_key_governance_runtime;

CREATE TABLE IF NOT EXISTS platform.internal_token_key_change_journal (
  id uuid PRIMARY KEY,
  change_digest text NOT NULL CHECK (change_digest ~ '^[A-Za-z0-9_-]{43}$'),
  change_type text NOT NULL CHECK (
    change_type IN ('scheduled_rotation','urgent_replacement','previous_retirement')
  ),
  sequence smallint NOT NULL CHECK (sequence BETWEEN 1 AND 3),
  stage text NOT NULL CHECK (stage IN ('requested','approved','applied','denied','failed')),
  event_digest text NOT NULL UNIQUE CHECK (event_digest ~ '^[A-Za-z0-9_-]{43}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[A-Za-z0-9_-]{43}$'),
  previous_event_digest text NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (sequence = 1 AND stage = 'requested' AND previous_event_digest IS NULL)
    OR
    (sequence > 1 AND previous_event_digest IS NOT NULL)
  ),
  CHECK (
    event_digest <> change_digest
    AND event_digest <> evidence_digest
    AND previous_event_digest IS DISTINCT FROM event_digest
  ),
  UNIQUE (change_digest, sequence),
  FOREIGN KEY (previous_event_digest)
    REFERENCES platform.internal_token_key_change_journal(event_digest)
);

CREATE INDEX IF NOT EXISTS internal_token_key_change_journal_change_idx
  ON platform.internal_token_key_change_journal(change_digest, sequence);

DROP TRIGGER IF EXISTS internal_token_key_change_journal_append_only
  ON platform.internal_token_key_change_journal;
CREATE TRIGGER internal_token_key_change_journal_append_only
  BEFORE UPDATE OR DELETE ON platform.internal_token_key_change_journal
  FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.append_internal_token_key_change_journal_event(
  p_change_digest text,
  p_change_type text,
  p_sequence smallint,
  p_stage text,
  p_event_digest text,
  p_evidence_digest text,
  p_previous_event_digest text,
  p_occurred_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_previous platform.internal_token_key_change_journal%ROWTYPE;
BEGIN
  IF p_change_digest IS NULL OR p_change_digest !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'change digest is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_change_type IS NULL OR p_change_type NOT IN (
    'scheduled_rotation','urgent_replacement','previous_retirement'
  ) THEN
    RAISE EXCEPTION 'change type is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_sequence IS NULL OR p_sequence < 1 OR p_sequence > 3 THEN
    RAISE EXCEPTION 'sequence is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN (
    'requested','approved','applied','denied','failed'
  ) THEN
    RAISE EXCEPTION 'stage is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_event_digest IS NULL OR p_event_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR p_evidence_digest IS NULL OR p_evidence_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR (p_previous_event_digest IS NOT NULL AND p_previous_event_digest !~ '^[A-Za-z0-9_-]{43}$')
  THEN
    RAISE EXCEPTION 'event digest is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_event_digest = p_change_digest OR p_event_digest = p_evidence_digest
    OR p_previous_event_digest IS NOT DISTINCT FROM p_event_digest
  THEN
    RAISE EXCEPTION 'event digests must have distinct purposes' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'event timestamp is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_change_digest, 0));

  SELECT *
    INTO v_previous
    FROM platform.internal_token_key_change_journal
   WHERE change_digest = p_change_digest
   ORDER BY sequence DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    IF p_sequence <> 1 OR p_stage <> 'requested' OR p_previous_event_digest IS NOT NULL THEN
      RAISE EXCEPTION 'journal must begin with requested sequence 1'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_previous.stage IN ('applied','denied','failed') THEN
      RAISE EXCEPTION 'journal is already terminal' USING ERRCODE = '23514';
    END IF;
    IF p_sequence <> v_previous.sequence + 1 THEN
      RAISE EXCEPTION 'journal sequence is not contiguous' USING ERRCODE = '23514';
    END IF;
    IF p_previous_event_digest IS DISTINCT FROM v_previous.event_digest THEN
      RAISE EXCEPTION 'journal linkage is invalid' USING ERRCODE = '23514';
    END IF;
    IF p_change_type <> v_previous.change_type THEN
      RAISE EXCEPTION 'journal change type is inconsistent' USING ERRCODE = '23514';
    END IF;
    IF p_occurred_at < v_previous.occurred_at THEN
      RAISE EXCEPTION 'journal timestamp moved backwards' USING ERRCODE = '23514';
    END IF;
    IF NOT (
      (v_previous.stage = 'requested' AND p_stage IN ('approved','denied'))
      OR
      (v_previous.stage = 'approved' AND p_stage IN ('applied','failed'))
    ) THEN
      RAISE EXCEPTION 'journal transition is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO platform.internal_token_key_change_journal(
    id,
    change_digest,
    change_type,
    sequence,
    stage,
    event_digest,
    evidence_digest,
    previous_event_digest,
    occurred_at
  ) VALUES (
    v_id,
    p_change_digest,
    p_change_type,
    p_sequence,
    p_stage,
    p_event_digest,
    p_evidence_digest,
    p_previous_event_digest,
    p_occurred_at
  );

  RETURN v_id;
END $$;

REVOKE ALL ON TABLE platform.internal_token_key_change_journal FROM PUBLIC;
REVOKE ALL ON TABLE platform.internal_token_key_change_journal FROM store_app_runtime;
REVOKE ALL ON TABLE platform.internal_token_key_change_journal FROM store_app_reporting;
REVOKE ALL ON FUNCTION platform.append_internal_token_key_change_journal_event(
  text,text,smallint,text,text,text,text,timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE platform.internal_token_key_change_journal
  TO store_key_governance_runtime;
GRANT EXECUTE ON FUNCTION platform.append_internal_token_key_change_journal_event(
  text,text,smallint,text,text,text,text,timestamptz
) TO store_key_governance_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES (
  'FND-0015',
  'FOUNDATION',
  'manifest:FND-0015-internal-token-key-change-journal.sql'
)
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
