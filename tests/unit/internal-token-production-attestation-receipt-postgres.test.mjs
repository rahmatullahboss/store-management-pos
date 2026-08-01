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
      Array.from({ length: 13 }, (_, index) =>
        digest(`postgres-receipt-${index + 1}`),
      ).sort(),
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

function acknowledgmentFromDatabaseCommand(databaseCommand, status = "recorded") {
  return {
    status,
    journalVersion: databaseCommand.expectedJournalVersion + 1,
    entryDigest: databaseCommand.entryDigest,
    batchDigest: databaseCommand.batchDigest,
    batchNonceDigest: databaseCommand.batchNonceDigest,
    evidenceDigest: databaseCommand.evidenceDigest,
    previousJournalDigest: databaseCommand.previousJournalDigest,
    previousSequenceCheckpointDigest:
      databaseCommand.previousSequenceCheckpointDigest,
    nextSequenceCheckpointDigest:
      databaseCommand.nextSequenceCheckpointDigest,
    registryDigest: databaseCommand.registryDigest,
    releaseDigest: databaseCommand.releaseDigest,
    receiptCount: 13,
    recordedAt: databaseCommand.recordedAt,
    schemaVersion: 1,
  };
}

test("Postgres recorder sends one exact JSON command to the hardened function", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      const databaseCommand = JSON.parse(parameters[0]);
      return {
        rows: [{
          acknowledgment: acknowledgmentFromDatabaseCommand(databaseCommand),
        }],
      };
    },
  };
  const input = command();
  const acknowledgment = await createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(
    database,
  ).append(input);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].sql,
    INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL,
  );
  assert.equal(calls[0].parameters.length, 1);
  const databaseCommand = JSON.parse(calls[0].parameters[0]);
  assert.deepEqual(Object.keys(databaseCommand).sort(), [
    "batchDigest",
    "batchNonceDigest",
    "entryDigest",
    "evidenceDigest",
    "expectedJournalVersion",
    "nextSequenceCheckpointDigest",
    "previousJournalDigest",
    "previousSequenceCheckpointDigest",
    "receiptDigests",
    "recordedAt",
    "registryDigest",
    "releaseDigest",
    "schemaVersion",
  ]);
  assert.deepEqual(databaseCommand.receiptDigests, input.batch.receiptDigests);
  assert.equal(acknowledgment.status, "recorded");
  assert.equal(acknowledgment.journalVersion, 1);
  assert.equal(acknowledgment.batchDigest, input.batchDigest);
  assert.equal(
    acknowledgment.previousJournalDigest,
    input.expectedPreviousJournalDigest,
  );
  assert.match(acknowledgment.entryDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(acknowledgment.acknowledgmentDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(acknowledgment).includes("receiptDigests"), false);
});

test("Postgres recorder accepts exact JSON-string idempotency acknowledgment", async () => {
  const database = {
    async query(_sql, parameters) {
      const databaseCommand = JSON.parse(parameters[0]);
      return {
        rows: [{
          acknowledgment: JSON.stringify(
            acknowledgmentFromDatabaseCommand(databaseCommand, "idempotent"),
          ),
        }],
      };
    },
  };
  const acknowledgment = await createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(
    database,
  ).append(command());
  assert.equal(acknowledgment.status, "idempotent");
  assert.equal(acknowledgment.receiptCount, 13);
});

test("Postgres recorder rejects a tampered entry acknowledgment", async () => {
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query(_sql, parameters) {
      const databaseCommand = JSON.parse(parameters[0]);
      return {
        rows: [{
          acknowledgment: {
            ...acknowledgmentFromDatabaseCommand(databaseCommand),
            entryDigest: digest("tampered-entry"),
          },
        }],
      };
    },
  });
  await assert.rejects(
    recorder.append(command()),
    /database acknowledgment is not bound/u,
  );
});

test("Postgres recorder rejects a wrong database journal version", async () => {
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query(_sql, parameters) {
      const databaseCommand = JSON.parse(parameters[0]);
      return {
        rows: [{
          acknowledgment: {
            ...acknowledgmentFromDatabaseCommand(databaseCommand),
            journalVersion: 2,
          },
        }],
      };
    },
  });
  await assert.rejects(
    recorder.append(command()),
    /database acknowledgment is not bound/u,
  );
});

test("Postgres recorder rejects non-aggregate database result rows", async () => {
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query(_sql, parameters) {
      const databaseCommand = JSON.parse(parameters[0]);
      return {
        rows: [{
          acknowledgment: acknowledgmentFromDatabaseCommand(databaseCommand),
          providerResource: "kms://forbidden",
        }],
      };
    },
  });
  await assert.rejects(
    recorder.append(command()),
    /database result row fields are invalid/u,
  );
});

test("Postgres recorder rejects unknown acknowledgment status", async () => {
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query(_sql, parameters) {
      const databaseCommand = JSON.parse(parameters[0]);
      return {
        rows: [{
          acknowledgment: acknowledgmentFromDatabaseCommand(
            databaseCommand,
            "unknown",
          ),
        }],
      };
    },
  });
  await assert.rejects(
    recorder.append(command()),
    /database acknowledgment status is invalid/u,
  );
});

test("Postgres recorder masks database failures", async () => {
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query() {
      throw new Error("postgres host and credential must remain masked");
    },
  });
  await assert.rejects(recorder.append(command()), /append failed/u);
});

test("Postgres recorder validates command shape before database access", async () => {
  let calls = 0;
  const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
    async query() {
      calls += 1;
      return { rows: [] };
    },
  });
  await assert.rejects(
    recorder.append({ ...command(), databaseUrl: "postgres://forbidden" }),
    /append command fields are invalid/u,
  );
  assert.equal(calls, 0);
});

test("Postgres recorder reads only protected aggregate journal coordinates", async () => {
  const database = {
    async query(sql) {
      assert.equal(
        sql,
        INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_STATE_SQL,
      );
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

test("Postgres recorder rejects absent, inconsistent and unsafe state", async () => {
  const cases = [
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
  ];
  for (const rows of cases) {
    const recorder = createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
      async query() {
        return { rows };
      },
    });
    await assert.rejects(recorder.readState(), /Postgres recorder:/u);
  }
});
