BEGIN;

CREATE UNIQUE INDEX cash_events_one_reversal_idx
  ON cash.cash_events(tenant_id, reversal_of_event_id)
  WHERE reversal_of_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION cash.validate_cash_event_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  shift_row cash.shifts%ROWTYPE;
  original cash.cash_events%ROWTYPE;
BEGIN
  SELECT * INTO shift_row
  FROM cash.shifts
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.shift_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash shift does not exist' USING ERRCODE = '23503';
  END IF;
  IF shift_row.status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'cash events require an open or explicitly reopened shift' USING ERRCODE = '55000';
  END IF;
  IF shift_row.currency IS DISTINCT FROM NEW.currency
     OR shift_row.scale IS DISTINCT FROM NEW.scale THEN
    RAISE EXCEPTION 'cash event currency and scale must match the shift' USING ERRCODE = '23514';
  END IF;

  IF NEW.reversal_of_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original
  FROM cash.cash_events
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.reversal_of_event_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash reversal target does not exist' USING ERRCODE = '23503';
  END IF;
  IF original.reversal_of_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'a cash reversal cannot target another reversal' USING ERRCODE = '23514';
  END IF;
  IF original.shift_id IS DISTINCT FROM NEW.shift_id
     OR original.currency IS DISTINCT FROM NEW.currency
     OR original.scale IS DISTINCT FROM NEW.scale
     OR original.amount_minor IS DISTINCT FROM NEW.amount_minor
     OR cash.cash_event_effect(NEW.event_type, NEW.amount_minor)
        IS DISTINCT FROM -cash.cash_event_effect(original.event_type, original.amount_minor) THEN
    RAISE EXCEPTION 'cash reversal must exactly offset the original event in the same shift' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER cash_event_insert_guard
  BEFORE INSERT ON cash.cash_events
  FOR EACH ROW EXECUTE FUNCTION cash.validate_cash_event_insert();

CREATE VIEW cash.shift_expected_cash
WITH (security_invoker = true) AS
SELECT
  shift.tenant_id,
  shift.id AS shift_id,
  shift.currency,
  shift.scale,
  COALESCE(SUM(cash.cash_event_effect(event.event_type, event.amount_minor)), 0)::bigint AS expected_minor,
  COUNT(event.id)::bigint AS event_count,
  COALESCE(MAX(event.sequence), 0)::bigint AS last_event_sequence
FROM cash.shifts AS shift
LEFT JOIN cash.cash_events AS event
  ON event.tenant_id = shift.tenant_id
 AND event.shift_id = shift.id
GROUP BY shift.tenant_id, shift.id, shift.currency, shift.scale;

GRANT SELECT ON cash.shift_expected_cash TO store_app_runtime, store_app_reporting;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('CSH-0002','MOD-D-CASH','manifest:CSH-0002-reversal-controls.sql');

COMMIT;
