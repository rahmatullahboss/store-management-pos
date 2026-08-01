import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/foundation/migrations/FND-0016-internal-token-provider-signing-journal.sql",
  import.meta.url,
);

async function migration() {
  return await readFile(migrationUrl, "utf8");
}

test("provider signing receipts use digest-only append-only storage", async () => {
  const sql = await migration();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS platform\.internal_token_provider_signing_journal/u);
  assert.match(sql, /request_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /operation_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /signature_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /platform\.reject_append_only_mutation\(\)/u);
  assert.doesNotMatch(sql, /\bkey_reference\s+(?:text|bytea)\b/iu);
  assert.doesNotMatch(sql, /\bsigning_input\s+(?:text|bytea)\b/iu);
  assert.doesNotMatch(sql, /\bsignature\s+bytea\b/iu);
});

test("provider signing journal appends serialize and enforce attestation bounds", async () => {
  const sql = await migration();
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, platform/u);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_request_digest, 0\)\)/u);
  assert.match(sql, /provider signing digests must have distinct purposes/u);
  assert.match(sql, /provider signing attestation is incomplete/u);
  assert.match(sql, /p_signature_byte_length < 256/u);
  assert.match(sql, /p_latency_ms > 5000/u);
  assert.match(sql, /now\(\) - interval '5 minutes'/u);
  assert.match(sql, /now\(\) \+ interval '30 seconds'/u);
});

test("application roles cannot access provider signing journal writes", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_provider_signing_journal FROM store_app_runtime/u,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_provider_signing_journal FROM store_app_reporting/u,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION platform\.append_internal_token_provider_signing_journal/u,
  );
  assert.doesNotMatch(
    sql,
    /GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*internal_token_provider_signing_journal[^;]*store_key_governance_runtime/iu,
  );
});

test("foundation manifest pins the provider signing journal checksum", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  const entry = manifest.migrations.find(({ id }) => id === "FND-0016");
  assert.deepEqual(entry, {
    id: "FND-0016",
    file: "FND-0016-internal-token-provider-signing-journal.sql",
    sha256: "e790b6245ba49724cdd65f8142213249a9c7a59cb3151f366d8e699e9c820ad8",
  });
});
