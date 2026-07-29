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
VALUES ('CSH-0003','MOD-D-CASH','manifest:CSH-0003-function-privilege-hardening.sql');

COMMIT;
