import {
  createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest,
  createInternalTokenProductionAttestationReceiptJournalEntryDigest,
} from "./internal-token-production-attestation-receipt-journal.mjs";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const RECEIPT_COUNT = 13;
const SCHEMA_VERSION = 1;

export const INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL = `
SELECT platform.record_internal_token_production_attestation_receipt_batch(
  $1::jsonb
) AS acknowledgment`;

export const INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_STATE_SQL = `
SELECT
  schema_version::int,
  journal_version::text,
  genesis_digest,
  head_digest,
  latest_sequence_checkpoint_digest,
  entry_count::text
FROM platform.read_internal_token_production_attestation_receipt_journal_state()`;

function fail(message) {
  throw new Error(
    `Internal-token production attestation receipt Postgres recorder: ${message}`,
  );
}

function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${name} fields are invalid`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function integer(value, name, minimum = 0) {
  const normalized =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    fail(`${name} is invalid`);
  }
  return normalized;
}

function normalizeCommand(input) {
  const command = exact(
    input,
    [
      "batch",
      "batchDigest",
      "expectedJournalVersion",
      "expectedPreviousJournalDigest",
      "recordedAt",
      "schemaVersion",
    ],
    "append command",
  );
  if (command.schemaVersion !== SCHEMA_VERSION) {
    fail("append schema version is invalid");
  }
  const batch = exact(
    command.batch,
    [
      "batchNonceDigest",
      "evidenceDigest",
      "nextSequenceCheckpointDigest",
      "previousSequenceCheckpointDigest",
      "receiptDigests",
      "registryDigest",
      "releaseDigest",
      "schemaVersion",
    ],
    "append batch",
  );
  if (batch.schemaVersion !== SCHEMA_VERSION) {
    fail("batch schema version is invalid");
  }
  if (
    !Array.isArray(batch.receiptDigests) ||
    batch.receiptDigests.length !== RECEIPT_COUNT
  ) {
    fail("batch must contain exactly thirteen receipt digests");
  }
  const receiptDigests = batch.receiptDigests.map((item, index) =>
    digest(item, `receipt digest ${index + 1}`),
  );
  if (new Set(receiptDigests).size !== RECEIPT_COUNT) {
    fail("receipt digests must be distinct");
  }
  return Object.freeze({
    batch: Object.freeze({
      batchNonceDigest: digest(batch.batchNonceDigest, "batch nonce digest"),
      evidenceDigest: digest(batch.evidenceDigest, "evidence digest"),
      nextSequenceCheckpointDigest: digest(
        batch.nextSequenceCheckpointDigest,
        "next sequence-checkpoint digest",
      ),
      previousSequenceCheckpointDigest: digest(
        batch.previousSequenceCheckpointDigest,
        "previous sequence-checkpoint digest",
      ),
      receiptDigests: Object.freeze([...receiptDigests].sort()),
      registryDigest: digest(batch.registryDigest, "registry digest"),
      releaseDigest: digest(batch.releaseDigest, "release digest"),
      schemaVersion: SCHEMA_VERSION,
    }),
    batchDigest: digest(command.batchDigest, "batch digest"),
    expectedJournalVersion: integer(
      command.expectedJournalVersion,
      "expected journal version",
    ),
    expectedPreviousJournalDigest: digest(
      command.expectedPreviousJournalDigest,
      "expected previous journal digest",
    ),
    recordedAt: integer(command.recordedAt, "recorded-at", 1),
    schemaVersion: SCHEMA_VERSION,
  });
}

function entryBody(command) {
  return Object.freeze({
    batchDigest: command.batchDigest,
    batchNonceDigest: command.batch.batchNonceDigest,
    evidenceDigest: command.batch.evidenceDigest,
    journalVersion: command.expectedJournalVersion + 1,
    nextSequenceCheckpointDigest: command.batch.nextSequenceCheckpointDigest,
    previousJournalDigest: command.expectedPreviousJournalDigest,
    previousSequenceCheckpointDigest:
      command.batch.previousSequenceCheckpointDigest,
    receiptCount: RECEIPT_COUNT,
    recordedAt: command.recordedAt,
    registryDigest: command.batch.registryDigest,
    releaseDigest: command.batch.releaseDigest,
    schemaVersion: SCHEMA_VERSION,
  });
}

function databaseCommand(command, entryDigest) {
  return Object.freeze({
    batchDigest: command.batchDigest,
    batchNonceDigest: command.batch.batchNonceDigest,
    entryDigest,
    evidenceDigest: command.batch.evidenceDigest,
    expectedJournalVersion: command.expectedJournalVersion,
    nextSequenceCheckpointDigest: command.batch.nextSequenceCheckpointDigest,
    previousJournalDigest: command.expectedPreviousJournalDigest,
    previousSequenceCheckpointDigest:
      command.batch.previousSequenceCheckpointDigest,
    receiptDigests: Object.freeze([...command.batch.receiptDigests]),
    recordedAt: command.recordedAt,
    registryDigest: command.batch.registryDigest,
    releaseDigest: command.batch.releaseDigest,
    schemaVersion: SCHEMA_VERSION,
  });
}

function parseAcknowledgment(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      fail("database acknowledgment JSON is invalid");
    }
  }
  return value;
}

function normalizeAcknowledgment(input, expected, expectedEntryDigest) {
  const value = exact(
    parseAcknowledgment(input),
    [
      "batchDigest",
      "batchNonceDigest",
      "entryDigest",
      "evidenceDigest",
      "journalVersion",
      "nextSequenceCheckpointDigest",
      "previousJournalDigest",
      "previousSequenceCheckpointDigest",
      "receiptCount",
      "recordedAt",
      "registryDigest",
      "releaseDigest",
      "schemaVersion",
      "status",
    ],
    "database acknowledgment",
  );
  if (value.status !== "recorded" && value.status !== "idempotent") {
    fail("database acknowledgment status is invalid");
  }
  const body = Object.freeze({
    batchDigest: digest(value.batchDigest, "database batch digest"),
    batchNonceDigest: digest(
      value.batchNonceDigest,
      "database batch nonce digest",
    ),
    entryDigest: digest(value.entryDigest, "database entry digest"),
    evidenceDigest: digest(value.evidenceDigest, "database evidence digest"),
    journalVersion: integer(value.journalVersion, "database journal version", 1),
    nextSequenceCheckpointDigest: digest(
      value.nextSequenceCheckpointDigest,
      "database next sequence-checkpoint digest",
    ),
    previousJournalDigest: digest(
      value.previousJournalDigest,
      "database previous journal digest",
    ),
    previousSequenceCheckpointDigest: digest(
      value.previousSequenceCheckpointDigest,
      "database previous sequence-checkpoint digest",
    ),
    receiptCount: integer(value.receiptCount, "database receipt count", 1),
    recordedAt: integer(value.recordedAt, "database recorded-at", 1),
    registryDigest: digest(value.registryDigest, "database registry digest"),
    releaseDigest: digest(value.releaseDigest, "database release digest"),
    schemaVersion: integer(value.schemaVersion, "database schema version", 1),
    status: value.status,
  });
  if (
    body.schemaVersion !== SCHEMA_VERSION ||
    body.receiptCount !== RECEIPT_COUNT ||
    body.entryDigest !== expectedEntryDigest ||
    body.batchDigest !== expected.batchDigest ||
    body.batchNonceDigest !== expected.batch.batchNonceDigest ||
    body.evidenceDigest !== expected.batch.evidenceDigest ||
    body.journalVersion !== expected.expectedJournalVersion + 1 ||
    body.nextSequenceCheckpointDigest !==
      expected.batch.nextSequenceCheckpointDigest ||
    body.previousJournalDigest !== expected.expectedPreviousJournalDigest ||
    body.previousSequenceCheckpointDigest !==
      expected.batch.previousSequenceCheckpointDigest ||
    body.recordedAt !== expected.recordedAt ||
    body.registryDigest !== expected.batch.registryDigest ||
    body.releaseDigest !== expected.batch.releaseDigest
  ) {
    fail("database acknowledgment is not bound to the append command");
  }
  return Object.freeze({
    ...body,
    acknowledgmentDigest:
      createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest(
        body,
      ),
  });
}

function database(databaseInput) {
  if (!databaseInput || typeof databaseInput.query !== "function") {
    fail("a query-capable database client is required");
  }
  return databaseInput;
}

export function createPostgresInternalTokenProductionAttestationReceiptJournalRecorder(
  databaseInput,
) {
  const client = database(databaseInput);
  return Object.freeze({
    async append(commandInput) {
      const command = normalizeCommand(commandInput);
      const proposedEntryDigest =
        createInternalTokenProductionAttestationReceiptJournalEntryDigest(
          entryBody(command),
        );
      const proposedCommand = databaseCommand(command, proposedEntryDigest);
      let result;
      try {
        result = await client.query(
          INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL,
          [JSON.stringify(proposedCommand)],
        );
      } catch {
        fail("append failed");
      }
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
        fail("database acknowledgment row count is invalid");
      }
      const row = exact(
        result.rows[0],
        ["acknowledgment"],
        "database result row",
      );
      return normalizeAcknowledgment(
        row.acknowledgment,
        command,
        proposedEntryDigest,
      );
    },

    async readState() {
      let result;
      try {
        result = await client.query(
          INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_STATE_SQL,
        );
      } catch {
        fail("state read failed");
      }
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
        fail("journal state is unavailable");
      }
      const row = exact(
        result.rows[0],
        [
          "entry_count",
          "genesis_digest",
          "head_digest",
          "journal_version",
          "latest_sequence_checkpoint_digest",
          "schema_version",
        ],
        "database journal state",
      );
      const state = Object.freeze({
        entryCount: integer(row.entry_count, "state entry count"),
        genesisDigest: digest(row.genesis_digest, "state genesis digest"),
        headDigest: digest(row.head_digest, "state head digest"),
        latestSequenceCheckpointDigest: digest(
          row.latest_sequence_checkpoint_digest,
          "state latest sequence-checkpoint digest",
        ),
        schemaVersion: integer(row.schema_version, "state schema version", 1),
        status: "reconciled",
        version: integer(row.journal_version, "state journal version"),
      });
      if (
        state.schemaVersion !== SCHEMA_VERSION ||
        state.entryCount !== state.version ||
        state.genesisDigest === state.latestSequenceCheckpointDigest ||
        state.headDigest === state.latestSequenceCheckpointDigest
      ) {
        fail("database journal state is inconsistent");
      }
      return state;
    },
  });
}
