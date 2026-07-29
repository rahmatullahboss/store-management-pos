import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hardeningMigrations = [
  {
    id: "POS-0007",
    manifest: new URL("../../database/modules/pos/manifest.json", import.meta.url),
    migration: new URL("../../database/modules/pos/migrations/POS-0007-function-privilege-hardening.sql", import.meta.url),
    schema: "pos",
  },
  {
    id: "CSH-0004",
    manifest: new URL("../../database/modules/cash/manifest.json", import.meta.url),
    migration: new URL("../../database/modules/cash/migrations/CSH-0004-function-privilege-hardening.sql", import.meta.url),
    schema: "cash",
  },
];

test("MOD-D revokes default PUBLIC execution from module functions", async () => {
  for (const source of hardeningMigrations) {
    const manifest = JSON.parse(await readFile(source.manifest, "utf8"));
    const sql = await readFile(source.migration, "utf8");
    assert.ok(manifest.migrations.some((migration) => migration.id === source.id), `${source.id} must remain manifest-owned`);
    assert.match(sql, new RegExp(`n\\.nspname = '${source.schema}'`, "u"));
    assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/u);
    assert.match(sql, /has_function_privilege\('public', p\.oid, 'EXECUTE'\)/u);
    assert.match(sql, /PUBLIC execute privilege remains/u);
  }
});

test("cash privilege hardening preserves only the required runtime helper grant", async () => {
  const sql = await readFile(hardeningMigrations[1].migration, "utf8");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION cash\.cash_event_effect\(text, bigint\) TO store_app_runtime/u);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION cash\.(?:protect_shift_identity|validate_cash_event_insert)/u);
});
