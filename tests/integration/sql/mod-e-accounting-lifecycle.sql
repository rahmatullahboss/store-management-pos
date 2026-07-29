\set ON_ERROR_STOP on
BEGIN;
SET LOCAL row_security = off;

INSERT INTO platform.tenants(id,code,display_name,home_region,status,default_locale,default_time_zone)
VALUES ('44444444-4444-4444-8444-444444444401','mod-e-acc','MOD-E Accounting Tenant','test','active','en-GB','UTC');
INSERT INTO platform.users(id,identity_subject,display_name,status)
VALUES ('44444444-4444-4444-8444-444444444402','mod-e-accounting-user','MOD-E Accounting User','active');
INSERT INTO platform.memberships(id,tenant_id,user_id,status)
VALUES ('44444444-4444-4444-8444-444444444403','44444444-4444-4444-8444-444444444401','44444444-4444-4444-8444-444444444402','active');
INSERT INTO platform.legal_entities(id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status)
VALUES ('44444444-4444-4444-8444-444444444404','44444444-4444-4444-8444-444444444401','ACC','Accounting Entity','GBP','GB','UTC','active');

INSERT INTO platform.approval_requests(
  id,tenant_id,action_code,requested_by,target_type,target_id,reason,status,payload_hash,resolved_at
) VALUES
  ('44444444-4444-4444-8444-444444444405','44444444-4444-4444-8444-444444444401','accounting.journal.reverse','44444444-4444-4444-8444-444444444402','accounting.journal','44444444-4444-4444-8444-444444444423','Reverse receipt','approved','hash-reverse',now()),
  ('44444444-4444-4444-8444-444444444406','44444444-4444-4444-8444-444444444401','accounting.period.close','44444444-4444-4444-8444-444444444402','accounting.fiscal_period','44444444-4444-4444-8444-444444444410','Close July','approved','hash-close',now()),
  ('44444444-4444-4444-8444-444444444407','44444444-4444-4444-8444-444444444401','accounting.period.reopen','44444444-4444-4444-8444-444444444402','accounting.fiscal_period','44444444-4444-4444-8444-444444444410','Reopen July','approved','hash-reopen',now());

INSERT INTO accounting.charts(id,tenant_id,legal_entity_id,code,display_name,base_currency)
VALUES ('44444444-4444-4444-8444-444444444408','44444444-4444-4444-8444-444444444401','44444444-4444-4444-8444-444444444404','MAIN','Main chart','GBP');
INSERT INTO accounting.accounts(
  id,tenant_id,chart_id,code,display_name,account_type,normal_balance,control_type,allow_manual_posting,effective_from
) VALUES
  ('44444444-4444-4444-8444-444444444411','44444444-4444-4444-8444-444444444401','44444444-4444-4444-8444-444444444408','1100','Bank','asset','debit','bank',true,'2026-01-01'),
  ('44444444-4444-4444-8444-444444444412','44444444-4444-4444-8444-444444444401','44444444-4444-4444-8444-444444444408','1200','Accounts receivable','asset','debit','accounts_receivable',true,'2026-01-01'),
  ('44444444-4444-4444-8444-444444444413','44444444-4444-4444-8444-444444444401','44444444-4444-4444-8444-444444444408','4000','Revenue','revenue','credit',NULL,true,'2026-01-01');
INSERT INTO accounting.fiscal_periods(id,tenant_id,legal_entity_id,code,start_date,end_date,status)
VALUES ('44444444-4444-4444-8444-444444444410','44444444-4444-4444-8444-444444444401','44444444-4444-4444-8444-444444444404','2026-07','2026-07-01','2026-07-31','open');

SET LOCAL row_security = on;
SET LOCAL ROLE store_app_runtime;
SELECT platform.set_request_context(
  '44444444-4444-4444-8444-444444444401',
  '44444444-4444-4444-8444-444444444402',
  '44444444-4444-4444-8444-444444444404',
  NULL,NULL,NULL,'2026-07-28','accounting-lifecycle','accounting-lifecycle'
);

CREATE TEMP TABLE accounting_results(label text PRIMARY KEY, payload jsonb) ON COMMIT DROP;

INSERT INTO accounting_results(label,payload)
SELECT 'invoice-journal', to_jsonb(result)
FROM accounting.post_journal_v1(
  '44444444-4444-4444-8444-444444444420',
  '44444444-4444-4444-8444-444444444421',
  '44444444-4444-4444-8444-444444444408',
  '44444444-4444-4444-8444-444444444410',
  NULL,'system','ordinary','invoice','invoice-001','1',
  'GBP'::char(3),2::smallint,'GBP'::char(3),2::smallint,1::bigint,1::bigint,
  jsonb_build_array(
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444412','accountCode','1200','debitMinor',10000,'creditMinor',0,'baseDebitMinor',10000,'baseCreditMinor',0,'partyType','customer','partyId','customer-001'),
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444413','accountCode','4000','debitMinor',0,'creditMinor',10000,'baseDebitMinor',0,'baseCreditMinor',10000)
  ),
  NULL,NULL,NULL,'journal-invoice-001','hash-journal-invoice-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'invoice-replay', to_jsonb(result)
FROM accounting.post_journal_v1(
  '44444444-4444-4444-8444-444444444499',
  '44444444-4444-4444-8444-444444444498',
  '44444444-4444-4444-8444-444444444408',
  '44444444-4444-4444-8444-444444444410',
  NULL,'system','ordinary','invoice','invoice-001','1',
  'GBP'::char(3),2::smallint,'GBP'::char(3),2::smallint,1::bigint,1::bigint,
  jsonb_build_array(
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444412','accountCode','1200','debitMinor',10000,'creditMinor',0,'baseDebitMinor',10000,'baseCreditMinor',0,'partyType','customer','partyId','customer-001'),
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444413','accountCode','4000','debitMinor',0,'creditMinor',10000,'baseDebitMinor',0,'baseCreditMinor',10000)
  ),
  NULL,NULL,NULL,'journal-invoice-001','hash-journal-invoice-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'open-item', to_jsonb(result)
FROM accounting.create_open_item_v1(
  '44444444-4444-4444-8444-444444444422',
  '44444444-4444-4444-8444-444444444412',
  'customer','customer-001','receivable','invoice','invoice-001','1',
  'GBP'::char(3),2::smallint,10000::bigint,'2026-08-15',
  '44444444-4444-4444-8444-444444444420',
  'open-item-create-001','hash-open-item-create-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'receipt-journal', to_jsonb(result)
FROM accounting.post_journal_v1(
  '44444444-4444-4444-8444-444444444423',
  '44444444-4444-4444-8444-444444444424',
  '44444444-4444-4444-8444-444444444408',
  '44444444-4444-4444-8444-444444444410',
  NULL,'system','ordinary','payment','payment-001','1',
  'GBP'::char(3),2::smallint,'GBP'::char(3),2::smallint,1::bigint,1::bigint,
  jsonb_build_array(
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444411','accountCode','1100','debitMinor',4000,'creditMinor',0,'baseDebitMinor',4000,'baseCreditMinor',0),
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444412','accountCode','1200','debitMinor',0,'creditMinor',4000,'baseDebitMinor',0,'baseCreditMinor',4000,'partyType','customer','partyId','customer-001')
  ),
  NULL,NULL,NULL,'journal-receipt-001','hash-journal-receipt-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'allocation', to_jsonb(result)
FROM accounting.allocate_open_item_v1(
  '44444444-4444-4444-8444-444444444425',
  '44444444-4444-4444-8444-444444444422',
  'payment','payment-001','GBP'::char(3),2::smallint,4000::bigint,
  '44444444-4444-4444-8444-444444444423',NULL,NULL,
  'open-allocation-001','hash-open-allocation-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'allocation-replay', to_jsonb(result)
FROM accounting.allocate_open_item_v1(
  '44444444-4444-4444-8444-444444444497',
  '44444444-4444-4444-8444-444444444422',
  'payment','payment-001','GBP'::char(3),2::smallint,4000::bigint,
  '44444444-4444-4444-8444-444444444423',NULL,NULL,
  'open-allocation-001','hash-open-allocation-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'reversal-journal', to_jsonb(result)
FROM accounting.post_journal_v1(
  '44444444-4444-4444-8444-444444444426',
  '44444444-4444-4444-8444-444444444427',
  '44444444-4444-4444-8444-444444444408',
  '44444444-4444-4444-8444-444444444410',
  NULL,'reversal','reversal','journal_reversal','44444444-4444-4444-8444-444444444423','1',
  'GBP'::char(3),2::smallint,'GBP'::char(3),2::smallint,1::bigint,1::bigint,
  jsonb_build_array(
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444411','accountCode','1100','debitMinor',0,'creditMinor',4000,'baseDebitMinor',0,'baseCreditMinor',4000),
    jsonb_build_object('accountId','44444444-4444-4444-8444-444444444412','accountCode','1200','debitMinor',4000,'creditMinor',0,'baseDebitMinor',4000,'baseCreditMinor',0,'partyType','customer','partyId','customer-001')
  ),
  '44444444-4444-4444-8444-444444444405','Reverse receipt','44444444-4444-4444-8444-444444444423',
  'journal-reverse-001','hash-journal-reverse-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'allocation-reversal', to_jsonb(result)
FROM accounting.allocate_open_item_v1(
  '44444444-4444-4444-8444-444444444428',
  '44444444-4444-4444-8444-444444444422',
  'journal_reversal','44444444-4444-4444-8444-444444444426',
  'GBP'::char(3),2::smallint,4000::bigint,
  '44444444-4444-4444-8444-444444444426','Reverse receipt allocation',
  '44444444-4444-4444-8444-444444444425',
  'allocation-reverse-001','hash-allocation-reverse-001'
) result;

INSERT INTO accounting_results(label,payload)
SELECT 'period-close', to_jsonb(result)
FROM accounting.close_period_v1(
  '44444444-4444-4444-8444-444444444410',
  '44444444-4444-4444-8444-444444444406',
  'period-close-001','hash-period-close-001',
  jsonb_build_object('trialBalanceBalanced',true,'openItemReviewComplete',true)
) result;

DO $$
BEGIN
  BEGIN
    PERFORM * FROM accounting.post_journal_v1(
      '44444444-4444-4444-8444-444444444429',
      '44444444-4444-4444-8444-444444444430',
      '44444444-4444-4444-8444-444444444408',
      '44444444-4444-4444-8444-444444444410',
      NULL,'system','ordinary','invoice','closed-period-invoice','1',
      'GBP'::char(3),2::smallint,'GBP'::char(3),2::smallint,1::bigint,1::bigint,
      jsonb_build_array(
        jsonb_build_object('accountId','44444444-4444-4444-8444-444444444412','accountCode','1200','debitMinor',100,'creditMinor',0,'baseDebitMinor',100,'baseCreditMinor',0,'partyType','customer','partyId','customer-002'),
        jsonb_build_object('accountId','44444444-4444-4444-8444-444444444413','accountCode','4000','debitMinor',0,'creditMinor',100,'baseDebitMinor',0,'baseCreditMinor',100)
      ),
      NULL,NULL,NULL,'closed-period-post-001','hash-closed-period-post-001'
    );
    RAISE EXCEPTION 'ordinary closed-period journal unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT ILIKE '%closed%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO accounting_results(label,payload)
SELECT 'period-reopen', to_jsonb(result)
FROM accounting.reopen_period_v1(
  '44444444-4444-4444-8444-444444444410',
  '44444444-4444-4444-8444-444444444407',
  'Approved correction window','period-reopen-001','hash-period-reopen-001'
) result;

DO $$
DECLARE
  v_invoice jsonb;
  v_invoice_replay jsonb;
  v_allocation jsonb;
  v_allocation_replay jsonb;
  v_allocation_reversal jsonb;
  v_close jsonb;
  v_reopen jsonb;
  v_balance accounting.open_item_balances_v%ROWTYPE;
BEGIN
  SELECT payload INTO v_invoice FROM accounting_results WHERE label = 'invoice-journal';
  SELECT payload INTO v_invoice_replay FROM accounting_results WHERE label = 'invoice-replay';
  SELECT payload INTO v_allocation FROM accounting_results WHERE label = 'allocation';
  SELECT payload INTO v_allocation_replay FROM accounting_results WHERE label = 'allocation-replay';
  SELECT payload INTO v_allocation_reversal FROM accounting_results WHERE label = 'allocation-reversal';
  SELECT payload INTO v_close FROM accounting_results WHERE label = 'period-close';
  SELECT payload INTO v_reopen FROM accounting_results WHERE label = 'period-reopen';

  IF (v_invoice->>'replayed')::boolean THEN RAISE EXCEPTION 'initial journal was marked replayed'; END IF;
  IF NOT (v_invoice_replay->>'replayed')::boolean THEN RAISE EXCEPTION 'journal replay was not detected'; END IF;
  IF v_invoice_replay->>'journal_id' <> '44444444-4444-4444-8444-444444444420' THEN RAISE EXCEPTION 'journal replay returned a new identity'; END IF;
  IF (v_allocation->>'outstanding_minor')::bigint <> 6000 THEN RAISE EXCEPTION 'partial allocation outstanding is incorrect'; END IF;
  IF NOT (v_allocation_replay->>'replayed')::boolean THEN RAISE EXCEPTION 'allocation replay was not detected'; END IF;
  IF (v_allocation_reversal->>'outstanding_minor')::bigint <> 10000 THEN RAISE EXCEPTION 'allocation reversal did not restore outstanding amount'; END IF;
  IF v_close->>'status' <> 'closed' OR v_reopen->>'status' <> 'open' THEN RAISE EXCEPTION 'period close/reopen state is incorrect'; END IF;

  SELECT * INTO v_balance FROM accounting.open_item_balances_v
   WHERE open_item_id = '44444444-4444-4444-8444-444444444422';
  IF v_balance.allocated_minor <> 0 OR v_balance.outstanding_minor <> 10000 THEN
    RAISE EXCEPTION 'open-item balance is incorrect after reversal';
  END IF;
  IF (SELECT count(*) FROM accounting.journal_entries) <> 3 THEN
    RAISE EXCEPTION 'unexpected journal count';
  END IF;
  IF (SELECT count(*) FROM accounting.journal_entries WHERE reversal_of_journal_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'journal reversal evidence is incomplete';
  END IF;
  IF (SELECT count(*) FROM accounting.open_item_allocations WHERE open_item_id = v_balance.open_item_id) <> 2 THEN
    RAISE EXCEPTION 'allocation append-only history is incomplete';
  END IF;
  IF (SELECT count(*) FROM platform.audit_events WHERE target_id IN (
    '44444444-4444-4444-8444-444444444420',
    '44444444-4444-4444-8444-444444444423',
    '44444444-4444-4444-8444-444444444426',
    '44444444-4444-4444-8444-444444444422',
    '44444444-4444-4444-8444-444444444410'
  )) < 8 THEN RAISE EXCEPTION 'accounting audit evidence is incomplete'; END IF;
  IF (SELECT count(*) FROM platform.outbox_events WHERE aggregate_id IN (
    '44444444-4444-4444-8444-444444444420',
    '44444444-4444-4444-8444-444444444423',
    '44444444-4444-4444-8444-444444444426',
    '44444444-4444-4444-8444-444444444422',
    '44444444-4444-4444-8444-444444444410'
  )) < 8 THEN RAISE EXCEPTION 'accounting outbox evidence is incomplete'; END IF;

  BEGIN
    INSERT INTO accounting.open_item_allocations(
      id,tenant_id,open_item_id,source_type,source_id,currency,scale,amount_minor,
      business_date,journal_entry_id,actor_id
    ) VALUES (
      gen_random_uuid(),platform.current_tenant_id(),v_balance.open_item_id,
      'direct','direct','GBP',2,1,'2026-07-28',
      '44444444-4444-4444-8444-444444444420',platform.current_actor_id()
    );
    RAISE EXCEPTION 'runtime direct allocation insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
