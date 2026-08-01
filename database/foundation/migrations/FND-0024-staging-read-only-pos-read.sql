BEGIN;

INSERT INTO platform.role_permissions(role_id, permission_code)
SELECT r.id, p.code
FROM platform.roles AS r
JOIN platform.permissions AS p
  ON p.code = 'pos.checkout.read'
WHERE r.code = 'staging-read-only'
ON CONFLICT (role_id, permission_code) DO NOTHING;

INSERT INTO platform.schema_migrations(migration_id, module, checksum)
VALUES ('FND-0024','FOUNDATION','manifest:FND-0024-staging-read-only-pos-read.sql')
ON CONFLICT (migration_id) DO NOTHING;

COMMIT;
