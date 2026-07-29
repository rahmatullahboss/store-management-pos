\set ON_ERROR_STOP on
BEGIN;
SET LOCAL row_security = off;

INSERT INTO platform.tenants(id,code,display_name,home_region,status,default_locale,default_time_zone)
VALUES ('55555555-5555-4555-8555-555555555501','mod-e-bank','MOD-E Banking Tenant','test','active','en-GB','UTC');
INSERT INTO platform.users(id,identity_subject,display_name,status)
VALUES ('55555555-5555-4555-8555-555555555502','mod-e-banking-user','MOD-E Banking User','active');
INSERT INTO platform.memberships(id,tenant_id,user_id,status)
VALUES ('55555555-5555-4555-8555-555555555503','55555555-5555-4555-8555-555555555501','55555555-5555-4555-8555-555555555502','active');
INSERT INTO platform.legal_entities(id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status)
VALUES ('55555555-5555-4555-8555-555555555504','55555555-5555-4555-8555-555555555501','BNK','Banking Entity','GBP','GB','UTC','active');

INSERT INTO accounting.charts(id,tenant_id,legal_entity_id,code,display_name,base_currency)
VALUES ('55555555-5555-4555-8555-555555555505','55555555-5555-4555-8555-555555555501','55555555-5555-4555-8555-555555555504','MAIN','Main chart','GBP');
INSERT INTO accounting.accounts(
  id,tenant_id,chart_id,code,display_name,account_type,normal_balance,control_type,allow_manual_posting,effective_from
) VALUES (
  '55555555-5555-4555-8555-555555555506','55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555505','1100','Bank','asset','debit','bank',false,'2026-01-01'
);
INSERT INTO banking.bank_accounts(
  id,tenant_id,legal_entity_id,ledger_account_id,code,display_name,bank_name,
  account_reference_masked,currency,scale,country_code,status
) VALUES (
  '55555555-5555-4555-8555-555555555507','55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555504','55555555-5555-4555-8555-555555555506',
  'OPERATING','Operating account','Test Bank','****1234','GBP',2,'GB','active'
);
INSERT INTO payment.provider_accounts(
  id,tenant_id,legal_entity_id,code,provider_key,display_name,status
) VALUES (
  '55555555-5555-4555-8555-555555555508','55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555504','CARD','test-card','Test Card Provider','active'
);
INSERT INTO payment.settlements(
  id,tenant_id,legal_entity_id,provider_account_id,provider_settlement_id,
  currency,scale,gross_minor,fee_minor,adjustment_minor,net_minor,status,
  settled_at,source_hash
) VALUES (
  '55555555-5555-4555-8555-555555555509','55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555504','55555555-5555-4555-8555-555555555508',
  'provider-settlement-001','GBP',2,10500,500,0,10000,'imported',
  '2026-07-28T10:00:00Z','settlement-source-001'
);
INSERT INTO banking.reconciliation_rules(
  id,tenant_id,legal_entity_id,code,display_name,priority,rule_definition,status,
  effective_from,approved_by,content_hash
) VALUES (
  '55555555-5555-4555-8555-555555555510','55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555504','SETTLEMENT_REFERENCE','Settlement reference match',
  10,jsonb_build_object('referenceContains','provider-settlement-001'),'active',
  '2026-01-01T00:00:00Z','55555555-5555-4555-8555-555555555502','rule-hash-001'
);

SET LOCAL row_security = on;
SET LOCAL ROLE store_app_runtime;
SELECT platform.set_request_context(
  '55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555502',
  '55555555-5555-4555-8555-555555555504',
  NULL,NULL,NULL,'2026-07-28','banking-lifecycle','banking-lifecycle'
);

CREATE TEMP TABLE banking_results(label text PRIMARY KEY, payload jsonb) ON COMMIT DROP;

INSERT INTO banking_results(label,payload)
SELECT 'import', to_jsonb(result)
FROM banking.import_statement_v1(
  '55555555-5555-4555-8555-555555555511',
  '55555555-5555-4555-8555-555555555507',
  'csv','statement-2026-07.csv','statement-source-hash-001',
  jsonb_build_array(jsonb_build_object(
    'statementLineId','55555555-5555-4555-8555-555555555512',
    'lineNumber',1,
    'externalId','bank-line-001',
    'fingerprint','fingerprint-bank-line-001',
    'bookedAt','2026-07-28T12:00:00Z',
    'valueDate','2026-07-28',
    'currency','GBP',
    'scale',2,
    'amountMinor',10000,
    'runningBalanceMinor',25000,
    'reference','provider-settlement-001',
    'counterpartyName','Test Card Provider'
  )),
  'bank-import-001','hash-bank-import-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'import-replay', to_jsonb(result)
FROM banking.import_statement_v1(
  '55555555-5555-4555-8555-555555555599',
  '55555555-5555-4555-8555-555555555507',
  'csv','statement-2026-07.csv','statement-source-hash-001',
  jsonb_build_array(jsonb_build_object(
    'statementLineId','55555555-5555-4555-8555-555555555598',
    'lineNumber',1,
    'externalId','ignored-replay-line',
    'fingerprint','ignored-replay-fingerprint',
    'bookedAt','2026-07-28T12:00:00Z',
    'currency','GBP','scale',2,'amountMinor',10000,'reference','ignored replay'
  )),
  'bank-import-001','hash-bank-import-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'duplicate-source', to_jsonb(result)
FROM banking.import_statement_v1(
  '55555555-5555-4555-8555-555555555513',
  '55555555-5555-4555-8555-555555555507',
  'csv','renamed-statement.csv','statement-source-hash-001',
  jsonb_build_array(jsonb_build_object(
    'statementLineId','55555555-5555-4555-8555-555555555514',
    'lineNumber',1,
    'externalId','duplicate-source-line',
    'fingerprint','duplicate-source-fingerprint',
    'bookedAt','2026-07-28T12:00:00Z',
    'currency','GBP','scale',2,'amountMinor',10000,'reference','duplicate source'
  )),
  'bank-import-002','hash-bank-import-002'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'match', to_jsonb(result)
FROM banking.reconcile_statement_line_v1(
  '55555555-5555-4555-8555-555555555515',
  '55555555-5555-4555-8555-555555555512',
  'settlement','55555555-5555-4555-8555-555555555509',
  'GBP'::char(3),2::smallint,10000::bigint,'automatic',10000,
  '55555555-5555-4555-8555-555555555510',NULL,NULL,
  'bank-match-001','hash-bank-match-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'match-replay', to_jsonb(result)
FROM banking.reconcile_statement_line_v1(
  '55555555-5555-4555-8555-555555555597',
  '55555555-5555-4555-8555-555555555512',
  'settlement','55555555-5555-4555-8555-555555555509',
  'GBP'::char(3),2::smallint,10000::bigint,'automatic',10000,
  '55555555-5555-4555-8555-555555555510',NULL,NULL,
  'bank-match-001','hash-bank-match-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'reverse', to_jsonb(result)
FROM banking.reverse_reconciliation_v1(
  '55555555-5555-4555-8555-555555555516',
  '55555555-5555-4555-8555-555555555515',
  NULL,'Incorrect settlement selected','bank-reverse-001','hash-bank-reverse-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'reverse-replay', to_jsonb(result)
FROM banking.reverse_reconciliation_v1(
  '55555555-5555-4555-8555-555555555596',
  '55555555-5555-4555-8555-555555555515',
  NULL,'Incorrect settlement selected','bank-reverse-001','hash-bank-reverse-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'rematch', to_jsonb(result)
FROM banking.reconcile_statement_line_v1(
  '55555555-5555-4555-8555-555555555517',
  '55555555-5555-4555-8555-555555555512',
  'settlement','55555555-5555-4555-8555-555555555509',
  'GBP'::char(3),2::smallint,10000::bigint,'manual',NULL,NULL,NULL,
  'Confirmed corrected settlement','bank-rematch-001','hash-bank-rematch-001'
) result;

INSERT INTO banking_results(label,payload)
SELECT 'run', to_jsonb(result)
FROM banking.record_reconciliation_run_v1(
  '55555555-5555-4555-8555-555555555518',
  '55555555-5555-4555-8555-555555555507',
  '2026-07-01','2026-07-31','bank-run-001','hash-bank-run-001'
) result;

DO $$
DECLARE
  v_import jsonb;
  v_import_replay jsonb;
  v_duplicate jsonb;
  v_match jsonb;
  v_match_replay jsonb;
  v_reverse jsonb;
  v_reverse_replay jsonb;
  v_rematch jsonb;
  v_run jsonb;
  v_balance banking.unreconciled_statement_lines_v%ROWTYPE;
BEGIN
  SELECT payload INTO v_import FROM banking_results WHERE label = 'import';
  SELECT payload INTO v_import_replay FROM banking_results WHERE label = 'import-replay';
  SELECT payload INTO v_duplicate FROM banking_results WHERE label = 'duplicate-source';
  SELECT payload INTO v_match FROM banking_results WHERE label = 'match';
  SELECT payload INTO v_match_replay FROM banking_results WHERE label = 'match-replay';
  SELECT payload INTO v_reverse FROM banking_results WHERE label = 'reverse';
  SELECT payload INTO v_reverse_replay FROM banking_results WHERE label = 'reverse-replay';
  SELECT payload INTO v_rematch FROM banking_results WHERE label = 'rematch';
  SELECT payload INTO v_run FROM banking_results WHERE label = 'run';

  IF (v_import->>'replayed')::boolean THEN RAISE EXCEPTION 'initial statement import was marked replayed'; END IF;
  IF NOT (v_import_replay->>'replayed')::boolean OR v_import_replay->>'statement_import_id' <> '55555555-5555-4555-8555-555555555511' THEN
    RAISE EXCEPTION 'statement import replay identity is incorrect';
  END IF;
  IF v_duplicate->>'status' <> 'duplicate' OR NOT (v_duplicate->>'replayed')::boolean THEN
    RAISE EXCEPTION 'duplicate statement source was not detected';
  END IF;
  IF v_match->>'statement_status' <> 'matched' OR (v_match->>'statement_unmatched_minor')::bigint <> 0 THEN
    RAISE EXCEPTION 'initial reconciliation did not fully match the statement';
  END IF;
  IF NOT (v_match_replay->>'replayed')::boolean OR v_match_replay->>'reconciliation_id' <> '55555555-5555-4555-8555-555555555515' THEN
    RAISE EXCEPTION 'reconciliation replay identity is incorrect';
  END IF;
  IF v_reverse->>'statement_status' <> 'reversed' OR (v_reverse->>'statement_unmatched_minor')::bigint <> 10000 THEN
    RAISE EXCEPTION 'reconciliation reversal did not restore the statement balance';
  END IF;
  IF NOT (v_reverse_replay->>'replayed')::boolean OR v_reverse_replay->>'reconciliation_id' <> '55555555-5555-4555-8555-555555555516' THEN
    RAISE EXCEPTION 'reconciliation reversal replay identity is incorrect';
  END IF;
  IF v_rematch->>'statement_status' <> 'matched' OR (v_rematch->>'statement_unmatched_minor')::bigint <> 0 THEN
    RAISE EXCEPTION 'corrected reconciliation did not rematch the statement';
  END IF;
  IF v_run->>'status' <> 'completed'
     OR (v_run->>'source_line_count')::bigint <> 1
     OR (v_run->>'matched_line_count')::bigint <> 1
     OR (v_run->>'difference_minor')::bigint <> 0 THEN
    RAISE EXCEPTION 'reconciliation run controls are incorrect';
  END IF;

  SELECT * INTO v_balance
    FROM banking.unreconciled_statement_lines_v
   WHERE statement_line_id = '55555555-5555-4555-8555-555555555512';
  IF v_balance.matched_minor <> 10000 OR v_balance.unmatched_minor <> 0 THEN
    RAISE EXCEPTION 'statement control balance is incorrect after correction';
  END IF;
  IF (SELECT status FROM payment.settlements WHERE id = '55555555-5555-4555-8555-555555555509') <> 'reconciled' THEN
    RAISE EXCEPTION 'settlement status was not restored to reconciled';
  END IF;
  IF (SELECT count(*) FROM banking.reconciliations WHERE statement_line_id = v_balance.statement_line_id) <> 3 THEN
    RAISE EXCEPTION 'append-only reconciliation history is incomplete';
  END IF;
  IF (SELECT count(*) FROM banking.reconciliations WHERE reversal_of_reconciliation_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'reconciliation reversal evidence is incomplete';
  END IF;
  IF (SELECT count(*) FROM platform.audit_events WHERE event_type LIKE 'banking.%') < 5 THEN
    RAISE EXCEPTION 'banking audit evidence is incomplete';
  END IF;
  IF (SELECT count(*) FROM platform.outbox_events WHERE event_type LIKE 'banking.%') < 5 THEN
    RAISE EXCEPTION 'banking outbox evidence is incomplete';
  END IF;

  BEGIN
    INSERT INTO banking.reconciliations(
      id,tenant_id,legal_entity_id,bank_account_id,statement_line_id,candidate_type,
      candidate_id,currency,scale,matched_amount_minor,status,match_method,matched_by,
      business_date,request_id,trace_id
    ) VALUES (
      gen_random_uuid(),platform.current_tenant_id(),'55555555-5555-4555-8555-555555555504',
      '55555555-5555-4555-8555-555555555507','55555555-5555-4555-8555-555555555512',
      'opening_balance','direct','GBP',2,1,'matched','manual',platform.current_actor_id(),
      '2026-07-28','direct','direct'
    );
    RAISE EXCEPTION 'runtime direct reconciliation insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
