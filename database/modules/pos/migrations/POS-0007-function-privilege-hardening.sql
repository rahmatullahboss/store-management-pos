BEGIN;

DO $function_hardening$
DECLARE
  function_identity text;
BEGIN
  FOR function_identity IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pos'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_identity);
  END LOOP;
END $function_hardening$;

DO $function_hardening_check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pos'
      AND has_function_privilege('public', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC execute privilege remains on a POS function';
  END IF;
END $function_hardening_check$;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('POS-0007','MOD-D-POS','manifest:POS-0007-function-privilege-hardening.sql');

COMMIT;
