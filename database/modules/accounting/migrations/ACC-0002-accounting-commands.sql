BEGIN;

DO $guard$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_name INTO v_constraint_name
    FROM information_schema.table_constraints
   WHERE table_schema = 'accounting'
     AND table_name = 'journal_entries'
     AND constraint_type = 'CHECK'
     AND constraint_name IN (
       SELECT conname
         FROM pg_constraint
        WHERE conrelid = 'accounting.journal_entries'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%posting_kind%approval_request_id%'
     )
   LIMIT 1;
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE accounting.journal_entries DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $guard$;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT accounting_journal_approval_guard CHECK (
    (journal_type <> 'manual' AND posting_kind = 'ordinary' AND approval_request_id IS NULL)
    OR ((journal_type = 'manual' OR posting_kind IN ('adjustment','reversal')) AND approval_request_id IS NOT NULL)
  );

CREATE UNIQUE INDEX accounting_journal_single_reversal_unique
  ON accounting.journal_entries(tenant_id, reversal_of_journal_id)
  WHERE reversal_of_journal_id IS NOT NULL;
CREATE UNIQUE INDEX accounting_allocation_single_reversal_unique
  ON accounting.open_item_allocations(tenant_id, reversal_of_allocation_id)
  WHERE reversal_of_allocation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION accounting.post_journal_v1(
  p_journal_id uuid,
  p_posting_group_id uuid,
  p_chart_id uuid,
  p_fiscal_period_id uuid,
  p_posting_rule_version_id uuid,
  p_journal_type text,
  p_posting_kind text,
  p_source_type text,
  p_source_id text,
  p_source_version text,
  p_transaction_currency char(3),
  p_transaction_scale smallint,
  p_base_currency char(3),
  p_base_scale smallint,
  p_exchange_rate_numerator bigint,
  p_exchange_rate_denominator bigint,
  p_lines jsonb,
  p_approval_request_id uuid,
  p_reason text,
  p_reversal_of_journal_id uuid,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  journal_id uuid,
  posting_group_id uuid,
  status text,
  transaction_currency char(3),
  transaction_scale smallint,
  total_debit_minor bigint,
  total_credit_minor bigint,
  base_currency char(3),
  base_scale smallint,
  total_base_debit_minor bigint,
  total_base_credit_minor bigint,
  business_date date,
  posted_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_period accounting.fiscal_periods%ROWTYPE;
  v_chart accounting.charts%ROWTYPE;
  v_original accounting.journal_entries%ROWTYPE;
  v_line jsonb;
  v_line_number integer := 0;
  v_account accounting.accounts%ROWTYPE;
  v_original_line accounting.journal_lines%ROWTYPE;
  v_debit bigint;
  v_credit bigint;
  v_base_debit bigint;
  v_base_credit bigint;
  v_total_debit bigint := 0;
  v_total_credit bigint := 0;
  v_total_base_debit bigint := 0;
  v_total_base_credit bigint := 0;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'accounting.journal.post'
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
      SELECT je.id, je.posting_group_id, je.status, je.transaction_currency,
             je.transaction_scale, je.total_debit_minor, je.total_credit_minor,
             je.base_currency, je.base_scale, je.total_base_debit_minor,
             je.total_base_credit_minor, je.business_date, je.posted_at, true
        FROM accounting.journal_entries je
       WHERE je.tenant_id = v_tenant_id
         AND je.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  IF p_journal_type NOT IN ('system','manual','adjustment','reversal','opening','closing','revaluation')
     OR p_posting_kind NOT IN ('ordinary','adjustment','reversal') THEN
    RAISE EXCEPTION 'journal type or posting kind is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_journal_type = 'reversal') <> (p_posting_kind = 'reversal') THEN
    RAISE EXCEPTION 'reversal journal type and posting kind must be used together' USING ERRCODE = '22023';
  END IF;
  IF p_journal_type IN ('adjustment','revaluation') AND p_posting_kind <> 'adjustment' THEN
    RAISE EXCEPTION 'adjustment and revaluation journals require adjustment posting kind' USING ERRCODE = '22023';
  END IF;
  IF p_transaction_scale < 0 OR p_transaction_scale > 12 OR p_base_scale < 0 OR p_base_scale > 12
     OR p_exchange_rate_numerator <= 0 OR p_exchange_rate_denominator <= 0 THEN
    RAISE EXCEPTION 'journal scale or exchange rate is invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'journal requires at least two lines' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_chart
    FROM accounting.charts
   WHERE tenant_id = v_tenant_id
     AND id = p_chart_id
     AND legal_entity_id = v_legal_entity_id
     AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'active chart not found' USING ERRCODE = 'P0002'; END IF;
  IF v_chart.base_currency <> p_base_currency THEN
    RAISE EXCEPTION 'journal base currency does not match chart' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_period
    FROM accounting.fiscal_periods
   WHERE tenant_id = v_tenant_id
     AND id = p_fiscal_period_id
     AND legal_entity_id = v_legal_entity_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal period not found' USING ERRCODE = 'P0002'; END IF;
  IF v_business_date < v_period.start_date OR v_business_date > v_period.end_date THEN
    RAISE EXCEPTION 'business date is outside fiscal period' USING ERRCODE = '22023';
  END IF;
  IF v_period.status = 'soft_closed' AND p_posting_kind = 'ordinary' THEN
    RAISE EXCEPTION 'fiscal period is soft-closed for ordinary posting' USING ERRCODE = 'P0001';
  END IF;
  IF v_period.status = 'closed' AND p_posting_kind = 'ordinary' THEN
    RAISE EXCEPTION 'fiscal period is closed' USING ERRCODE = 'P0001';
  END IF;

  IF p_journal_type = 'manual' OR p_posting_kind IN ('adjustment','reversal') THEN
    IF p_approval_request_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM platform.approval_requests ar
       WHERE ar.tenant_id = v_tenant_id
         AND ar.id = p_approval_request_id
         AND ar.action_code = CASE
           WHEN p_posting_kind = 'reversal' THEN 'accounting.journal.reverse'
           WHEN p_journal_type = 'manual' THEN 'accounting.journal.manual'
           ELSE 'accounting.journal.adjust'
         END
         AND ar.target_type = 'accounting.journal'
         AND ar.target_id = CASE
           WHEN p_posting_kind = 'reversal' THEN p_reversal_of_journal_id::text
           ELSE p_journal_id::text
         END
         AND ar.status = 'approved'
         AND (ar.expires_at IS NULL OR ar.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'approved journal evidence is required' USING ERRCODE = '42501';
    END IF;
    IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'journal reason is required' USING ERRCODE = '22023';
    END IF;
  ELSIF p_approval_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'ordinary system journal must not carry approval evidence' USING ERRCODE = '22023';
  END IF;

  IF p_posting_kind = 'reversal' THEN
    IF p_reversal_of_journal_id IS NULL THEN
      RAISE EXCEPTION 'reversal requires original journal' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_original
      FROM accounting.journal_entries
     WHERE tenant_id = v_tenant_id
       AND id = p_reversal_of_journal_id
       AND legal_entity_id = v_legal_entity_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'original journal not found' USING ERRCODE = 'P0002'; END IF;
    IF v_original.chart_id <> p_chart_id
       OR v_original.transaction_currency <> p_transaction_currency
       OR v_original.transaction_scale <> p_transaction_scale
       OR v_original.base_currency <> p_base_currency
       OR v_original.base_scale <> p_base_scale THEN
      RAISE EXCEPTION 'reversal journal identity does not match original' USING ERRCODE = '22023';
    END IF;
  ELSIF p_reversal_of_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'ordinary or adjustment journal cannot reference a reversal target' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    BEGIN
      v_debit := COALESCE((v_line->>'debitMinor')::bigint, 0);
      v_credit := COALESCE((v_line->>'creditMinor')::bigint, 0);
      v_base_debit := COALESCE((v_line->>'baseDebitMinor')::bigint, 0);
      v_base_credit := COALESCE((v_line->>'baseCreditMinor')::bigint, 0);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'journal line amount is invalid' USING ERRCODE = '22023';
    END;
    IF (v_debit > 0) = (v_credit > 0) OR (v_base_debit > 0) = (v_base_credit > 0)
       OR v_debit < 0 OR v_credit < 0 OR v_base_debit < 0 OR v_base_credit < 0 THEN
      RAISE EXCEPTION 'journal line must contain one-sided positive transaction and base amounts' USING ERRCODE = '22023';
    END IF;
    IF (v_line ? 'partyType') <> (v_line ? 'partyId') THEN
      RAISE EXCEPTION 'journal party type and id must be supplied together' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_account
      FROM accounting.accounts
     WHERE tenant_id = v_tenant_id
       AND id = (v_line->>'accountId')::uuid
       AND chart_id = p_chart_id
       AND code = v_line->>'accountCode'
       AND status = 'active'
       AND effective_from <= v_business_date
       AND (effective_until IS NULL OR effective_until >= v_business_date);
    IF NOT FOUND THEN RAISE EXCEPTION 'active journal account not found' USING ERRCODE = 'P0002'; END IF;
    IF p_journal_type = 'manual' AND NOT v_account.allow_manual_posting THEN
      RAISE EXCEPTION 'manual posting is not allowed for account %', v_account.code USING ERRCODE = '42501';
    END IF;

    IF p_posting_kind = 'reversal' THEN
      SELECT * INTO v_original_line
        FROM accounting.journal_lines
       WHERE tenant_id = v_tenant_id
         AND journal_entry_id = p_reversal_of_journal_id
         AND line_number = v_line_number;
      IF NOT FOUND
         OR v_original_line.account_id <> v_account.id
         OR v_debit <> v_original_line.transaction_credit_minor
         OR v_credit <> v_original_line.transaction_debit_minor
         OR v_base_debit <> v_original_line.base_credit_minor
         OR v_base_credit <> v_original_line.base_debit_minor THEN
        RAISE EXCEPTION 'reversal line does not exactly invert original line %', v_line_number USING ERRCODE = '22023';
      END IF;
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
    v_total_base_debit := v_total_base_debit + v_base_debit;
    v_total_base_credit := v_total_base_credit + v_base_credit;
  END LOOP;

  IF v_total_debit <= 0 OR v_total_debit <> v_total_credit
     OR v_total_base_debit <= 0 OR v_total_base_debit <> v_total_base_credit THEN
    RAISE EXCEPTION 'journal is not balanced' USING ERRCODE = '23514';
  END IF;
  IF p_posting_kind = 'reversal' AND v_line_number <> (
    SELECT count(*)::integer FROM accounting.journal_lines
     WHERE tenant_id = v_tenant_id AND journal_entry_id = p_reversal_of_journal_id
  ) THEN
    RAISE EXCEPTION 'reversal line count does not match original' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'accounting.journal.post', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO accounting.posting_groups(
    id, tenant_id, legal_entity_id, source_type, source_id, source_version,
    business_date, correlation_id
  ) VALUES (
    p_posting_group_id, v_tenant_id, v_legal_entity_id, p_source_type,
    p_source_id, p_source_version, v_business_date, v_request_id
  );

  INSERT INTO accounting.journal_entries(
    id, tenant_id, legal_entity_id, chart_id, fiscal_period_id, posting_group_id,
    posting_rule_version_id, journal_type, status, source_type, source_id,
    source_version, transaction_currency, transaction_scale, base_currency,
    base_scale, total_debit_minor, total_credit_minor, total_base_debit_minor,
    total_base_credit_minor, exchange_rate_numerator, exchange_rate_denominator,
    posting_kind, reversal_of_journal_id, correction_reason, approval_request_id,
    business_date, posted_by, request_id, trace_id
  ) VALUES (
    p_journal_id, v_tenant_id, v_legal_entity_id, p_chart_id, p_fiscal_period_id,
    p_posting_group_id, p_posting_rule_version_id, p_journal_type, 'posted',
    p_source_type, p_source_id, p_source_version, p_transaction_currency,
    p_transaction_scale, p_base_currency, p_base_scale, v_total_debit,
    v_total_credit, v_total_base_debit, v_total_base_credit,
    p_exchange_rate_numerator, p_exchange_rate_denominator, p_posting_kind,
    p_reversal_of_journal_id, p_reason, p_approval_request_id, v_business_date,
    v_actor_id, v_request_id, v_trace_id
  );

  INSERT INTO accounting.journal_lines(
    id, tenant_id, journal_entry_id, line_number, account_id,
    transaction_debit_minor, transaction_credit_minor, base_debit_minor,
    base_credit_minor, dimensions, party_type, party_id, source_line_id, memo
  )
  SELECT gen_random_uuid(), v_tenant_id, p_journal_id, ordinal::integer,
         (line->>'accountId')::uuid,
         COALESCE((line->>'debitMinor')::bigint, 0),
         COALESCE((line->>'creditMinor')::bigint, 0),
         COALESCE((line->>'baseDebitMinor')::bigint, 0),
         COALESCE((line->>'baseCreditMinor')::bigint, 0),
         COALESCE(line->'dimensions', '{}'::jsonb),
         NULLIF(line->>'partyType', ''), NULLIF(line->>'partyId', ''),
         NULLIF(line->>'sourceLineId', ''), NULLIF(line->>'memo', '')
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS items(line, ordinal);

  SET CONSTRAINTS accounting.accounting_journal_balance_deferred IMMEDIATE;
  SET CONSTRAINTS accounting.accounting_journal_balance_deferred DEFERRED;

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.journal.posted.v1',
    CASE WHEN p_posting_kind = 'reversal' THEN 'accounting.journal.reverse' ELSE 'accounting.journal.post' END,
    'success', v_actor_id, 'accounting.journal', p_journal_id::text, p_reason,
    v_request_id, v_trace_id,
    jsonb_build_object('postingGroupId', p_posting_group_id, 'journalType', p_journal_type,
                       'postingKind', p_posting_kind, 'sourceType', p_source_type,
                       'sourceId', p_source_id, 'transactionCurrency', p_transaction_currency,
                       'totalDebitMinor', v_total_debit, 'baseCurrency', p_base_currency,
                       'totalBaseDebitMinor', v_total_base_debit,
                       'reversalOfJournalId', p_reversal_of_journal_id),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.journal.posted.v1',
    'accounting.journal', p_journal_id::text, '1.0',
    jsonb_build_object('journalId', p_journal_id, 'postingGroupId', p_posting_group_id,
                       'journalType', p_journal_type, 'postingKind', p_posting_kind,
                       'sourceType', p_source_type, 'sourceId', p_source_id,
                       'transactionCurrency', p_transaction_currency,
                       'transactionScale', p_transaction_scale,
                       'totalDebitMinor', v_total_debit, 'totalCreditMinor', v_total_credit,
                       'baseCurrency', p_base_currency, 'baseScale', p_base_scale,
                       'totalBaseDebitMinor', v_total_base_debit,
                       'totalBaseCreditMinor', v_total_base_credit,
                       'businessDate', v_business_date,
                       'reversalOfJournalId', p_reversal_of_journal_id),
    jsonb_build_object('requestId', v_request_id), v_request_id,
    p_reversal_of_journal_id::text, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 201,
    response_json = jsonb_build_object('journalId', p_journal_id),
    resource_type = 'accounting.journal', resource_id = p_journal_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'accounting.journal.post'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY
    SELECT je.id, je.posting_group_id, je.status, je.transaction_currency,
           je.transaction_scale, je.total_debit_minor, je.total_credit_minor,
           je.base_currency, je.base_scale, je.total_base_debit_minor,
           je.total_base_credit_minor, je.business_date, je.posted_at, false
      FROM accounting.journal_entries je
     WHERE je.tenant_id = v_tenant_id AND je.id = p_journal_id;
END $$;

CREATE OR REPLACE FUNCTION accounting.create_open_item_v1(
  p_open_item_id uuid,
  p_control_account_id uuid,
  p_party_type text,
  p_party_id text,
  p_direction text,
  p_document_type text,
  p_document_id text,
  p_document_version text,
  p_currency char(3),
  p_scale smallint,
  p_amount_minor bigint,
  p_due_date date,
  p_journal_id uuid,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  open_item_id uuid,
  party_type text,
  party_id text,
  direction text,
  currency char(3),
  scale smallint,
  original_minor bigint,
  allocated_minor bigint,
  outstanding_minor bigint,
  status text,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_control_type text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF p_amount_minor <= 0 OR p_scale < 0 OR p_scale > 12 THEN
    RAISE EXCEPTION 'open-item amount is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_party_type = 'customer') <> (p_direction = 'receivable')
     OR p_party_type NOT IN ('customer','supplier')
     OR p_direction NOT IN ('receivable','payable') THEN
    RAISE EXCEPTION 'customer items must be receivable and supplier items must be payable' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'accounting.open_item.create'
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
      SELECT balances.open_item_id, balances.party_type, balances.party_id,
             oi.direction, balances.currency, balances.scale,
             balances.original_minor, balances.allocated_minor,
             balances.outstanding_minor,
             CASE WHEN balances.outstanding_minor = 0 THEN 'settled'
                  WHEN balances.allocated_minor = 0 THEN oi.status
                  ELSE 'partially_allocated' END,
             true
        FROM accounting.open_item_balances_v balances
        JOIN accounting.open_items oi
          ON oi.tenant_id = balances.tenant_id AND oi.id = balances.open_item_id
       WHERE balances.tenant_id = v_tenant_id
         AND balances.open_item_id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT a.control_type INTO v_control_type
    FROM accounting.accounts a
    JOIN accounting.charts c ON c.tenant_id = a.tenant_id AND c.id = a.chart_id
   WHERE a.tenant_id = v_tenant_id
     AND a.id = p_control_account_id
     AND a.status = 'active'
     AND c.legal_entity_id = v_legal_entity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'control account not found' USING ERRCODE = 'P0002'; END IF;
  IF (p_direction = 'receivable' AND v_control_type <> 'accounts_receivable')
     OR (p_direction = 'payable' AND v_control_type <> 'accounts_payable') THEN
    RAISE EXCEPTION 'open-item direction does not match control account' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM accounting.journal_entries je
      JOIN accounting.journal_lines jl
        ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
     WHERE je.tenant_id = v_tenant_id
       AND je.id = p_journal_id
       AND je.legal_entity_id = v_legal_entity_id
       AND je.transaction_currency = p_currency
       AND je.transaction_scale = p_scale
       AND jl.account_id = p_control_account_id
       AND jl.party_type = p_party_type
       AND jl.party_id = p_party_id
       AND ((p_direction = 'receivable' AND jl.transaction_debit_minor = p_amount_minor)
         OR (p_direction = 'payable' AND jl.transaction_credit_minor = p_amount_minor))
  ) THEN
    RAISE EXCEPTION 'open item is not supported by the referenced control-account journal line' USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'accounting.open_item.create', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO accounting.open_items(
    id, tenant_id, legal_entity_id, control_account_id, party_type, party_id,
    document_type, document_id, document_version, currency, scale,
    original_minor, direction, due_date, status, business_date, journal_entry_id
  ) VALUES (
    p_open_item_id, v_tenant_id, v_legal_entity_id, p_control_account_id,
    p_party_type, p_party_id, p_document_type, p_document_id,
    p_document_version, p_currency, p_scale, p_amount_minor, p_direction,
    p_due_date, 'open', v_business_date, p_journal_id
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.open_item.created.v1',
    'accounting.open_item.create', 'success', v_actor_id,
    'accounting.open_item', p_open_item_id::text, v_request_id, v_trace_id,
    jsonb_build_object('partyType', p_party_type, 'partyId', p_party_id,
                       'direction', p_direction, 'documentType', p_document_type,
                       'documentId', p_document_id, 'currency', p_currency,
                       'scale', p_scale, 'originalMinor', p_amount_minor,
                       'journalId', p_journal_id),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.open_item.created.v1',
    'accounting.open_item', p_open_item_id::text, '1.0',
    jsonb_build_object('openItemId', p_open_item_id, 'partyType', p_party_type,
                       'partyId', p_party_id, 'direction', p_direction,
                       'documentType', p_document_type, 'documentId', p_document_id,
                       'currency', p_currency, 'scale', p_scale,
                       'originalMinor', p_amount_minor, 'outstandingMinor', p_amount_minor,
                       'journalId', p_journal_id),
    jsonb_build_object('requestId', v_request_id), v_request_id,
    p_journal_id::text, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 201,
    response_json = jsonb_build_object('openItemId', p_open_item_id),
    resource_type = 'accounting.open_item', resource_id = p_open_item_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'accounting.open_item.create'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT p_open_item_id, p_party_type, p_party_id, p_direction,
    p_currency, p_scale, p_amount_minor, 0::bigint, p_amount_minor,
    'open'::text, false;
END $$;

CREATE OR REPLACE FUNCTION accounting.allocate_open_item_v1(
  p_allocation_id uuid,
  p_open_item_id uuid,
  p_source_type text,
  p_source_id text,
  p_currency char(3),
  p_scale smallint,
  p_amount_minor bigint,
  p_journal_id uuid,
  p_reason text,
  p_reversal_of_allocation_id uuid,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(
  open_item_id uuid,
  party_type text,
  party_id text,
  direction text,
  currency char(3),
  scale smallint,
  original_minor bigint,
  allocated_minor bigint,
  outstanding_minor bigint,
  status text,
  replayed boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_item accounting.open_items%ROWTYPE;
  v_original_allocation accounting.open_item_allocations%ROWTYPE;
  v_current_allocated bigint;
  v_signed_amount bigint;
  v_new_allocated bigint;
  v_outstanding bigint;
  v_status text;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF p_amount_minor <= 0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'accounting.open_item.allocate'
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
      SELECT balances.open_item_id, balances.party_type, balances.party_id,
             oi.direction, balances.currency, balances.scale,
             balances.original_minor, balances.allocated_minor,
             balances.outstanding_minor,
             CASE WHEN balances.outstanding_minor = 0 THEN 'settled'
                  WHEN balances.allocated_minor = 0 THEN oi.status
                  ELSE 'partially_allocated' END,
             true
        FROM accounting.open_item_balances_v balances
        JOIN accounting.open_items oi
          ON oi.tenant_id = balances.tenant_id AND oi.id = balances.open_item_id
       WHERE balances.tenant_id = v_tenant_id
         AND balances.open_item_id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_item
    FROM accounting.open_items
   WHERE tenant_id = v_tenant_id
     AND id = p_open_item_id
     AND legal_entity_id = v_legal_entity_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'open item not found' USING ERRCODE = 'P0002'; END IF;
  IF v_item.currency <> p_currency OR v_item.scale <> p_scale THEN
    RAISE EXCEPTION 'allocation currency or scale mismatch' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM accounting.journal_entries je
      JOIN accounting.journal_lines jl
        ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
     WHERE je.tenant_id = v_tenant_id
       AND je.id = p_journal_id
       AND je.legal_entity_id = v_legal_entity_id
       AND je.transaction_currency = p_currency
       AND je.transaction_scale = p_scale
       AND jl.account_id = v_item.control_account_id
       AND jl.party_type = v_item.party_type
       AND jl.party_id = v_item.party_id
       AND (
         (p_reversal_of_allocation_id IS NULL AND v_item.direction = 'receivable' AND jl.transaction_credit_minor = p_amount_minor)
         OR (p_reversal_of_allocation_id IS NULL AND v_item.direction = 'payable' AND jl.transaction_debit_minor = p_amount_minor)
         OR (p_reversal_of_allocation_id IS NOT NULL AND v_item.direction = 'receivable' AND jl.transaction_debit_minor = p_amount_minor)
         OR (p_reversal_of_allocation_id IS NOT NULL AND v_item.direction = 'payable' AND jl.transaction_credit_minor = p_amount_minor)
       )
  ) THEN
    RAISE EXCEPTION 'allocation is not supported by the referenced control-account journal line' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(amount_minor), 0)::bigint INTO v_current_allocated
    FROM accounting.open_item_allocations
   WHERE tenant_id = v_tenant_id AND open_item_id = p_open_item_id;

  IF p_reversal_of_allocation_id IS NOT NULL THEN
    IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'allocation reversal reason is required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_original_allocation
      FROM accounting.open_item_allocations
     WHERE tenant_id = v_tenant_id
       AND id = p_reversal_of_allocation_id
       AND open_item_id = p_open_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'original allocation not found' USING ERRCODE = 'P0002'; END IF;
    IF v_original_allocation.amount_minor <= 0 OR v_original_allocation.amount_minor <> p_amount_minor THEN
      RAISE EXCEPTION 'allocation reversal amount must exactly match original allocation' USING ERRCODE = '22023';
    END IF;
    v_signed_amount := -p_amount_minor;
  ELSE
    v_signed_amount := p_amount_minor;
  END IF;

  v_new_allocated := v_current_allocated + v_signed_amount;
  v_outstanding := v_item.original_minor - v_new_allocated;
  IF v_new_allocated < 0 OR v_outstanding < 0 THEN
    RAISE EXCEPTION 'allocation exceeds open-item bounds' USING ERRCODE = '22023';
  END IF;
  v_status := CASE WHEN v_outstanding = 0 THEN 'settled'
                   WHEN v_new_allocated = 0 THEN 'open'
                   ELSE 'partially_allocated' END;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'accounting.open_item.allocate', p_idempotency_key, p_request_hash, 'processing');

  INSERT INTO accounting.open_item_allocations(
    id, tenant_id, open_item_id, source_type, source_id, currency, scale,
    amount_minor, business_date, journal_entry_id, reversal_of_allocation_id,
    actor_id, reason
  ) VALUES (
    p_allocation_id, v_tenant_id, p_open_item_id, p_source_type, p_source_id,
    p_currency, p_scale, v_signed_amount, v_business_date, p_journal_id,
    p_reversal_of_allocation_id, v_actor_id, p_reason
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.open_item.allocated.v1',
    CASE WHEN p_reversal_of_allocation_id IS NULL THEN 'accounting.open_item.allocate' ELSE 'accounting.open_item.reverse_allocation' END,
    'success', v_actor_id, 'accounting.open_item', p_open_item_id::text,
    p_reason, v_request_id, v_trace_id,
    jsonb_build_object('allocationId', p_allocation_id, 'sourceType', p_source_type,
                       'sourceId', p_source_id, 'currency', p_currency,
                       'scale', p_scale, 'amountMinor', v_signed_amount,
                       'allocatedMinor', v_new_allocated,
                       'outstandingMinor', v_outstanding,
                       'journalId', p_journal_id,
                       'reversalOfAllocationId', p_reversal_of_allocation_id),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, causation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.open_item.allocated.v1',
    'accounting.open_item', p_open_item_id::text, '1.0',
    jsonb_build_object('openItemId', p_open_item_id, 'allocationId', p_allocation_id,
                       'currency', p_currency, 'scale', p_scale,
                       'amountMinor', v_signed_amount, 'allocatedMinor', v_new_allocated,
                       'outstandingMinor', v_outstanding, 'status', v_status,
                       'journalId', p_journal_id,
                       'reversalOfAllocationId', p_reversal_of_allocation_id),
    jsonb_build_object('requestId', v_request_id), v_request_id,
    p_journal_id::text, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 200,
    response_json = jsonb_build_object('openItemId', p_open_item_id, 'allocationId', p_allocation_id),
    resource_type = 'accounting.open_item', resource_id = p_open_item_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'accounting.open_item.allocate'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_item.id, v_item.party_type, v_item.party_id,
    v_item.direction, v_item.currency, v_item.scale, v_item.original_minor,
    v_new_allocated, v_outstanding, v_status, false;
END $$;

CREATE OR REPLACE FUNCTION accounting.close_period_v1(
  p_period_id uuid,
  p_approval_request_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_evidence jsonb
) RETURNS TABLE(period_id uuid, status text, version bigint, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_period accounting.fiscal_periods%ROWTYPE;
  v_debit bigint;
  v_credit bigint;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'period-close evidence must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'accounting.period.close'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY SELECT fp.id, fp.status, fp.version, true
      FROM accounting.fiscal_periods fp
     WHERE fp.tenant_id = v_tenant_id AND fp.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_period
    FROM accounting.fiscal_periods
   WHERE tenant_id = v_tenant_id
     AND id = p_period_id
     AND legal_entity_id = v_legal_entity_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal period not found' USING ERRCODE = 'P0002'; END IF;
  IF v_period.status = 'closed' THEN RAISE EXCEPTION 'fiscal period is already closed' USING ERRCODE = 'P0001'; END IF;
  IF p_evidence->>'trialBalanceBalanced' <> 'true' THEN
    RAISE EXCEPTION 'balanced trial-balance evidence is required' USING ERRCODE = '22023';
  END IF;
  IF p_approval_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM platform.approval_requests ar
     WHERE ar.tenant_id = v_tenant_id
       AND ar.id = p_approval_request_id
       AND ar.action_code = 'accounting.period.close'
       AND ar.target_type = 'accounting.fiscal_period'
       AND ar.target_id = p_period_id::text
       AND ar.status = 'approved'
       AND (ar.expires_at IS NULL OR ar.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'approved period-close evidence is required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(jl.base_debit_minor), 0)::bigint,
         COALESCE(sum(jl.base_credit_minor), 0)::bigint
    INTO v_debit, v_credit
    FROM accounting.journal_entries je
    JOIN accounting.journal_lines jl
      ON jl.tenant_id = je.tenant_id AND jl.journal_entry_id = je.id
   WHERE je.tenant_id = v_tenant_id AND je.fiscal_period_id = p_period_id;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'period trial balance is not balanced' USING ERRCODE = '23514';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'accounting.period.close', p_idempotency_key, p_request_hash, 'processing');

  UPDATE accounting.fiscal_periods SET
    status = 'closed', closed_at = now(), closed_by = v_actor_id,
    close_approval_request_id = p_approval_request_id,
    close_evidence = p_evidence || jsonb_build_object('baseDebitMinor', v_debit, 'baseCreditMinor', v_credit),
    version = version + 1
  WHERE tenant_id = v_tenant_id AND id = p_period_id
  RETURNING * INTO v_period;

  INSERT INTO accounting.period_close_runs(
    id, tenant_id, legal_entity_id, fiscal_period_id, status, checklist,
    control_totals, exceptions, requested_by, approval_request_id, completed_at
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_legal_entity_id, p_period_id, 'closed',
    p_evidence, jsonb_build_object('baseDebitMinor', v_debit, 'baseCreditMinor', v_credit),
    '[]'::jsonb, v_actor_id, p_approval_request_id, now()
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.period.closed.v1',
    'accounting.period.close', 'success', v_actor_id, 'accounting.fiscal_period',
    p_period_id::text, v_request_id, v_trace_id,
    jsonb_build_object('approvalRequestId', p_approval_request_id,
                       'baseDebitMinor', v_debit, 'baseCreditMinor', v_credit,
                       'version', v_period.version),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.period.closed.v1',
    'accounting.fiscal_period', p_period_id::text, '1.0',
    jsonb_build_object('periodId', p_period_id, 'status', 'closed',
                       'version', v_period.version, 'approvalRequestId', p_approval_request_id,
                       'baseDebitMinor', v_debit, 'baseCreditMinor', v_credit),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 200,
    response_json = jsonb_build_object('periodId', p_period_id, 'status', 'closed'),
    resource_type = 'accounting.fiscal_period', resource_id = p_period_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'accounting.period.close'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_period.id, v_period.status, v_period.version, false;
END $$;

CREATE OR REPLACE FUNCTION accounting.reopen_period_v1(
  p_period_id uuid,
  p_approval_request_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS TABLE(period_id uuid, status text, version bigint, replayed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, platform, accounting AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid := platform.current_tenant_id();
  v_actor_id uuid := platform.current_actor_id();
  v_legal_entity_id uuid := NULLIF(current_setting('app.legal_entity_id', true), '')::uuid;
  v_business_date date := COALESCE(platform.current_business_date(), CURRENT_DATE);
  v_request_id text := COALESCE(platform.current_request_id(), '');
  v_trace_id text := COALESCE(platform.current_trace_id(), v_request_id);
  v_existing platform.idempotency_records%ROWTYPE;
  v_period accounting.fiscal_periods%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_actor_id IS NULL OR v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'tenant, actor and legal entity context are required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 8 OR COALESCE(p_request_hash, '') = '' THEN
    RAISE EXCEPTION 'idempotency key and request hash are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'period reopen reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing
    FROM platform.idempotency_records
   WHERE tenant_id = v_tenant_id
     AND scope = 'accounting.period.reopen'
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key payload mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status <> 'completed' THEN
      RAISE EXCEPTION 'idempotent request is already processing' USING ERRCODE = '55P03';
    END IF;
    RETURN QUERY SELECT fp.id, fp.status, fp.version, true
      FROM accounting.fiscal_periods fp
     WHERE fp.tenant_id = v_tenant_id AND fp.id = v_existing.resource_id::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_period
    FROM accounting.fiscal_periods
   WHERE tenant_id = v_tenant_id
     AND id = p_period_id
     AND legal_entity_id = v_legal_entity_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal period not found' USING ERRCODE = 'P0002'; END IF;
  IF v_period.status <> 'closed' THEN RAISE EXCEPTION 'only a closed period can be reopened' USING ERRCODE = 'P0001'; END IF;
  IF p_approval_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM platform.approval_requests ar
     WHERE ar.tenant_id = v_tenant_id
       AND ar.id = p_approval_request_id
       AND ar.action_code = 'accounting.period.reopen'
       AND ar.target_type = 'accounting.fiscal_period'
       AND ar.target_id = p_period_id::text
       AND ar.status = 'approved'
       AND (ar.expires_at IS NULL OR ar.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'approved period-reopen evidence is required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO platform.idempotency_records(tenant_id, scope, idempotency_key, request_hash, status)
  VALUES (v_tenant_id, 'accounting.period.reopen', p_idempotency_key, p_request_hash, 'processing');

  UPDATE accounting.fiscal_periods SET
    status = 'open', reopened_at = now(), reopened_by = v_actor_id,
    reopen_approval_request_id = p_approval_request_id, version = version + 1
  WHERE tenant_id = v_tenant_id AND id = p_period_id
  RETURNING * INTO v_period;

  INSERT INTO accounting.period_close_runs(
    id, tenant_id, legal_entity_id, fiscal_period_id, status, checklist,
    control_totals, exceptions, requested_by, approval_request_id, completed_at
  ) VALUES (
    gen_random_uuid(), v_tenant_id, v_legal_entity_id, p_period_id, 'reopened',
    jsonb_build_object('reason', p_reason), '{}'::jsonb, '[]'::jsonb,
    v_actor_id, p_approval_request_id, now()
  );

  INSERT INTO platform.audit_events(
    id, tenant_id, event_type, action, outcome, actor_id, target_type,
    target_id, reason, request_id, trace_id, metadata, business_date, source_version
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.period.reopened.v1',
    'accounting.period.reopen', 'success', v_actor_id, 'accounting.fiscal_period',
    p_period_id::text, p_reason, v_request_id, v_trace_id,
    jsonb_build_object('approvalRequestId', p_approval_request_id, 'version', v_period.version),
    v_business_date, 'mod-e-v1'
  );

  INSERT INTO platform.outbox_events(
    id, tenant_id, event_type, aggregate_type, aggregate_id, schema_version,
    payload, metadata, correlation_id, occurred_at, business_date
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'accounting.period.reopened.v1',
    'accounting.fiscal_period', p_period_id::text, '1.0',
    jsonb_build_object('periodId', p_period_id, 'status', 'open',
                       'version', v_period.version, 'approvalRequestId', p_approval_request_id,
                       'reason', p_reason),
    jsonb_build_object('requestId', v_request_id), v_request_id, now(), v_business_date
  );

  UPDATE platform.idempotency_records SET
    status = 'completed', response_status = 200,
    response_json = jsonb_build_object('periodId', p_period_id, 'status', 'open'),
    resource_type = 'accounting.fiscal_period', resource_id = p_period_id::text,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND scope = 'accounting.period.reopen'
    AND idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_period.id, v_period.status, v_period.version, false;
END $$;

REVOKE ALL ON FUNCTION accounting.post_journal_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,char,smallint,char,smallint,bigint,bigint,jsonb,uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounting.create_open_item_v1(uuid,uuid,text,text,text,text,text,text,char,smallint,bigint,date,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounting.allocate_open_item_v1(uuid,uuid,text,text,char,smallint,bigint,uuid,text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounting.close_period_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounting.reopen_period_v1(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting.post_journal_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,char,smallint,char,smallint,bigint,bigint,jsonb,uuid,text,uuid,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION accounting.create_open_item_v1(uuid,uuid,text,text,text,text,text,text,char,smallint,bigint,date,uuid,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION accounting.allocate_open_item_v1(uuid,uuid,text,text,char,smallint,bigint,uuid,text,uuid,text,text) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION accounting.close_period_v1(uuid,uuid,text,text,jsonb) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION accounting.reopen_period_v1(uuid,uuid,text,text,text) TO store_app_runtime;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('ACC-0002','MOD-E-ACCOUNTING','manifest:ACC-0002-accounting-commands.sql');

COMMIT;
