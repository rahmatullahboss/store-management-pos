BEGIN;

ALTER TABLE fulfillment.return_lines
  ADD COLUMN IF NOT EXISTS allocation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE fulfillment.refund_requests
  ADD COLUMN IF NOT EXISTS return_line_id uuid NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'fulfillment.refund_requests'::regclass
      AND conname = 'fulfillment_refund_requests_return_line_fk'
  ) THEN
    ALTER TABLE fulfillment.refund_requests
      ADD CONSTRAINT fulfillment_refund_requests_return_line_fk
      FOREIGN KEY (tenant_id, return_line_id)
      REFERENCES fulfillment.return_lines(tenant_id, id);
  END IF;
END $constraints$;

CREATE INDEX IF NOT EXISTS fulfillment_refund_return_line_idx
  ON fulfillment.refund_requests(tenant_id, return_line_id, status, created_at, id);

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FUL-0002','MOD-C-FULFILLMENT','manifest:FUL-0002-return-allocation.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
