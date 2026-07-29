import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL(
  "../../database/modules/cash/manifest.json",
  import.meta.url,
);
const migrationUrl = new URL(
  "../../database/modules/cash/migrations/CSH-0006-final-function-privilege-hardening.sql",
  import.meta.url,
);

test("final cash migration runs after every runtime function replacement", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const finalMigration = manifest.migrations.at(-1);
  assert.deepEqual(finalMigration, {
    id: "CSH-0006",
    file: "CSH-0006-final-function-privilege-hardening.sql",
    sha256: "debd8852517fb1b1e813d757441cb4d1084c7f4f277bce77d95d92f3e8091315",
  });
});

test("final cash hardening revokes PUBLIC and restores only reviewed runtime grants", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /WHERE n\.nspname = 'cash'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/u);
  assert.match(sql, /has_function_privilege\('public', p\.oid, 'EXECUTE'\)/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION cash\.cash_event_effect/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION cash\.open_shift_v1/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION cash\.append_event_v1/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION cash\.close_shift_v1/u);
  assert.match(sql, /VALUES \('CSH-0006'/u);
});
