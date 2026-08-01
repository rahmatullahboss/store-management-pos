import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/foundation/migrations/FND-0023-custom-auth-generic-rbac-context.sql",
  import.meta.url,
);

test("custom auth context resolves one database role without hard-coded persona names", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION platform\.custom_auth_resolve_context/u);
  assert.match(sql, /JOIN platform\.roles AS r/u);
  assert.match(sql, /r\.tenant_id = ec\.tenant_id/u);
  assert.match(sql, /r\.code AS role_code/u);
  assert.doesNotMatch(sql, /r\.code\s*=\s*'staging-read-only'/u);
  assert.doesNotMatch(sql, /business-owner|cashier|accountant|platform-administrator/u);
});

test("custom auth context fails closed when a membership has more than one role assignment", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /WHERE NOT EXISTS \([\s\S]*platform\.membership_roles AS other/u);
  assert.match(sql, /other\.membership_id = mr\.membership_id/u);
  assert.match(sql, /other\.id <> mr\.id/u);
});

test("custom auth context returns assigned permissions and preserves runtime privilege boundary", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /array_agg\(DISTINCT rp\.permission_code ORDER BY rp\.permission_code\)/u);
  assert.match(sql, /JOIN platform\.permissions AS p[\s\S]*p\.code = rp\.permission_code/u);
  assert.doesNotMatch(sql, /p\.risk_level = 'standard'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.custom_auth_resolve_context\(text\) FROM PUBLIC/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.custom_auth_resolve_context\(text\) TO store_app_runtime/u);
});

test("foundation manifest pins FND-0023 after the immutable prior chain", async () => {
  const migration = await readFile(migrationUrl);
  const checksum = createHash("sha256").update(migration).digest("hex");
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(manifest.migrations.at(-1), {
    id: "FND-0023",
    file: "FND-0023-custom-auth-generic-rbac-context.sql",
    sha256: checksum,
  });
  assert.equal(checksum, "50118bbf24c1cf6b3a974cea720e5f11f67581f32cb856edbb8a62ab636978c6");
});
