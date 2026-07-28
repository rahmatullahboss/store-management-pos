\set ON_ERROR_STOP on
BEGIN;
SET LOCAL row_security = off;

INSERT INTO platform.tenants(id,code,display_name,home_region,status,default_locale,default_time_zone)
VALUES ('33333333-3333-4333-8333-333333333301','mod-e-pay','MOD-E Payment Tenant','test','active','en-GB','UTC');
INSERT INTO platform.users(id,identity_subject,display_name,status)
VALUES ('33333333-3333-4333-8333-333333333302','mod-e-payment-user','MOD-E Payment User','active');
INSERT INTO platform.memberships(id,tenant_id,user_id,status)
VALUES ('33333333-3333-4333-8333-333333333303','33333333-3333-4333-8333-333333333301','33333333-3333-4333-8333-333333333302','active');
INSERT INTO platform.legal_entities(id,tenant_id,code,legal_name,base_currency,country_code,time_zone,status)
VALUES ('33333333-3333-4333-8333-333333333304','33333333-3333-4333-8333-333333333301','PAY','Payment Entity','GBP','GB','UTC','active');
INSERT INTO payment.provider_accounts(id,tenant_id,legal_entity_id,code,provider_key,display_name)
VALUES ('33333333-3333-4333-8333-333333333305','33333333-3333-4333-8333-333333333301','33333333-3333-4333-8333-333333333304','SIM','simulator','Simulator');

SET LOCAL row_security = on;
SET LOCAL ROLE store_app_runtime;
SELECT platform.set_request_context(
  '33333333-3333-4333-8333-333333333301',
  '33333333-3333-4333-8333-333333333302',
  '33333333-3333-4333-8333-333333333304',
  NULL,NULL,NULL,'2026-07-28','payment-lifecycle','payment-lifecycle'
);

CREATE TEMP TABLE lifecycle_results(label text PRIMARY KEY, payload jsonb) ON COMMIT DROP;

INSERT INTO lifecycle_results(label,payload)
SELECT 'create', to_jsonb(result)
FROM payment.create_intent_v1(
  '33333333-3333-4333-8333-333333333310',
  '33333333-3333-4333-8333-333333333305',
  'invoice','invoice-001','1','GBP'::char(3),2::smallint,12500::bigint,'method-reference-001',
  'intent-create-001','hash-intent-create-001'
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'create-replay', to_jsonb(result)
FROM payment.create_intent_v1(
  '33333333-3333-4333-8333-333333333399',
  '33333333-3333-4333-8333-333333333305',
  'invoice','invoice-001','1','GBP'::char(3),2::smallint,12500::bigint,'method-reference-001',
  'intent-create-001','hash-intent-create-001'
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'authorize-begin', to_jsonb(result)
FROM payment.begin_attempt_v1(
  '33333333-3333-4333-8333-333333333311',
  '33333333-3333-4333-8333-333333333310',
  'authorize','intent-authorize-001','hash-authorize-001',NULL::bigint
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'authorize-complete', to_jsonb(result)
FROM payment.complete_attempt_v1(
  '33333333-3333-4333-8333-333333333312',
  '33333333-3333-4333-8333-333333333311',
  'authorized','succeeded','sim_intent_001','2026-07-28T10:00:00Z',NULL,NULL
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'authorize-replay', to_jsonb(result)
FROM payment.begin_attempt_v1(
  '33333333-3333-4333-8333-333333333398',
  '33333333-3333-4333-8333-333333333310',
  'authorize','intent-authorize-001','hash-authorize-001',NULL::bigint
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'capture-begin', to_jsonb(result)
FROM payment.begin_attempt_v1(
  '33333333-3333-4333-8333-333333333313',
  '33333333-3333-4333-8333-333333333310',
  'capture','intent-capture-001','hash-capture-001',12500::bigint
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'capture-ambiguous', to_jsonb(result)
FROM payment.complete_attempt_v1(
  '33333333-3333-4333-8333-333333333314',
  '33333333-3333-4333-8333-333333333313',
  'unknown','ambiguous','sim_intent_001','2026-07-28T10:01:00Z','provider_unavailable','timeout_after_effect'
) result;

DO $$
BEGIN
  BEGIN
    PERFORM * FROM payment.begin_attempt_v1(
      '33333333-3333-4333-8333-333333333397',
      '33333333-3333-4333-8333-333333333310',
      'capture','intent-capture-002','hash-capture-002',12500::bigint
    );
    RAISE EXCEPTION 'blind capture retry unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT ILIKE '%status recovery%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO lifecycle_results(label,payload)
SELECT 'recovery-begin', to_jsonb(result)
FROM payment.begin_attempt_v1(
  '33333333-3333-4333-8333-333333333315',
  '33333333-3333-4333-8333-333333333310',
  'status_query','intent-recover-001','hash-recover-001',NULL::bigint
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'recovery-complete', to_jsonb(result)
FROM payment.complete_attempt_v1(
  '33333333-3333-4333-8333-333333333316',
  '33333333-3333-4333-8333-333333333315',
  'captured','succeeded','sim_intent_001','2026-07-28T10:02:00Z',NULL,NULL
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'refund-begin', to_jsonb(result)
FROM payment.begin_refund_v1(
  '33333333-3333-4333-8333-333333333317',
  '33333333-3333-4333-8333-333333333318',
  '33333333-3333-4333-8333-333333333310',
  'GBP'::char(3),2::smallint,12500::bigint,'Customer return',NULL,
  'refund-create-001','hash-refund-create-001'
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'refund-complete', to_jsonb(result)
FROM payment.complete_refund_v1(
  '33333333-3333-4333-8333-333333333319',
  '33333333-3333-4333-8333-333333333317',
  '33333333-3333-4333-8333-333333333318',
  'succeeded','sim_intent_001','2026-07-28T10:03:00Z',NULL,NULL
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'settlement-import', to_jsonb(result)
FROM payment.import_settlement_v1(
  '33333333-3333-4333-8333-333333333320',
  '33333333-3333-4333-8333-333333333305',
  'provider-settlement-001','GBP'::char(3),2::smallint,12500::bigint,300::bigint,-50::bigint,12250::bigint,
  '2026-07-28T12:00:00Z','source-hash-001','settlement-import-001','hash-settlement-import-001'
) result;

INSERT INTO lifecycle_results(label,payload)
SELECT 'settlement-replay', to_jsonb(result)
FROM payment.import_settlement_v1(
  '33333333-3333-4333-8333-333333333396',
  '33333333-3333-4333-8333-333333333305',
  'provider-settlement-001','GBP'::char(3),2::smallint,12500::bigint,300::bigint,-50::bigint,12250::bigint,
  '2026-07-28T12:00:00Z','source-hash-001','settlement-import-001','hash-settlement-import-001'
) result;

DO $$
DECLARE
  v_intent payment.payment_intents%ROWTYPE;
  v_create jsonb;
  v_create_replay jsonb;
  v_authorize_replay jsonb;
  v_settlement_replay jsonb;
BEGIN
  SELECT * INTO v_intent FROM payment.payment_intents
   WHERE id = '33333333-3333-4333-8333-333333333310';
  IF v_intent.status <> 'refunded' OR v_intent.amount_minor <> 12500
     OR v_intent.captured_minor <> 12500 OR v_intent.refunded_minor <> 12500 THEN
    RAISE EXCEPTION 'payment totals or final status are incorrect: %', row_to_json(v_intent);
  END IF;

  SELECT payload INTO v_create FROM lifecycle_results WHERE label = 'create';
  SELECT payload INTO v_create_replay FROM lifecycle_results WHERE label = 'create-replay';
  SELECT payload INTO v_authorize_replay FROM lifecycle_results WHERE label = 'authorize-replay';
  SELECT payload INTO v_settlement_replay FROM lifecycle_results WHERE label = 'settlement-replay';
  IF (v_create->>'replayed')::boolean THEN RAISE EXCEPTION 'initial intent create was marked replayed'; END IF;
  IF NOT (v_create_replay->>'replayed')::boolean THEN RAISE EXCEPTION 'intent replay was not detected'; END IF;
  IF (v_create_replay->>'intent_id') <> '33333333-3333-4333-8333-333333333310' THEN RAISE EXCEPTION 'intent replay returned a new identity'; END IF;
  IF (v_authorize_replay->>'execute')::boolean OR NOT (v_authorize_replay->>'replayed')::boolean THEN RAISE EXCEPTION 'completed provider attempt was not replayed'; END IF;
  IF NOT (v_settlement_replay->>'replayed')::boolean THEN RAISE EXCEPTION 'settlement replay was not detected'; END IF;

  IF (SELECT count(*) FROM payment.payment_attempts WHERE payment_intent_id = v_intent.id) <> 4 THEN
    RAISE EXCEPTION 'unexpected payment attempt count';
  END IF;
  IF (SELECT count(*) FROM payment.payment_attempt_results par JOIN payment.payment_attempts pa ON pa.tenant_id=par.tenant_id AND pa.id=par.payment_attempt_id WHERE pa.payment_intent_id = v_intent.id) <> 4 THEN
    RAISE EXCEPTION 'unexpected payment attempt result count';
  END IF;
  IF (SELECT count(*) FROM payment.payment_state_events WHERE payment_intent_id = v_intent.id) < 5 THEN
    RAISE EXCEPTION 'payment state event evidence is incomplete';
  END IF;
  IF (SELECT count(*) FROM platform.audit_events WHERE target_id IN (v_intent.id::text,'33333333-3333-4333-8333-333333333317','33333333-3333-4333-8333-333333333320')) < 6 THEN
    RAISE EXCEPTION 'payment audit evidence is incomplete';
  END IF;
  IF (SELECT count(*) FROM platform.outbox_events WHERE aggregate_id IN (v_intent.id::text,'33333333-3333-4333-8333-333333333317','33333333-3333-4333-8333-333333333320')) < 6 THEN
    RAISE EXCEPTION 'payment outbox evidence is incomplete';
  END IF;

  BEGIN
    INSERT INTO payment.payment_attempt_results(
      id,tenant_id,payment_attempt_id,outcome,resulting_status,observed_at,request_id,trace_id
    ) VALUES (
      gen_random_uuid(),platform.current_tenant_id(),'33333333-3333-4333-8333-333333333311',
      'succeeded','authorized',now(),'direct-dml','direct-dml'
    );
    RAISE EXCEPTION 'runtime direct attempt-result insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
