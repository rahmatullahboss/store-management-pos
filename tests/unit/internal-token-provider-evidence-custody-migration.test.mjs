import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/foundation/migrations/FND-0017-internal-token-provider-evidence-custody.sql",
  import.meta.url,
);

async function migration() {
  return await readFile(migrationUrl, "utf8");
}

test("provider evidence custody storage is isolated and append-only", async () => {
  const sql = await migration();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS platform\.internal_token_provider_evidence_custody_journal/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /platform\.reject_append_only_mutation\(\)/u);
  assert.match(sql, /REVOKE ALL ON TABLE platform\.internal_token_provider_evidence_custody_journal FROM store_app_runtime/u);
  assert.match(sql, /REVOKE ALL ON TABLE platform\.internal_token_provider_evidence_custody_journal FROM store_app_reporting/u);
});

test("custody append serializes and enforces contiguous digest linkage", async () => {
  const sql = await migration();
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, platform/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /must begin at sequence 1/u);
  assert.match(sql, /sequence is not contiguous/u);
  assert.match(sql, /linkage is invalid/u);
  assert.match(sql, /previous_custody_digest text NULL REFERENCES/u);
});

test("custody schema records aggregate retention state without receipt payloads", async () => {
  const sql = await migration();
  assert.match(sql, /privacy_profile text NOT NULL CHECK \(privacy_profile = 'digest-only-v1'\)/u);
  assert.match(sql, /legal_hold_count integer NOT NULL/u);
  assert.match(sql, /eligible_for_disposal_count integer NOT NULL/u);
  assert.match(sql, /minimum_retained_until timestamptz NOT NULL/u);
  assert.doesNotMatch(sql, /raw_key|provider_response|jwt|signature_bytes|audit_identifier/iu);
});

test("foundation manifest pins the provider evidence custody checksum", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(manifest.migrations.find(({ id }) => id === "FND-0017"), {
    id: "FND-0017",
    file: "FND-0017-internal-token-provider-evidence-custody.sql",
    sha256: "a36bf0b9ff211ca351cf0278dbb11c216065f5be0939d8564c5577731f5c7e8a",
  });
});
