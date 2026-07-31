import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/foundation/migrations/FND-0019-internal-token-production-attestation-receipt-journal.sql",
  import.meta.url,
);

test("FND-0019 creates isolated atomic receipt-journal storage", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /internal_token_production_attestation_receipt_journal_state/u);
  assert.match(sql, /internal_token_production_attestation_receipt_journal \(/u);
  assert.match(sql, /journal_version bigint PRIMARY KEY/u);
  assert.match(sql, /batch_nonce_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /entry_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /batch_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /evidence_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /receipt_count smallint NOT NULL CHECK \(receipt_count = 13\)/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /reject_append_only_mutation/u);
});

test("FND-0019 serializes, recomputes digests and applies compare-and-swap", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const lock = sql.indexOf("pg_advisory_xact_lock(742901, 19)");
  const nonceLookup = sql.indexOf("WHERE batch_nonce_digest = p_batch_nonce_digest");
  const stateLock = sql.indexOf("FOR UPDATE", nonceLookup);
  const entryInsert = sql.indexOf(
    "INSERT INTO platform.internal_token_production_attestation_receipt_journal(",
    stateLock,
  );
  const stateUpdate = sql.indexOf(
    "UPDATE platform.internal_token_production_attestation_receipt_journal_state",
    entryInsert,
  );
  assert.ok(lock > 0);
  assert.ok(nonceLookup > lock);
  assert.ok(stateLock > nonceLookup);
  assert.ok(entryInsert > stateLock);
  assert.ok(stateUpdate > entryInsert);
  assert.match(sql, /cardinality\(p_receipt_digests\) <> 13/u);
  assert.match(sql, /count\(DISTINCT receipt_digest\)/u);
  assert.match(sql, /internal_token_production_attestation_batch_digest/u);
  assert.match(sql, /internal_token_production_attestation_entry_digest/u);
  assert.match(sql, /v_batch_digest <> p_batch_digest/u);
  assert.match(sql, /v_entry_digest <> p_entry_digest/u);
  assert.match(sql, /journal_version = p_expected_journal_version/u);
  assert.match(sql, /head_digest = p_previous_journal_digest/u);
  assert.match(
    sql,
    /latest_sequence_checkpoint_digest = p_previous_sequence_checkpoint_digest/u,
  );
  assert.match(sql, /GET DIAGNOSTICS v_updated = ROW_COUNT/u);
  assert.match(sql, /v_updated <> 1/u);
  assert.match(sql, /ERRCODE = '40001'/u);
  assert.match(sql, /ERRCODE = '23505'/u);
});

test("FND-0019 exposes only narrow privileged commands", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /REVOKE ALL ON TABLE platform\.internal_token_production_attestation_receipt_journal[\s\S]*FROM PUBLIC/u,
  );
  assert.match(sql, /FROM store_app_runtime/u);
  assert.match(sql, /FROM store_app_reporting/u);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION platform\.append_internal_token_production_attestation_receipt_journal/u,
  );
  assert.match(sql, /TO store_key_governance_runtime/u);
  assert.doesNotMatch(
    sql,
    /GRANT (?:SELECT|INSERT|UPDATE|DELETE).*store_app_(?:runtime|reporting)/u,
  );
  assert.match(
    sql,
    /read_internal_token_production_attestation_receipt_journal_state/u,
  );
  assert.doesNotMatch(sql, /receipt_payload|signature|private_key|provider_resource|database_url/iu);
});

test("foundation manifest pins the exact FND-0019 checksum last", async () => {
  const sql = await readFile(migrationUrl);
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  const expected = createHash("sha256").update(sql).digest("hex");
  const entry = manifest.migrations.at(-1);
  assert.deepEqual(entry, {
    id: "FND-0019",
    file: "FND-0019-internal-token-production-attestation-receipt-journal.sql",
    sha256: expected,
  });
  assert.equal(expected, "393321f13e663d4dc5e01c0bd9894b336aa895ad7c922fb95e63bd0de147d3c9");
});

test("Postgres adapter is one stored-function call and aggregate-only", async () => {
  const source = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-receipt-postgres.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /platform\.append_internal_token_production_attestation_receipt_journal/u,
  );
  assert.match(
    source,
    /platform\.read_internal_token_production_attestation_receipt_journal_state/u,
  );
  assert.match(source, /createInternalTokenProductionAttestationReceiptJournalEntryDigest/u);
  assert.match(
    source,
    /createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest/u,
  );
  assert.doesNotMatch(source, /SELECT \*/u);
  assert.doesNotMatch(source, /privateKey|providerResource|databaseUrl|receiptPayload/u);
});
