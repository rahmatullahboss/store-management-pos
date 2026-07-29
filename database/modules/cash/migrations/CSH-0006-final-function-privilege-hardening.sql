BEGIN;

DO $function_hardening$
DECLARE
  function_identity text;
BEGIN
  FOR function_identity IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cash'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_identity);
  END LOOP;
END $function_hardening$;

GRANT EXECUTE ON FUNCTION cash.cash_event_effect(text, bigint) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION cash.open_shift_v1(uuid,uuid,uuid,uuid,char(3),smallint,bigint,uuid,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION cash.append_event_v1(uuid,uuid,text,char(3),smallint,bigint,text,text,uuid,uuid,text,text,text,timestamptz) TO store_app_runtime;
GRANT EXECUTE ON FUNCTION cash.close_shift_v1(uuid,uuid,uuid,text,char(3),smallint,bigint,jsonb,uuid,timestamptz) TO store_app_runtime;

DO $function_hardening_check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cash'
      AND has_function_privilege('public', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC execute privilege remains on a cash function';
  END IF;
END $function_hardening_check$;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0006','MOD-D-CASH','manifest:CSH-0006-final-function-privilege-hardening.sql');

COMMIT;
