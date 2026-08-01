import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/foundation/migrations/FND-0015-internal-token-key-change-journal.sql",
  import.meta.url,
);

async function migration() {
  return await readFile(migrationUrl, "utf8");
}

test("durable key journal has isolated append-only storage", async () => {
  const sql = await migration();
  assert.match(sql, /CREATE ROLE store_key_governance_runtime NOLOGIN/u);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS platform\.internal_token_key_change_journal/u);
  assert.match(sql, /UNIQUE \(change_digest, sequence\)/u);
  assert.match(sql, /REFERENCES platform\.internal_token_key_change_journal\(event_digest\)/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /platform\.reject_append_only_mutation\(\)/u);
});

test("journal appends serialize and validate the complete chain", async () => {
  const sql = await migration();
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, platform/u);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_change_digest, 0\)\)/u);
  assert.match(sql, /journal must begin with requested sequence 1/u);
  assert.match(sql, /journal is already terminal/u);
  assert.match(sql, /journal sequence is not contiguous/u);
  assert.match(sql, /journal linkage is invalid/u);
  assert.match(sql, /journal timestamp moved backwards/u);
  assert.match(sql, /journal transition is invalid/u);
});

test("application roles cannot write the governance journal directly", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_key_change_journal FROM store_app_runtime/u,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_key_change_journal FROM store_app_reporting/u,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION platform\.append_internal_token_key_change_journal_event/u,
  );
  assert.doesNotMatch(
    sql,
    /GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*internal_token_key_change_journal[^;]*store_key_governance_runtime/iu,
  );
});

test("foundation manifest pins the durable journal checksum", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  const entry = manifest.migrations.find(({ id }) => id === "FND-0015");
  assert.deepEqual(entry, {
    id: "FND-0015",
    file: "FND-0015-internal-token-key-change-journal.sql",
    sha256: "9c01584b710f8332aeb80381b7ef504f743fcdbb47589740288d19f2d37f6dda",
  });
});
