BEGIN;

INSERT INTO platform.permissions(code, module, description, risk_level) VALUES
  ('localization.document.read','localization','Read immutable legal-document and numbering evidence','sensitive'),
  ('localization.fiscal.read','localization','Read fiscal submission state and provider evidence','sensitive'),
  ('localization.privacy.read','localization','Read retention-scoped privacy operation evidence','sensitive')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, risk_level = EXCLUDED.risk_level;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('LOC-0004','MOD-F-LOCALIZATION','manifest:LOC-0004-read-permissions.sql');

COMMIT;
