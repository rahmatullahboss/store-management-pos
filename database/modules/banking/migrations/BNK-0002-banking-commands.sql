BEGIN;

DO $guard$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'banking.reconciliations'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) LIKE '%statement_line_id%candidate_type%candidate_id%status%'
   LIMIT 1;
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE banking.reconciliations DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $guard$;

CREATE INDEX banking_reconciliations_statement_candidate_idx
  ON banking.reconciliations(tenant_id, statement_line_id, candidate_type, candidate_id, matched_at);
CREATE INDEX banking_reconciliations_candidate_balance_idx
  ON banking.reconciliations(tenant_id, candidate_type, candidate_id, matched_at);
CREATE UNIQUE INDEX banking_reconciliation_single_reversal_unique
  ON banking.reconciliations(tenant_id, reversal_of_reconciliation_id)
  WHERE reversal_of_reconciliation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION banking.import_statement_v1(
  p_statement_import_id uuid,
  p_bank_account_id uuid,
  p_source_type text,
  p_source_name text,
  p_source_hash text,
  p_lines jsonb,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  statement_import_id uuid,
  bank_account_id uuid,
  status text,
  line_count integer,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, banking AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_duplicate banking.statement_imports%ROWTYPE;
  v_account banking.bank_accounts%ROWTYPE;
  v_line jsonb;
  v_line_count integer;
  v_seen_line_numbers integer[] := '{}';
  v_seen_line_ids uuid[] := '{}';
  v_seen_external_ids text[] := '{}';
  v_line_number integer;
  v_line_id uuid;
  v_currency char(3);
  v_scale smallint;
  v_amount_minor bigint;
  v_running_balance_minor bigint;
  v_external_id text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF p_source_type NOT IN ('csv','ofx','camt','api','manual')
     OR char_length(btrim(COALESCE(p_source_name, ''))) = 0
     OR char_length(btrim(COALESCE(p_source_hash, ''))) = 0 THEN
    RAISE EXCEPTION 'statement source metadata is invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'statement import requires at least one line' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'banking.statement.import'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY
      SELECT si.id, si.bank_account_id,
             CASE WHEN v_existing.response_json->>'status' = 'duplicate' THEN 'duplicate' ELSE si.status END,
             si.line_count, true
        FROM banking.statement_imports si
       WHERE si.tenant_id = v_tenant_id
         AND si.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_account
    FROM banking.bank_accounts
   WHERE tenant_id = v_tenant_id
     AND id = p_bank_account_id
     AND legal_entity_id = v_legal_entity_id
     AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'active bank account not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_duplicate
    FROM banking.statement_imports
   WHERE tenant_id = v_tenant_id
     AND bank_account_id = p_bank_account_id
     AND source_hash = p_source_hash
     AND status = 'completed';
  IF FOUND THEN
    INSERT INTO platform.idempotency_records(
      tenant_id, scope, idempotency_key, request_hash, status,
      response_status, response_json, resource_type, resource_id
    ) VALUES (
      v_tenant_id, 'banking.statement.import', p_idempotency_key, p_request_hash,
      'completed', 200,
      jsonb_build_object('statementImportId', v_duplicate.id, 'status', 'duplicate'),
      'banking.statement_import', v_duplicate.id::text
    );
    RETURN QUERY SELECT v_duplicate.id, v_duplicate.bank_account_id,
      'duplicate'::text, v_duplicate.line_count, true;
    RETURN;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_line_id := (v_line->>'statementLineId')::uuid;
      v_line_number := (v_line->>'lineNumber')::integer;
      v_currency := (v_line->>'currency')::char(3);
      v_scale := (v_line->>'scale')::smallint;
      v_amount_minor := (v_line->>'amountMinor')::bigint;
      v_running_balance_minor := NULLIF(v_line->>'runningBalanceMinor', '')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'statement line identity or amount is invalid' USING ERRCODE = '22023';
    END;
    v_external_id := NULLIF(v_line->>'externalId', '');
    IF v_line_number <= 0 OR v_line_number = ANY(v_seen_line_numbers) THEN
      RAISE EXCEPTION 'statement line numbers must be unique positive integers' USING ERRCODE = '22023';
    END IF;
    IF v_line_id = ANY(v_seen_line_ids) THEN
      RAISE EXCEPTION 'statement line identifiers must be unique' USING ERRCODE = '22023';
    END IF;
    IF v_external_id IS NOT NULL AND v_external_id = ANY(v_seen_external_ids) THEN
      RAISE EXCEPTION 'statement external identifiers must be unique' USING ERRCODE = '22023';
    END IF;
    IF v_currency <> v_account.currency OR v_scale <> v_account.scale OR v_amount_minor = 0 THEN
      RAISE EXCEPTION 'statement line money does not match bank account' USING ERRCODE = '22023';
    END IF;
    IF char_length(btrim(COALESCE(v_line->>'reference', ''))) = 0
       OR char_length(btrim(COALESCE(v_line->>'fingerprint', ''))) < 8 THEN
      RAISE EXCEPTION 'statement line reference and fingerprint are required' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_line->>'bookedAt', '') = '' THEN
      RAISE EXCEPTION 'statement line booked timestamp is required' USING ERRCODE = '22023';
    END IF;
    v_seen_line_numbers := array_append(v_seen_line_numbers, v_line_number);
    v_seen_line_ids := array_append(v_seen_line_ids, v_line_id);
    IF v_external_id IS NOT NULL THEN v_seen_external_ids := array_append(v_seen_external_ids, v_external_id); END IF;
  END LOOP;

  v_line_count := jsonb_array_length(p_lines);
  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'banking.statement.import', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO banking.statement_imports(
    id, tenant_id, bank_account_id, source_type, source_name, source_hash,
    status, line_count, imported_by, request_id, trace_id
  ) VALUES (
    p_statement_import_id, v_tenant_id, p_bank_account_id, p_source_type,
    p_source_name, p_source_hash, 'processing', 0, v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO banking.statement_lines(
    id, tenant_id, bank_account_id, statement_import_id, line_number,
    external_id, fingerprint, booked_at, value_date, currency, scale,
    amount_minor, running_balance_minor, reference, counterparty_name,
    counterparty_reference, raw_metadata
  )
  SELECT (line->>'statementLineId')::uuid, v_tenant_id, p_bank_account_id,
         p_statement_import_id, (line->>'lineNumber')::integer,
         NULLIF(line->>'externalId', ''), line->>'fingerprint',
         (line->>'bookedAt')::timestamptz, NULLIF(line->>'valueDate', '')::date,
         (line->>'currency')::char(3), (line->>'scale')::smallint,
         (line->>'amountMinor')::bigint,
         NULLIF(line->>'runningBalanceMinor', '')::bigint,
         line->>'reference', NULLIF(line->>'counterpartyName', ''),
         NULLIF(line->>'counterpartyReference', ''),
         COALESCE(line->'rawMetadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_lines) AS items(line);

  UPDATE banking.statement_imports SET
    status = 'completed', line_count = v_line_count, completed_at = now()
  WHERE tenant_id = v_tenant_id AND id = p_statement_import_id;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.statement.imported.v1',
    'banking.statement.import', 'success', v_actor_id, 'banking.statement_import',
    p_statement_import_id::text, v_request_id, v_trace_id,
    jsonb_build_object('bankAccountId', p_bank_account_id, 'sourceType', p_source_type,
                       'sourceHash', p_source_hash, 'lineCount', v_line_count),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.statement.imported.v1',
    'banking.statement_import', p_statement_import_id::text, '1.0',
    jsonb_build_object('statementImportId', p_statement_import_id,
                       'bankAccountId', p_bank_account_id, 'sourceType', p_source_type,
                       'sourceHash', p_source_hash, 'lineCount', v_line_count),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 201,
    response_json = jsonb_build_object('statementImportId', p_statement_import_id, 'status', 'completed'),
    resource_type = 'banking.statement_import', resource_id = p_statement_import_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'banking.statement.import'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT p_statement_import_id, p_bank_account_id,
    'completed'::text, v_line_count, false;
END $$;

CREATE OR REPLACE FUNCTION banking.reconcile_statement_line_v1(
  p_reconciliation_id uuid,
  p_statement_line_id uuid,
  p_candidate_type text,
  p_candidate_id text,
  p_currency char(3),
  p_scale smallint,
  p_matched_amount_minor bigint,
  p_match_method text,
  p_confidence_basis_points integer,
  p_rule_id uuid,
  p_journal_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  reconciliation_id uuid,
  statement_line_id uuid,
  candidate_type text,
  candidate_id text,
  status text,
  currency char(3),
  scale smallint,
  matched_amount_minor bigint,
  statement_matched_minor bigint,
  statement_unmatched_minor bigint,
  statement_status text,
  reconciled_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment, accounting, banking AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_line banking.statement_lines%ROWTYPE;
  v_account banking.bank_accounts%ROWTYPE;
  v_current_matched bigint;
  v_candidate_matched bigint;
  v_new_matched bigint;
  v_unmatched bigint;
  v_statement_status text;
  v_result banking.reconciliations%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF p_candidate_type NOT IN ('settlement','payment','refund','supplier_payment','cash_deposit','journal','opening_balance')
     OR char_length(btrim(COALESCE(p_candidate_id, ''))) = 0 THEN
    RAISE EXCEPTION 'reconciliation candidate is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_match_method NOT IN ('automatic','manual','imported') OR p_matched_amount_minor = 0 THEN
    RAISE EXCEPTION 'reconciliation method or amount is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_match_method = 'automatic' AND (
    p_rule_id IS NULL OR p_confidence_basis_points IS NULL
    OR p_confidence_basis_points < 0 OR p_confidence_basis_points > 10000
  ) THEN
    RAISE EXCEPTION 'automatic reconciliation requires rule and confidence evidence' USING ERRCODE = '22023';
  END IF;
  IF p_match_method = 'manual' AND char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'manual reconciliation reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'banking.reconciliation.match'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY
      SELECT r.id, r.statement_line_id, r.candidate_type, r.candidate_id,
             r.status, r.currency, r.scale, r.matched_amount_minor,
             balances.matched_minor, balances.unmatched_minor,
             sl.reconciliation_status, r.matched_at, true
        FROM banking.reconciliations r
        JOIN banking.statement_lines sl
          ON sl.tenant_id = r.tenant_id AND sl.id = r.statement_line_id
        JOIN banking.unreconciled_statement_lines_v balances
          ON balances.tenant_id = r.tenant_id AND balances.statement_line_id = r.statement_line_id
       WHERE r.tenant_id = v_tenant_id AND r.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT sl.* INTO v_line
    FROM banking.statement_lines sl
   WHERE sl.tenant_id = v_tenant_id
     AND sl.id = p_statement_line_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement line not found' USING ERRCODE = 'P0002'; END IF;
  SELECT ba.* INTO v_account
    FROM banking.bank_accounts ba
   WHERE ba.tenant_id = v_tenant_id
     AND ba.id = v_line.bank_account_id
     AND ba.legal_entity_id = v_legal_entity_id
     AND ba.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'active bank account not found' USING ERRCODE = 'P0002'; END IF;
  IF v_line.currency <> p_currency OR v_line.scale <> p_scale THEN
    RAISE EXCEPTION 'reconciliation currency or scale mismatch' USING ERRCODE = '22023';
  END IF;
  IF (v_line.amount_minor > 0) <> (p_matched_amount_minor > 0) THEN
    RAISE EXCEPTION 'matched amount sign does not match statement line' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(matched_amount_minor), 0)::bigint INTO v_current_matched
    FROM banking.reconciliations
   WHERE tenant_id = v_tenant_id AND statement_line_id = p_statement_line_id;
  v_unmatched := v_line.amount_minor - v_current_matched;
  IF (v_unmatched > 0 AND (p_matched_amount_minor <= 0 OR p_matched_amount_minor > v_unmatched))
     OR (v_unmatched < 0 AND (p_matched_amount_minor >= 0 OR p_matched_amount_minor < v_unmatched))
     OR v_unmatched = 0 THEN
    RAISE EXCEPTION 'matched amount exceeds the unmatched statement amount' USING ERRCODE = '22023';
  END IF;

  IF p_match_method = 'automatic' AND NOT EXISTS (
    SELECT 1 FROM banking.reconciliation_rules rr
     WHERE rr.tenant_id = v_tenant_id
       AND rr.id = p_rule_id
       AND rr.legal_entity_id = v_legal_entity_id
       AND rr.status = 'active'
       AND rr.effective_from <= now()
       AND (rr.effective_until IS NULL OR rr.effective_until > now())
  ) THEN
    RAISE EXCEPTION 'active reconciliation rule not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_candidate_type = 'settlement' THEN
    PERFORM 1 FROM payment.settlements s
     WHERE s.tenant_id = v_tenant_id
       AND s.id = p_candidate_id::uuid
       AND s.legal_entity_id = v_legal_entity_id
       AND s.currency = p_currency AND s.scale = p_scale
       AND s.net_minor = p_matched_amount_minor
       AND s.status IN ('imported','matched','reconciled','exception')
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'settlement candidate does not match statement amount' USING ERRCODE = '22023'; END IF;
  ELSIF p_candidate_type = 'payment' THEN
    PERFORM 1 FROM payment.payment_intents pi
     WHERE pi.tenant_id = v_tenant_id
       AND pi.id = p_candidate_id::uuid
       AND pi.legal_entity_id = v_legal_entity_id
       AND pi.currency = p_currency AND pi.scale = p_scale
       AND (pi.captured_minor - pi.refunded_minor) = p_matched_amount_minor
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'payment candidate does not match statement amount' USING ERRCODE = '22023'; END IF;
  ELSIF p_candidate_type = 'refund' THEN
    PERFORM 1
      FROM payment.refunds pr
      JOIN payment.payment_intents pi
        ON pi.tenant_id = pr.tenant_id AND pi.id = pr.payment_intent_id
     WHERE pr.tenant_id = v_tenant_id
       AND pr.id = p_candidate_id::uuid
       AND pi.legal_entity_id = v_legal_entity_id
       AND pr.currency = p_currency AND pr.scale = p_scale
       AND -pr.amount_minor = p_matched_amount_minor
       AND pr.status = 'succeeded'
     FOR UPDATE OF pr;
    IF NOT FOUND THEN RAISE EXCEPTION 'refund candidate does not match statement amount' USING ERRCODE = '22023'; END IF;
  ELSE
    IF p_journal_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM accounting.journal_entries je
        JOIN accounting.journal_lines jl
          ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
       WHERE je.tenant_id = v_tenant_id
         AND je.id = p_journal_id
         AND je.legal_entity_id = v_legal_entity_id
         AND je.transaction_currency = p_currency
         AND je.transaction_scale = p_scale
         AND jl.account_id = v_account.ledger_account_id
         AND (jl.transaction_debit_minor - jl.transaction_credit_minor) = p_matched_amount_minor
    ) THEN RAISE EXCEPTION 'journal-backed candidate does not match bank ledger line' USING ERRCODE = '22023'; END IF;
  END IF;

  IF p_candidate_type IN ('settlement','payment','refund') THEN
    SELECT COALESCE(sum(matched_amount_minor), 0)::bigint INTO v_candidate_matched
      FROM banking.reconciliations
     WHERE tenant_id = v_tenant_id
       AND candidate_type = p_candidate_type
       AND candidate_id = p_candidate_id;
  ELSE
    SELECT COALESCE(sum(matched_amount_minor), 0)::bigint INTO v_candidate_matched
      FROM banking.reconciliations
     WHERE tenant_id = v_tenant_id
       AND statement_line_id = p_statement_line_id
       AND candidate_type = p_candidate_type
       AND candidate_id = p_candidate_id;
  END IF;
  IF v_candidate_matched <> 0 THEN
    RAISE EXCEPTION 'candidate is already actively reconciled' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'banking.reconciliation.match', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO banking.reconciliations(
    id, tenant_id, legal_entity_id, bank_account_id, statement_line_id,
    candidate_type, candidate_id, currency, scale, matched_amount_minor,
    status, match_method, confidence_basis_points, rule_id, journal_entry_id,
    reason, matched_by, business_date, request_id, trace_id
  ) VALUES (
    p_reconciliation_id, v_tenant_id, v_legal_entity_id, v_line.bank_account_id,
    p_statement_line_id, p_candidate_type, p_candidate_id, p_currency, p_scale,
    p_matched_amount_minor, 'matched', p_match_method, p_confidence_basis_points,
    p_rule_id, p_journal_id, p_reason, v_actor_id, v_business_date, v_request_id, v_trace_id
  ) RETURNING * INTO v_result;

  v_new_matched := v_current_matched + p_matched_amount_minor;
  v_unmatched := v_line.amount_minor - v_new_matched;
  v_statement_status := CASE WHEN v_unmatched = 0 THEN 'matched' ELSE 'partially_matched' END;
  UPDATE banking.statement_lines SET reconciliation_status = v_statement_status
   WHERE tenant_id = v_tenant_id AND id = p_statement_line_id;
  IF p_candidate_type = 'settlement' THEN
    UPDATE payment.settlements SET status = 'reconciled', version = version + 1
     WHERE tenant_id = v_tenant_id AND id = p_candidate_id::uuid;
  END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.reconciliation.matched.v1',
    'banking.reconcile', 'success', v_actor_id, 'banking.reconciliation',
    p_reconciliation_id::text, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('statementLineId', p_statement_line_id,
                       'candidateType', p_candidate_type, 'candidateId', p_candidate_id,
                       'currency', p_currency, 'scale', p_scale,
                       'matchedAmountMinor', p_matched_amount_minor,
                       'statementMatchedMinor', v_new_matched,
                       'statementUnmatchedMinor', v_unmatched,
                       'matchMethod', p_match_method, 'ruleId', p_rule_id,
                       'journalId', p_journal_id),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.reconciliation.matched.v1',
    'banking.reconciliation', p_reconciliation_id::text, '1.0',
    jsonb_build_object('reconciliationId', p_reconciliation_id,
                       'statementLineId', p_statement_line_id,
                       'candidateType', p_candidate_type, 'candidateId', p_candidate_id,
                       'currency', p_currency, 'scale', p_scale,
                       'matchedAmountMinor', p_matched_amount_minor,
                       'statementMatchedMinor', v_new_matched,
                       'statementUnmatchedMinor', v_unmatched,
                       'statementStatus', v_statement_status,
                       'matchMethod', p_match_method, 'journalId', p_journal_id),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 200,
    response_json = jsonb_build_object('reconciliationId', p_reconciliation_id),
    resource_type = 'banking.reconciliation', resource_id = p_reconciliation_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'banking.reconciliation.match'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_result.id, v_result.statement_line_id,
    v_result.candidate_type, v_result.candidate_id, v_result.status,
    v_result.currency, v_result.scale, v_result.matched_amount_minor,
    v_new_matched, v_unmatched, v_statement_status, v_result.matched_at, false;
END $$;

CREATE OR REPLACE FUNCTION banking.reverse_reconciliation_v1(
  p_reconciliation_id uuid,
  p_original_reconciliation_id uuid,
  p_journal_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  reconciliation_id uuid,
  statement_line_id uuid,
  candidate_type text,
  candidate_id text,
  status text,
  currency char(3),
  scale smallint,
  matched_amount_minor bigint,
  statement_matched_minor bigint,
  statement_unmatched_minor bigint,
  statement_status text,
  reconciled_at timestamptz,
  reversal_of_reconciliation_id uuid,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, payment, banking AS $reverse$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_original banking.reconciliations%ROWTYPE;
  v_line banking.statement_lines%ROWTYPE;
  v_current_matched bigint;
  v_new_matched bigint;
  v_unmatched bigint;
  v_statement_status text;
  v_result banking.reconciliations%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'reconciliation reversal reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'banking.reconciliation.reverse'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY
      SELECT r.id, r.statement_line_id, r.candidate_type, r.candidate_id,
             r.status, r.currency, r.scale, r.matched_amount_minor,
             balances.matched_minor, balances.unmatched_minor,
             sl.reconciliation_status, r.matched_at,
             r.reversal_of_reconciliation_id, true
        FROM banking.reconciliations r
        JOIN banking.statement_lines sl
          ON sl.tenant_id = r.tenant_id AND sl.id = r.statement_line_id
        JOIN banking.unreconciled_statement_lines_v balances
          ON balances.tenant_id = r.tenant_id AND balances.statement_line_id = r.statement_line_id
       WHERE r.tenant_id = v_tenant_id AND r.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_original
    FROM banking.reconciliations
   WHERE tenant_id = v_tenant_id
     AND id = p_original_reconciliation_id
     AND legal_entity_id = v_legal_entity_id
     AND status = 'matched'
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'original reconciliation not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (
    SELECT 1 FROM banking.reconciliations
     WHERE tenant_id = v_tenant_id
       AND reversal_of_reconciliation_id = p_original_reconciliation_id
  ) THEN RAISE EXCEPTION 'reconciliation was already reversed' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_line
    FROM banking.statement_lines
   WHERE tenant_id = v_tenant_id AND id = v_original.statement_line_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement line not found' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(sum(matched_amount_minor), 0)::bigint INTO v_current_matched
    FROM banking.reconciliations
   WHERE tenant_id = v_tenant_id AND statement_line_id = v_original.statement_line_id;
  v_new_matched := v_current_matched - v_original.matched_amount_minor;
  v_unmatched := v_line.amount_minor - v_new_matched;
  IF (v_line.amount_minor > 0 AND (v_new_matched < 0 OR v_new_matched > v_line.amount_minor))
     OR (v_line.amount_minor < 0 AND (v_new_matched > 0 OR v_new_matched < v_line.amount_minor)) THEN
    RAISE EXCEPTION 'reconciliation reversal would violate statement bounds' USING ERRCODE = '23514';
  END IF;
  v_statement_status := CASE
    WHEN v_new_matched = 0 THEN 'reversed'
    WHEN v_unmatched = 0 THEN 'matched'
    ELSE 'partially_matched'
  END;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'banking.reconciliation.reverse', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO banking.reconciliations(
    id, tenant_id, legal_entity_id, bank_account_id, statement_line_id,
    candidate_type, candidate_id, currency, scale, matched_amount_minor,
    status, match_method, journal_entry_id, reversal_of_reconciliation_id,
    reason, matched_by, business_date, request_id, trace_id
  ) VALUES (
    p_reconciliation_id, v_tenant_id, v_legal_entity_id, v_original.bank_account_id,
    v_original.statement_line_id, v_original.candidate_type, v_original.candidate_id,
    v_original.currency, v_original.scale, -v_original.matched_amount_minor,
    'reversed', 'manual', p_journal_id, p_original_reconciliation_id,
    p_reason, v_actor_id, v_business_date, v_request_id, v_trace_id
  ) RETURNING * INTO v_result;

  UPDATE banking.statement_lines SET reconciliation_status = v_statement_status
   WHERE tenant_id = v_tenant_id AND id = v_original.statement_line_id;
  IF v_original.candidate_type = 'settlement' THEN
    UPDATE payment.settlements SET status = 'imported', version = version + 1
     WHERE tenant_id = v_tenant_id AND id = v_original.candidate_id::uuid;
  END IF;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.reconciliation.reversed.v1',
    'banking.reconcile.reverse', 'success', v_actor_id, 'banking.reconciliation',
    p_reconciliation_id::text, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('statementLineId', v_original.statement_line_id,
                       'candidateType', v_original.candidate_type,
                       'candidateId', v_original.candidate_id,
                       'matchedAmountMinor', -v_original.matched_amount_minor,
                       'statementMatchedMinor', v_new_matched,
                       'statementUnmatchedMinor', v_unmatched,
                       'originalReconciliationId', p_original_reconciliation_id,
                       'journalId', p_journal_id),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.reconciliation.reversed.v1',
    'banking.reconciliation', p_reconciliation_id::text, '1.0',
    jsonb_build_object('reconciliationId', p_reconciliation_id,
                       'statementLineId', v_original.statement_line_id,
                       'candidateType', v_original.candidate_type,
                       'candidateId', v_original.candidate_id,
                       'currency', v_original.currency, 'scale', v_original.scale,
                       'matchedAmountMinor', -v_original.matched_amount_minor,
                       'statementMatchedMinor', v_new_matched,
                       'statementUnmatchedMinor', v_unmatched,
                       'statementStatus', v_statement_status,
                       'originalReconciliationId', p_original_reconciliation_id,
                       'journalId', p_journal_id),
    jsonb_build_object('requestId', v_request_id), v_request_id,
    p_original_reconciliation_id::text, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 200,
    response_json = jsonb_build_object('reconciliationId', p_reconciliation_id),
    resource_type = 'banking.reconciliation', resource_id = p_reconciliation_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'banking.reconciliation.reverse'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_result.id, v_result.statement_line_id,
    v_result.candidate_type, v_result.candidate_id, v_result.status,
    v_result.currency, v_result.scale, v_result.matched_amount_minor,
    v_new_matched, v_unmatched, v_statement_status, v_result.matched_at,
    v_result.reversal_of_reconciliation_id, false;
END $reverse$;

CREATE OR REPLACE FUNCTION banking.record_reconciliation_run_v1(
  p_run_id uuid,
  p_bank_account_id uuid,
  p_period_start date,
  p_period_end date,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  run_id uuid,
  status text,
  source_line_count bigint,
  matched_line_count bigint,
  exception_count bigint,
  statement_total_minor bigint,
  matched_total_minor bigint,
  difference_minor bigint,
  currency char(3),
  scale smallint,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, banking AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_account banking.bank_accounts%ROWTYPE;
  v_source_count bigint;
  v_matched_count bigint;
  v_exception_count bigint;
  v_statement_total bigint;
  v_matched_total bigint;
  v_difference bigint;
  v_status text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'reconciliation period is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'banking.reconciliation.run'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY
      SELECT rr.id, rr.status, rr.source_line_count, rr.matched_line_count,
             rr.exception_count, rr.statement_total_minor, rr.matched_total_minor,
             rr.difference_minor, rr.currency, rr.scale, true
        FROM banking.reconciliation_runs rr
       WHERE rr.tenant_id = v_tenant_id AND rr.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_account
    FROM banking.bank_accounts
   WHERE tenant_id = v_tenant_id
     AND id = p_bank_account_id
     AND legal_entity_id = v_legal_entity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank account not found' USING ERRCODE = 'P0002'; END IF;

  SELECT count(*)::bigint,
         count(*) FILTER (WHERE balances.unmatched_minor = 0)::bigint,
         COALESCE(sum(balances.amount_minor), 0)::bigint,
         COALESCE(sum(balances.matched_minor), 0)::bigint
    INTO v_source_count, v_matched_count, v_statement_total, v_matched_total
    FROM banking.unreconciled_statement_lines_v balances
   WHERE balances.tenant_id = v_tenant_id
     AND balances.bank_account_id = p_bank_account_id
     AND balances.booked_at::date BETWEEN p_period_start AND p_period_end;

  SELECT count(*)::bigint INTO v_exception_count
    FROM banking.reconciliation_exceptions re
   WHERE re.tenant_id = v_tenant_id
     AND re.bank_account_id = p_bank_account_id
     AND re.status IN ('open','investigating','reopened')
     AND re.opened_at::date BETWEEN p_period_start AND p_period_end;

  v_difference := v_statement_total - v_matched_total;
  v_status := CASE
    WHEN v_exception_count > 0 OR v_difference <> 0 THEN 'completed_with_exceptions'
    ELSE 'completed'
  END;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'banking.reconciliation.run', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO banking.reconciliation_runs(
    id, tenant_id, legal_entity_id, bank_account_id, period_start, period_end,
    status, source_line_count, matched_line_count, exception_count,
    statement_total_minor, matched_total_minor, difference_minor,
    currency, scale, evidence, requested_by, completed_at
  ) VALUES (
    p_run_id, v_tenant_id, v_legal_entity_id, p_bank_account_id,
    p_period_start, p_period_end, v_status, v_source_count, v_matched_count,
    v_exception_count, v_statement_total, v_matched_total, v_difference,
    v_account.currency, v_account.scale,
    jsonb_build_object('requestId', v_request_id, 'traceId', v_trace_id,
                       'generatedAt', now(), 'businessDate', v_business_date),
    v_actor_id, now()
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.reconciliation.run.completed.v1',
    'banking.reconciliation.run', 'success', v_actor_id,
    'banking.reconciliation_run', p_run_id::text, v_request_id, v_trace_id,
    jsonb_build_object('bankAccountId', p_bank_account_id,
                       'periodStart', p_period_start, 'periodEnd', p_period_end,
                       'status', v_status, 'sourceLineCount', v_source_count,
                       'matchedLineCount', v_matched_count,
                       'exceptionCount', v_exception_count,
                       'statementTotalMinor', v_statement_total,
                       'matchedTotalMinor', v_matched_total,
                       'differenceMinor', v_difference),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'banking.reconciliation.run.completed.v1',
    'banking.reconciliation_run', p_run_id::text, '1.0',
    jsonb_build_object('runId', p_run_id, 'bankAccountId', p_bank_account_id,
                       'periodStart', p_period_start, 'periodEnd', p_period_end,
                       'status', v_status, 'sourceLineCount', v_source_count,
                       'matchedLineCount', v_matched_count,
                       'exceptionCount', v_exception_count,
                       'currency', v_account.currency, 'scale', v_account.scale,
                       'statementTotalMinor', v_statement_total,
                       'matchedTotalMinor', v_matched_total,
                       'differenceMinor', v_difference),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 200,
    response_json = jsonb_build_object('runId', p_run_id, 'status', v_status),
    resource_type = 'banking.reconciliation_run', resource_id = p_run_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'banking.reconciliation.run'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT p_run_id, v_status, v_source_count, v_matched_count,
    v_exception_count, v_statement_total, v_matched_total, v_difference,
    v_account.currency, v_account.scale, false;
END $$;

REVOKE ALL ON FUNCTION banking.import_statement_v1(uuid,uuid,text,text,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION banking.reconcile_statement_line_v1(uuid,uuid,text,text,char,smallint,bigint,text,integer,uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION banking.reverse_reconciliation_v1(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION banking.record_reconciliation_run_v1(uuid,uuid,date,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION banking.import_statement_v1(uuid,uuid,text,text,text,jsonb,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION banking.reconcile_statement_line_v1(uuid,uuid,text,text,char,smallint,bigint,text,integer,uuid,uuid,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION banking.reverse_reconciliation_v1(uuid,uuid,uuid,text,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION banking.record_reconciliation_run_v1(uuid,uuid,date,date,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('BNK-0002','MOD-E-BANKING','manifest:BNK-0002-banking-commands.sql');

COMMIT;
