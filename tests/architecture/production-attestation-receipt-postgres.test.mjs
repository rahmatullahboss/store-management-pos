import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storageMigrationUrl = new URL(
  "../../database/foundation/migrations/FND-0019-internal-token-production-attestation-receipt-journal.sql",
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  "../../database/foundation/migrations/FND-0020-internal-token-production-attestation-receipt-append-hardening.sql",
  import.meta.url,
);
const shapeFixMigrationUrl = new URL(
  "../../database/foundation/migrations/FND-0021-internal-token-production-attestation-receipt-jsonb-shape-fix.sql",
  import.meta.url,
);
const countCastFixMigrationUrl = new URL(
  "../../database/foundation/migrations/FND-0022-internal-token-production-attestation-receipt-count-cast-fix.sql",
  import.meta.url,
);

test("FND-0019 creates isolated append-only receipt-journal storage", async () => {
  const sql = await readFile(storageMigrationUrl, "utf8");
  assert.match(sql, /internal_token_production_attestation_receipt_journal_state/u);
  assert.match(sql, /internal_token_production_attestation_receipt_journal \(/u);
  assert.match(sql, /journal_version bigint PRIMARY KEY/u);
  assert.match(sql, /batch_nonce_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /entry_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /batch_digest text NOT NULL UNIQUE/u);
  assert.match(sql, /evidence_digest text NOT NULL UNIQUE/u);
  assert.match(
    sql,
    /receipt_count smallint NOT NULL CHECK \(receipt_count = 13\)/u,
  );
  assert.match(sql, /BEFORE UPDATE OR DELETE/u);
  assert.match(sql, /reject_append_only_mutation/u);
  assert.doesNotMatch(
    sql,
    /receipt_payload|private_key|provider_resource|database_url|operator_id|actor_id/iu,
  );
});

test("FND-0020 disables the positional append and requires one exact JSON command", async () => {
  const sql = await readFile(hardeningMigrationUrl, "utf8");
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION platform\.append_internal_token_production_attestation_receipt_journal[\s\S]*FROM store_key_governance_runtime/u,
  );
  assert.match(
    sql,
    /record_internal_token_production_attestation_receipt_batch\([\s\S]*p_command jsonb/u,
  );
  assert.match(sql, /jsonb_object_length\(p_command\) <> 13/u);
  for (const key of [
    "schemaVersion",
    "batchDigest",
    "batchNonceDigest",
    "evidenceDigest",
    "previousJournalDigest",
    "previousSequenceCheckpointDigest",
    "nextSequenceCheckpointDigest",
    "registryDigest",
    "releaseDigest",
    "receiptDigests",
    "expectedJournalVersion",
    "recordedAt",
    "entryDigest",
  ]) {
    assert.match(sql, new RegExp(`'${key}'`, "u"));
  }
  assert.match(sql, /jsonb_array_length\(p_command->'receiptDigests'\) <> 13/u);
  assert.match(sql, /count\(DISTINCT receipt_digest\)/u);
  assert.match(sql, /v_distinct_count <> 22/u);
});

test("FND-0021 repairs JSON object cardinality without rewriting applied migrations", async () => {
  const sql = await readFile(shapeFixMigrationUrl, "utf8");
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION platform\.jsonb_object_length\([\s\S]*p_value jsonb/u,
  );
  assert.match(sql, /FROM jsonb_object_keys\(p_value\)/u);
  assert.match(sql, /RETURNS integer/u);
  assert.match(sql, /IMMUTABLE/u);
  assert.match(sql, /STRICT/u);
  assert.match(sql, /PARALLEL SAFE/u);
  assert.match(sql, /SET search_path = pg_catalog, platform/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION platform\.jsonb_object_length\(jsonb\) FROM PUBLIC/u,
  );
  assert.match(sql, /'FND-0021'/u);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION platform\.record_internal_token/u);
});

test("FND-0020 serializes, recomputes digests and applies compare-and-swap", async () => {
  const sql = await readFile(hardeningMigrationUrl, "utf8");
  const lock = sql.indexOf("pg_advisory_xact_lock(742901, 20)");
  const nonceLookup = sql.indexOf(
    "WHERE journal.batch_nonce_digest = v_batch_nonce_digest",
  );
  const stateSelect = sql.indexOf("SELECT state.*", nonceLookup);
  const stateLock = sql.indexOf("FOR UPDATE", stateSelect);
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
  assert.ok(stateSelect > nonceLookup);
  assert.ok(stateLock > stateSelect);
  assert.ok(entryInsert > stateLock);
  assert.ok(stateUpdate > entryInsert);
  assert.match(sql, /internal_token_production_attestation_batch_digest/u);
  assert.match(sql, /internal_token_production_attestation_entry_digest/u);
  assert.match(sql, /v_recomputed_batch_digest <> v_batch_digest/u);
  assert.match(sql, /v_recomputed_entry_digest <> v_entry_digest/u);
  assert.match(sql, /v_state\.journal_version <> v_expected_journal_version/u);
  assert.match(sql, /v_state\.head_digest <> v_previous_journal_digest/u);
  assert.match(
    sql,
    /v_state\.latest_sequence_checkpoint_digest[\s\S]*<> v_previous_sequence_checkpoint_digest/u,
  );
  assert.match(sql, /GET DIAGNOSTICS v_updated = ROW_COUNT/u);
  assert.match(sql, /v_updated <> 1/u);
  assert.match(sql, /ERRCODE = '40001'/u);
  assert.match(sql, /ERRCODE = '23505'/u);
  assert.match(sql, /'status', 'idempotent'/u);
  assert.match(sql, /'status', 'recorded'/u);
});

test("FND-0020 exposes only the JSON command to the governance role", async () => {
  const storageSql = await readFile(storageMigrationUrl, "utf8");
  const hardeningSql = await readFile(hardeningMigrationUrl, "utf8");
  assert.match(storageSql, /FROM store_app_runtime/u);
  assert.match(storageSql, /FROM store_app_reporting/u);
  assert.doesNotMatch(
    storageSql,
    /GRANT (?:SELECT|INSERT|UPDATE|DELETE).*store_app_(?:runtime|reporting)/u,
  );
  assert.match(
    hardeningSql,
    /REVOKE ALL ON FUNCTION platform\.record_internal_token_production_attestation_receipt_batch\(jsonb\)[\s\S]*FROM PUBLIC/u,
  );
  assert.match(
    hardeningSql,
    /GRANT EXECUTE ON FUNCTION platform\.record_internal_token_production_attestation_receipt_batch\(jsonb\)[\s\S]*TO store_key_governance_runtime/u,
  );
  assert.doesNotMatch(
    hardeningSql,
    /receipt_payload|private_key|provider_resource|database_url|operator_id|actor_id/iu,
  );
});

test("foundation manifest pins FND-0019 through FND-0022 exact checksums last", async () => {
  const storageSql = await readFile(storageMigrationUrl);
  const hardeningSql = await readFile(hardeningMigrationUrl);
  const shapeFixSql = await readFile(shapeFixMigrationUrl);
  const countCastFixSql = await readFile(countCastFixMigrationUrl);
  const manifest = JSON.parse(
    await readFile(new URL("../../database/foundation/manifest.json", import.meta.url), "utf8"),
  );
  const storageChecksum = createHash("sha256").update(storageSql).digest("hex");
  const hardeningChecksum = createHash("sha256").update(hardeningSql).digest("hex");
  const shapeFixChecksum = createHash("sha256").update(shapeFixSql).digest("hex");
  const countCastFixChecksum = createHash("sha256").update(countCastFixSql).digest("hex");
  assert.deepEqual(manifest.migrations.slice(-4), [
    {
      id: "FND-0019",
      file: "FND-0019-internal-token-production-attestation-receipt-journal.sql",
      sha256: storageChecksum,
    },
    {
      id: "FND-0020",
      file: "FND-0020-internal-token-production-attestation-receipt-append-hardening.sql",
      sha256: hardeningChecksum,
    },
    {
      id: "FND-0021",
      file: "FND-0021-internal-token-production-attestation-receipt-jsonb-shape-fix.sql",
      sha256: shapeFixChecksum,
    },
    {
      id: "FND-0022",
      file: "FND-0022-internal-token-production-attestation-receipt-count-cast-fix.sql",
      sha256: countCastFixChecksum,
    },
  ]);
  assert.equal(
    storageChecksum,
    "393321f13e663d4dc5e01c0bd9894b336aa895ad7c922fb95e63bd0de147d3c9",
  );
  assert.equal(
    hardeningChecksum,
    "ee9fa8612b9a778b0dbf265baf82069bb8b547d8d11086fb2cd59e9f01118860",
  );
  assert.equal(
    shapeFixChecksum,
    "75315123c624faeb667d8deb3de7c34fc9f4a656c77228a98bc03446c5954925",
  );
  assert.equal(
    countCastFixChecksum,
    "be7401fb8f3aa0164aea432cf81902f7abbf01f64dfc2cffa68af415cf976064",
  );
});

test("Postgres adapter uses one JSONB command and an aggregate-only result", async () => {
  const source = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-receipt-postgres.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /platform\.record_internal_token_production_attestation_receipt_batch/u,
  );
  assert.match(source, /\$1::jsonb/u);
  assert.match(source, /\[JSON\.stringify\(proposedCommand\)\]/u);
  assert.match(source, /\["acknowledgment"\]/u);
  assert.match(
    source,
    /platform\.read_internal_token_production_attestation_receipt_journal_state/u,
  );
  assert.match(
    source,
    /createInternalTokenProductionAttestationReceiptJournalEntryDigest/u,
  );
  assert.match(
    source,
    /createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest/u,
  );
  assert.doesNotMatch(source, /SELECT \*/u);
  assert.doesNotMatch(
    source,
    /privateKey|providerResource|databaseUrl|receiptPayload/u,
  );
});

test("live dedicated-Neon evidence proves savepoint isolation and concurrent serialization", async () => {
  const source = await readFile(
    new URL(
      "../../tooling/scripts/staging-attestation-receipt-postgres-evidence.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /SAVEPOINT \$\{savepoint\}/u);
  assert.match(source, /ROLLBACK TO SAVEPOINT \$\{savepoint\}/u);
  assert.match(source, /RELEASE SAVEPOINT \$\{savepoint\}/u);
  assert.match(source, /FROM pg_locks/u);
  assert.match(source, /classid::bigint = 742901/u);
  assert.match(source, /objid::bigint = 20/u);
  assert.match(source, /granted = false/u);
  assert.match(source, /Concurrent append did not wait on the journal advisory lock/u);
  assert.match(source, /await first\.query\("ROLLBACK"\)/u);
  assert.match(source, /await second\.query\("ROLLBACK"\)/u);
  assert.match(source, /transaction rollback was incomplete/u);
  assert.match(source, /concurrentRaceSerialized: concurrency\.serialized/u);
  assert.doesNotMatch(
    source,
    /console\.log\([^)]*(?:connectionString|batchNonceDigest|entryDigest)/u,
  );
});

test("staging and admission workflows track the hardened database evidence", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageJson.scripts["ci:staging-deploy"],
    /run-attestation-receipt-postgres-staging\.mjs/u,
  );
  const workflow = await readFile(
    new URL("../../.github/workflows/production-launch-admission.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /FND-0020-internal-token-production-attestation-receipt-append-hardening\.sql/u,
  );
  assert.match(
    workflow,
    /staging-attestation-receipt-postgres-evidence\.mjs/u,
  );
  assert.match(
    workflow,
    /run-attestation-receipt-postgres-staging\.mjs/u,
  );
});
