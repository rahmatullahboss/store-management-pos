import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerUrl = new URL("../../tooling/scripts/apply-migrations.mjs", import.meta.url);

test("migration runner holds a database advisory lock for the full application window", async () => {
  const source = await readFile(runnerUrl, "utf8");
  const lock = source.indexOf("pg_advisory_lock(hashtextextended($1, 0))");
  const migrationLoop = source.indexOf("for (const source of availableModules");
  const unlock = source.indexOf("pg_advisory_unlock(hashtextextended($1, 0))");

  assert.notEqual(lock, -1);
  assert.notEqual(migrationLoop, -1);
  assert.notEqual(unlock, -1);
  assert.ok(lock < migrationLoop, "lock must be acquired before reading/applying manifests");
  assert.ok(migrationLoop < unlock, "lock must remain held until migration application finishes");
  assert.match(source, /finally \{[\s\S]*pg_advisory_unlock/u);
});
