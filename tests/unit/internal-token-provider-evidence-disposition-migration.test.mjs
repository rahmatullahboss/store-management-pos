import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/foundation/migrations/FND-0018-internal-token-provider-evidence-disposition.sql",
  import.meta.url,
);

async function migration() {
  return await readFile(migrationUrl, "utf8");
}

test("provider evidence disposition journal is isolated and append-only", async () => {
  const sql = await migration();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS platform\.internal_token_provider_evidence_disposition_journal/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /platform\.reject_append_only_mutation\(\)/u);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_provider_evidence_disposition_journal\s+FROM store_app_runtime/u,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_provider_evidence_disposition_journal\s+FROM store_app_reporting/u,
  );
});

test("disposition append serializes and enforces contiguous digest linkage", async () => {
  const sql = await migration();
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, platform/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /must begin at sequence 1/u);
  assert.match(sql, /sequence is not contiguous/u);
  assert.match(sql, /linkage is invalid/u);
  assert.match(sql, /previous_disposition_digest text NULL REFERENCES/u);
});

test("disposition schema requires two approvals and zero legal holds without raw payloads", async () => {
  const sql = await migration();
  assert.match(sql, /approval_count smallint NOT NULL CHECK \(approval_count = 2\)/u);
  assert.match(sql, /legal_hold_count integer NOT NULL CHECK \(legal_hold_count = 0\)/u);
  assert.match(sql, /privacy_profile text NOT NULL CHECK \(privacy_profile = 'digest-only-v1'\)/u);
  assert.match(sql, /status text NOT NULL CHECK \(status = 'destroyed'\)/u);
  assert.doesNotMatch(sql, /object_key|provider_response|jwt|signature_bytes|actor_identifier/iu);
});

test("foundation manifest pins the provider evidence disposition checksum", async () => {
  const sql = await migration();
  const expected = "95e649bd586f76af963a50fa796a247c62ae1b54b9b069c0e6d6d4d61823c24f";
  const actual = createHash("sha256").update(sql).digest("hex");
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(actual, expected);
  assert.deepEqual(manifest.migrations.find(({ id }) => id === "FND-0018"), {
    id: "FND-0018",
    file: "FND-0018-internal-token-provider-evidence-disposition.sql",
    sha256: expected,
  });
});
