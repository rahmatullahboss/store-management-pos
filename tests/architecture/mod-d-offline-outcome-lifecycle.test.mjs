import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/modules/pos/migrations/POS-0003-offline-sync-security.sql",
  import.meta.url,
);

test("MOD-D deferred offline outcomes remain resolvable and terminal outcomes stay unique", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /outcome_sequence bigint GENERATED ALWAYS AS IDENTITY/u);
  assert.match(sql, /offline_operation_terminal_outcome_unique/u);
  assert.match(
    sql,
    /WHERE status IN \('applied','duplicate','rejected','review_required'\)/u,
  );
  assert.match(sql, /offline_operation_outcome_insert_guard/u);
  assert.match(sql, /FROM pos\.offline_operations[\s\S]*FOR UPDATE/u);
  assert.match(sql, /terminal offline outcome is immutable/u);
  assert.doesNotMatch(sql, /UNIQUE \(tenant_id, offline_operation_id\),/u);
});
