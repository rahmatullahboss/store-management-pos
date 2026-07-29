\set ON_ERROR_STOP on
BEGIN;
SET LOCAL row_security = off;

INSERT INTO platform.tenants(id,code,display_name,home_region,status,default_locale,default_time_zone)
VALUES ('66666666-6666-4666-8666-666666666601','mod-e-ready','MOD-E Readiness Tenant','test','active','en-GB','UTC');
INSERT INTO platform.users(id,identity_subject,display_name,status)
VALUES ('66666666-6666-4666-8666-666666666602','mod-e-readiness-user','MOD-E Readiness User','active');
INSERT INTO platform.memberships(id,tenant_id,user_id,status)
VALUES ('66666666-6666-4666-8666-666666666603','66666666-6666-4666-8666-666666666601','66666666-6666-4666-8666-666666666602','active');
INSERT INTO platform.legal_entities(id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status)
VALUES ('66666666-6666-4666-8666-666666666604','66666666-6666-4666-8666-666666666601','RDY','Readiness Entity','GBP','GB','UTC','active');

SET LOCAL row_security = on;
SET LOCAL ROLE store_app_runtime;
SELECT platform.set_request_context(
  '66666666-6666-4666-8666-666666666601',
  '66666666-6666-4666-8666-666666666602',
  '66666666-6666-4666-8666-666666666604',
  NULL,NULL,NULL,'2026-07-29','finance-readiness','finance-readiness'
);

CREATE TEMP TABLE finance_readiness_result ON COMMIT DROP AS
SELECT
  (SELECT count(*)::bigint FROM platform.schema_migrations
    WHERE migration_id IN ('PAY-0002','ACC-0002','BNK-0002')) AS migration_count,
  (SELECT count(*)::bigint FROM payment.payment_intents
    WHERE status = 'unknown'
      AND COALESCE(unknown_since, last_observed_at, created_at) < now() - interval '15 minutes') AS unknown_payment_count,
  (SELECT count(*)::bigint FROM platform.idempotency_records
    WHERE status = 'processing' AND updated_at < now() - interval '10 minutes'
      AND (scope LIKE 'payment.%' OR scope LIKE 'payments.%' OR scope LIKE 'accounting.%' OR scope LIKE 'banking.%')) AS stuck_idempotency_count,
  (SELECT count(*)::bigint FROM accounting.journal_entries
    WHERE total_debit_minor <> total_credit_minor
       OR total_base_debit_minor <> total_base_credit_minor) AS unbalanced_journal_count,
  (SELECT count(*)::bigint FROM banking.unreconciled_statement_lines_v
    WHERE unmatched_minor <> 0 AND booked_at < now() - interval '24 hours') AS stale_unreconciled_count,
  (SELECT count(*)::bigint FROM banking.reconciliation_exceptions
    WHERE status IN ('open','investigating','reopened')) AS open_reconciliation_exception_count,
  (SELECT count(*)::bigint FROM platform.outbox_events
    WHERE published_at IS NULL AND occurred_at < now() - interval '5 minutes'
      AND (event_type LIKE 'payment.%' OR event_type LIKE 'accounting.%' OR event_type LIKE 'banking.%')) AS stale_outbox_count,
  (SELECT count(*)::bigint FROM platform.dead_letter_records
    WHERE replay_status = 'pending'
      AND (source LIKE 'payment%' OR source LIKE 'accounting%' OR source LIKE 'banking%' OR source LIKE 'finance%')) AS finance_dead_letter_count;

DO $$
DECLARE
  v_result finance_readiness_result%ROWTYPE;
BEGIN
  SELECT * INTO v_result FROM finance_readiness_result;
  IF v_result.migration_count <> 3 THEN
    RAISE EXCEPTION 'finance command migration readiness is incomplete: %', v_result.migration_count;
  END IF;
  IF v_result.unknown_payment_count <> 0
     OR v_result.stuck_idempotency_count <> 0
     OR v_result.unbalanced_journal_count <> 0
     OR v_result.stale_unreconciled_count <> 0
     OR v_result.open_reconciliation_exception_count <> 0
     OR v_result.stale_outbox_count <> 0
     OR v_result.finance_dead_letter_count <> 0 THEN
    RAISE EXCEPTION 'fresh finance readiness controls are not clean';
  END IF;
END $$;

ROLLBACK;
