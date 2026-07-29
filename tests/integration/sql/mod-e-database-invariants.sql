\set ON_ERROR_STOP on
BEGIN;
SET LOCAL row_security = off;

INSERT INTO platform.tenants(id,code,display_name,home_region,status,default_locale,default_time_zone) VALUES
  ('11111111-1111-4111-8111-111111111111','mod-e-a','MOD-E Tenant A','test','active','en-GB','UTC'),
  ('22222222-2222-4222-8222-222222222222','mod-e-b','MOD-E Tenant B','test','active','en-GB','UTC');
INSERT INTO platform.users(id,identity_subject,display_name,status) VALUES
  ('11111111-1111-4111-8111-111111111101','mod-e-user-a','MOD-E User A','active'),
  ('22222222-2222-4222-8222-222222222102','mod-e-user-b','MOD-E User B','active');
INSERT INTO platform.memberships(id,tenant_id,user_id,status) VALUES
  ('11111111-1111-4111-8111-111111111121','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111101','active'),
  ('22222222-2222-4222-8222-222222222122','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222102','active');
INSERT INTO platform.legal_entities(id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status) VALUES
  ('11111111-1111-4111-8111-111111111201','11111111-1111-4111-8111-111111111111','A','Entity A','GBP','GB','UTC','active'),
  ('22222222-2222-4222-8222-222222222202','22222222-2222-4222-8222-222222222222','B','Entity B','GBP','GB','UTC','active');

INSERT INTO accounting.charts(id,tenant_id,legal_entity_id,code,display_name,base_currency) VALUES
  ('11111111-1111-4111-8111-111111111301','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','MAIN','Main chart','GBP');
INSERT INTO accounting.accounts(id,tenant_id,chart_id,code,display_name,account_type,normal_balance,control_type,allow_manual_posting,effective_from) VALUES
  ('11111111-1111-4111-8111-111111111311','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111301','1100','Bank','asset','debit','bank',true,'2026-01-01'),
  ('11111111-1111-4111-8111-111111111312','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111301','1200','Receivable','asset','debit','accounts_receivable',true,'2026-01-01'),
  ('11111111-1111-4111-8111-111111111313','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111301','4000','Revenue','revenue','credit',NULL,true,'2026-01-01');
INSERT INTO accounting.fiscal_periods(id,tenant_id,legal_entity_id,code,start_date,end_date,status) VALUES
  ('11111111-1111-4111-8111-111111111321','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','2026-07','2026-07-01','2026-07-31','open');

INSERT INTO payment.provider_accounts(id,tenant_id,legal_entity_id,code,provider_key,display_name) VALUES
  ('11111111-1111-4111-8111-111111111401','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','SIM','simulator','Simulator A'),
  ('22222222-2222-4222-8222-222222222402','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222202','SIM','simulator','Simulator B');
INSERT INTO payment.payment_intents(id,tenant_id,legal_entity_id,provider_account_id,source_type,source_id,source_version,currency,scale,amount_minor,created_by) VALUES
  ('11111111-1111-4111-8111-111111111411','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','11111111-1111-4111-8111-111111111401','invoice','invoice-a','1','GBP',2,10000,'11111111-1111-4111-8111-111111111101'),
  ('22222222-2222-4222-8222-222222222412','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222202','22222222-2222-4222-8222-222222222402','invoice','invoice-b','1','GBP',2,2500,'22222222-2222-4222-8222-222222222102');

DO $$
BEGIN
  BEGIN
    UPDATE payment.payment_intents SET amount_minor = 9999 WHERE id = '11111111-1111-4111-8111-111111111411';
    RAISE EXCEPTION 'payment identity mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO payment.settlements(id,tenant_id,legal_entity_id,provider_account_id,provider_settlement_id,currency,scale,gross_minor,fee_minor,adjustment_minor,net_minor,settled_at,source_hash)
    VALUES ('11111111-1111-4111-8111-111111111421','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','11111111-1111-4111-8111-111111111401','bad','GBP',2,10000,300,0,9999,now(),'bad');
    RAISE EXCEPTION 'invalid settlement arithmetic unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO accounting.posting_groups(id,tenant_id,legal_entity_id,source_type,source_id,source_version,business_date,correlation_id) VALUES
  ('11111111-1111-4111-8111-111111111501','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','payment','payment-a','1','2026-07-28','mod-e-test');
INSERT INTO accounting.journal_entries(id,tenant_id,legal_entity_id,chart_id,fiscal_period_id,posting_group_id,journal_type,source_type,source_id,source_version,transaction_currency,transaction_scale,base_currency,base_scale,total_debit_minor,total_credit_minor,total_base_debit_minor,total_base_credit_minor,business_date,posted_by,request_id,trace_id) VALUES
  ('11111111-1111-4111-8111-111111111511','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','11111111-1111-4111-8111-111111111301','11111111-1111-4111-8111-111111111321','11111111-1111-4111-8111-111111111501','system','payment','payment-a','1','GBP',2,'GBP',2,10000,10000,10000,10000,'2026-07-28','11111111-1111-4111-8111-111111111101','mod-e-test','mod-e-test');
INSERT INTO accounting.journal_lines(id,tenant_id,journal_entry_id,line_number,account_id,transaction_debit_minor,transaction_credit_minor,base_debit_minor,base_credit_minor) VALUES
  ('11111111-1111-4111-8111-111111111521','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111511',1,'11111111-1111-4111-8111-111111111312',10000,0,10000,0),
  ('11111111-1111-4111-8111-111111111522','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111511',2,'11111111-1111-4111-8111-111111111313',0,10000,0,10000);
SET CONSTRAINTS accounting.accounting_journal_balance_deferred IMMEDIATE;
SET CONSTRAINTS accounting.accounting_journal_balance_deferred DEFERRED;

DO $$
BEGIN
  BEGIN
    UPDATE accounting.journal_entries SET source_version = '2' WHERE id = '11111111-1111-4111-8111-111111111511';
    RAISE EXCEPTION 'posted journal mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO accounting.posting_groups(id,tenant_id,legal_entity_id,source_type,source_id,source_version,business_date,correlation_id) VALUES
      ('11111111-1111-4111-8111-111111111502','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','manual','bad','1','2026-07-28','mod-e-bad');
    INSERT INTO accounting.journal_entries(id,tenant_id,legal_entity_id,chart_id,fiscal_period_id,posting_group_id,journal_type,source_type,source_id,source_version,transaction_currency,transaction_scale,base_currency,base_scale,total_debit_minor,total_credit_minor,total_base_debit_minor,total_base_credit_minor,business_date,posted_by,request_id,trace_id) VALUES
      ('11111111-1111-4111-8111-111111111512','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','11111111-1111-4111-8111-111111111301','11111111-1111-4111-8111-111111111321','11111111-1111-4111-8111-111111111502','manual','manual','bad','1','GBP',2,'GBP',2,100,100,100,100,'2026-07-28','11111111-1111-4111-8111-111111111101','mod-e-bad','mod-e-bad');
    INSERT INTO accounting.journal_lines(id,tenant_id,journal_entry_id,line_number,account_id,transaction_debit_minor,transaction_credit_minor,base_debit_minor,base_credit_minor) VALUES
      ('11111111-1111-4111-8111-111111111523','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111512',1,'11111111-1111-4111-8111-111111111312',100,0,100,0),
      ('11111111-1111-4111-8111-111111111524','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111512',2,'11111111-1111-4111-8111-111111111313',0,90,0,90);
    SET CONSTRAINTS accounting.accounting_journal_balance_deferred IMMEDIATE;
    RAISE EXCEPTION 'unbalanced journal unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    SET CONSTRAINTS accounting.accounting_journal_balance_deferred DEFERRED;
  END;
END $$;

INSERT INTO banking.bank_accounts(id,tenant_id,legal_entity_id,ledger_account_id,code,display_name,bank_name,account_reference_masked,currency,scale) VALUES
  ('11111111-1111-4111-8111-111111111601','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111201','11111111-1111-4111-8111-111111111311','BANK-1','Primary bank','Test Bank','****1234','GBP',2);
INSERT INTO banking.statement_imports(id,tenant_id,bank_account_id,source_type,source_name,source_hash,status,line_count,imported_by,request_id,trace_id) VALUES
  ('11111111-1111-4111-8111-111111111611','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111601','csv','test.csv','hash-a','completed',1,'11111111-1111-4111-8111-111111111101','mod-e-test','mod-e-test');
INSERT INTO banking.statement_lines(id,tenant_id,bank_account_id,statement_import_id,line_number,fingerprint,booked_at,currency,scale,amount_minor,reference) VALUES
  ('11111111-1111-4111-8111-111111111621','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111601','11111111-1111-4111-8111-111111111611',1,'fingerprint-a',now(),'GBP',2,10000,'SETTLEMENT-A');
DO $$
BEGIN
  BEGIN
    UPDATE banking.statement_lines SET reference = 'CHANGED' WHERE id = '11111111-1111-4111-8111-111111111621';
    RAISE EXCEPTION 'statement mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END $$;

SET LOCAL row_security = on;
SET LOCAL ROLE store_app_runtime;
SELECT platform.set_request_context('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111101',NULL,NULL,NULL,NULL,'2026-07-28','mod-e-rls','mod-e-rls');
DO $$
BEGIN
  IF (SELECT count(*) FROM payment.payment_intents) <> 1 THEN
    RAISE EXCEPTION 'tenant isolation did not return exactly one payment intent';
  END IF;
  IF EXISTS (SELECT 1 FROM payment.payment_intents WHERE tenant_id <> platform.current_tenant_id()) THEN
    RAISE EXCEPTION 'cross-tenant payment intent leaked through RLS';
  END IF;
  BEGIN
    INSERT INTO payment.provider_accounts(id,tenant_id,legal_entity_id,code,provider_key,display_name)
    VALUES (gen_random_uuid(),platform.current_tenant_id(),'11111111-1111-4111-8111-111111111201','NO','none','Denied');
    RAISE EXCEPTION 'runtime direct DML unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
