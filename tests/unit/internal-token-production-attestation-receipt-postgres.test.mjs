import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createInternalTokenProductionAttestationReceiptBatchDigest,
} from "../../tooling/scripts/internal-token-production-attestation-receipt-journal.mjs";
import {
  INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL,
  INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_STATE_SQL,
  createPostgresInternalTokenProductionAttestationReceiptJournalRecorder,
} from "../../tooling/scripts/internal-token-production-attestation-receipt-postgres.mjs";

function digest(label) {
  return createHash("sha256").update(label).digest("base64url");
}

function command(recordedAt = Date.now()) {
  const batch = Object.freeze({
    batchNonceDigest: digest("postgres-batch-nonce"),
    evidenceDigest: digest("postgres-evidence"),
    nextSequenceCheckpointDigest: digest("postgres-sequence-next"),
    previousSequenceCheckpointDigest: digest("postgres-sequence-previous"),
    receiptDigests: Object.freeze(
      Array.from({ length: 13 }, (_, index) => digest(`postgres-receipt-${index + 1}`)).sort(),
    ),
    registryDigest: digest("postgres-registry"),
    releaseDigest: digest("postgres-release"),
    schemaVersion: 1,
  });
  return Object.freeze({
    batch,
    batchDigest:
      createInternalTokenProductionAttestationReceiptBatchDigest(batch),
    expectedJournalVersion: 0,
    expectedPreviousJournalDigest: digest("postgres-journal-genesis"),
    recordedAt,
    schemaVersion: 1,
  });
}

function rowFromParameters(parameters, status = "recorded") {
  return {
    status,
    journal_version: String(Number(parameters[10]) + 1),
    entry_digest: parameters[12],
    batch_digest: parameters[1],
    batch_nonce_digest: parameters[2],
    evidence_digest: parameters[3],
    previous_journal_digest: parameters[4],
    previous_sequence_checkpoint_digest: parameters[5],
    next_sequence_checkpoint_digest: parameters[6],
    registry_digest: parameters[7],
    release_digest: parameters[8],
    receipt_count: 13,
    recorded_at_epoch_ms: String(parameters[11]),
    schema_version: 1,
  };
}

test("Postgres recorder binds one stored-function call to the exact journal command", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [rowFromParameters(parameters)] };
    },
  };
  const recorder =
    createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(database);
  const input = command();
  const acknowledgment = await recorder.append(input);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL);
  assert.equal(calls[0].parameters.length, 13);
  assert.deepEqual(calls[0].parameters[9], input.batch.receiptDigests);
  assert.equal(acknowledgment.status, "recorded");
  assert.equal(acknowledgment.journalVersion, 1);
  assert.equal(acknowledgment.batchDigest, input.batchDigest);
  assert.equal(acknowledgment.previousJournalDigest, input.expectedPreviousJournalDigest);
  assert.equal(acknowledgment.nextSequenceCheckpointDigest, input.batch.nextSequenceCheckpointDigest);
  assert.match(acknowledgment.entryDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(acknowledgment.acknowledgmentDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(acknowledgment).includes("receiptDigests"), false);
});

test("Postgres recorder accepts an exact database idempotency acknowledgment", async () => {
  const database = {
    async query(_sql, parameters) {
      return { rows: [rowFromParameters(parameters, "idempotent")] };
    },
  };
  const acknowledgment = await createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(
    database,
  ).append(command());
  assert.equal(acknowledgment.status, "idempotent");
  assert.equal(acknowledgment.receiptCount, 13);
});

test("Postgres recorder rejects tampered or non-aggregate acknowledgments", async () => {
  const input = command();
  for (const mutate of [
    (row) => ({ ...row, entry_digest: digest("tampered-entry") }),
    (row) => ({ ...row, journal_version: "2" }),
    (row) => ({ ...row, provider_resource: "kms://forbidden" }),
    (row) => ({ ...row, status: "unknown" }),
  ]) {
    const database = {
      async query(_sql, parameters) {
        return { rows: [mutate(rowFromParameters(parameters))] };
      },
    };
    await assert.rejects(
      createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(database).append(input),
      /Postgres recorder:/u,
    );
  }
});

test("Postgres recorder masks database failures and validates before access", async () => {
  let calls = 0;
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query() {
      calls += 1;
      throw new Error("postgres host and credential must remain masked");
    },
  });
  await assert.rejects(recorder.append(command()), /append failed/u);
  assert.equal(calls, 1);

  const malformed = {
    ...command(),
    databaseUrl: "postgres://forbidden",
  };
  await assert.rejects(recorder.append(malformed), /append command fields are invalid/u);
  assert.equal(calls, 1);
});

test("Postgres recorder reads only protected aggregate journal coordinates", async () => {
  const database = {
    async query(sql) {
      assert.equal(sql, INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_STATE_SQL);
      return {
        rows: [{
          schema_version: 1,
          journal_version: "2",
          genesis_digest: digest("state-genesis"),
          head_digest: digest("state-head"),
          latest_sequence_checkpoint_digest: digest("state-sequence"),
          entry_count: "2",
        }],
      };
    },
  };
  const state = await createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(
    database,
  ).readState();
  assert.deepEqual(state, {
    entryCount: 2,
    genesisDigest: digest("state-genesis"),
    headDigest: digest("state-head"),
    latestSequenceCheckpointDigest: digest("state-sequence"),
    schemaVersion: 1,
    status: "reconciled",
    version: 2,
  });
});

test("Postgres recorder rejects absent, inconsistent and oversized state", async () => {
  for (const rows of [
    [],
    [{
      schema_version: 1,
      journal_version: "2",
      genesis_digest: digest("state-genesis-2"),
      head_digest: digest("state-head-2"),
      latest_sequence_checkpoint_digest: digest("state-sequence-2"),
      entry_count: "1",
    }],
    [{
      schema_version: 1,
      journal_version: "9007199254740992",
      genesis_digest: digest("state-genesis-3"),
      head_digest: digest("state-head-3"),
      latest_sequence_checkpoint_digest: digest("state-sequence-3"),
      entry_count: "9007199254740992",
    }],
  ]) {
    const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
      async query() {
        return { rows };
      },
    });
    await assert.rejects(recorder.readState(), /Postgres recorder:/u);
  }
});
