import {
  createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest,
  createInternalTokenProductionAttestationReceiptJournalEntryDigest,
} from "./internal-token-production-attestation-receipt-journal.mjs";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const RECEIPT_COUNT = 13;
const SCHEMA_VERSION = 1;

export const INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL = `
SELECT
  status,
  journal_version::text,
  entry_digest,
  batch_digest,
  batch_nonce_digest,
  evidence_digest,
  previous_journal_digest,
  previous_sequence_checkpoint_digest,
  next_sequence_checkpoint_digest,
  registry_digest,
  release_digest,
  receipt_count::int,
  recorded_at_epoch_ms::text,
  schema_version::int
FROM platform.append_internal_token_production_attestation_receipt_journal(
  $1::smallint,
  $2::text,
  $3::text,
  $4::text,
  $5::text,
  $6::text,
  $7::text,
  $8::text,
  $9::text,
  $10::text[],
  $11::bigint,
  $12::bigint,
  $13::text
)`;

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
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
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
  if (command.schemaVersion !== SCHEMA_VERSION) fail("append schema version is invalid");
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
  if (batch.schemaVersion !== SCHEMA_VERSION) fail("batch schema version is invalid");
  if (!Array.isArray(batch.receiptDigests) || batch.receiptDigests.length !== RECEIPT_COUNT) {
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

function normalizeRow(input, expected, expectedEntryDigest) {
  const row = exact(
    input,
    [
      "batch_digest",
      "batch_nonce_digest",
      "entry_digest",
      "evidence_digest",
      "journal_version",
      "next_sequence_checkpoint_digest",
      "previous_journal_digest",
      "previous_sequence_checkpoint_digest",
      "receipt_count",
      "recorded_at_epoch_ms",
      "registry_digest",
      "release_digest",
      "schema_version",
      "status",
    ],
    "database acknowledgment",
  );
  if (row.status !== "recorded" && row.status !== "idempotent") {
    fail("database acknowledgment status is invalid");
  }
  const normalized = Object.freeze({
    batchDigest: digest(row.batch_digest, "database batch digest"),
    batchNonceDigest: digest(row.batch_nonce_digest, "database batch nonce digest"),
    entryDigest: digest(row.entry_digest, "database entry digest"),
    evidenceDigest: digest(row.evidence_digest, "database evidence digest"),
    journalVersion: integer(row.journal_version, "database journal version", 1),
    nextSequenceCheckpointDigest: digest(
      row.next_sequence_checkpoint_digest,
      "database next sequence-checkpoint digest",
    ),
    previousJournalDigest: digest(
      row.previous_journal_digest,
      "database previous journal digest",
    ),
    previousSequenceCheckpointDigest: digest(
      row.previous_sequence_checkpoint_digest,
      "database previous sequence-checkpoint digest",
    ),
    receiptCount: integer(row.receipt_count, "database receipt count", RECEIPT_COUNT),
    recordedAt: integer(row.recorded_at_epoch_ms, "database recorded-at", 1),
    registryDigest: digest(row.registry_digest, "database registry digest"),
    releaseDigest: digest(row.release_digest, "database release digest"),
    schemaVersion: integer(row.schema_version, "database schema version", 1),
    status: row.status,
  });
  if (
    normalized.schemaVersion !== SCHEMA_VERSION ||
    normalized.receiptCount !== RECEIPT_COUNT ||
    normalized.entryDigest !== expectedEntryDigest ||
    normalized.batchDigest !== expected.batchDigest ||
    normalized.batchNonceDigest !== expected.batch.batchNonceDigest ||
    normalized.evidenceDigest !== expected.batch.evidenceDigest ||
    normalized.journalVersion !== expected.expectedJournalVersion + 1 ||
    normalized.nextSequenceCheckpointDigest !==
      expected.batch.nextSequenceCheckpointDigest ||
    normalized.previousJournalDigest !== expected.expectedPreviousJournalDigest ||
    normalized.previousSequenceCheckpointDigest !==
      expected.batch.previousSequenceCheckpointDigest ||
    normalized.recordedAt !== expected.recordedAt ||
    normalized.registryDigest !== expected.batch.registryDigest ||
    normalized.releaseDigest !== expected.batch.releaseDigest
  ) {
    fail("database acknowledgment is not bound to the append command");
  }
  return normalized;
}

function acknowledgment(row) {
  const body = Object.freeze({
    batchDigest: row.batchDigest,
    batchNonceDigest: row.batchNonceDigest,
    entryDigest: row.entryDigest,
    evidenceDigest: row.evidenceDigest,
    journalVersion: row.journalVersion,
    nextSequenceCheckpointDigest: row.nextSequenceCheckpointDigest,
    previousJournalDigest: row.previousJournalDigest,
    previousSequenceCheckpointDigest: row.previousSequenceCheckpointDigest,
    receiptCount: row.receiptCount,
    recordedAt: row.recordedAt,
    registryDigest: row.registryDigest,
    releaseDigest: row.releaseDigest,
    schemaVersion: row.schemaVersion,
    status: row.status,
  });
  return Object.freeze({
    ...body,
    acknowledgmentDigest:
      createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest(body),
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
      const body = entryBody(command);
      const entryDigest =
        createInternalTokenProductionAttestationReceiptJournalEntryDigest(body);
      let result;
      try {
        result = await client.query(
          INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL,
          [
            command.schemaVersion,
            command.batchDigest,
            command.batch.batchNonceDigest,
            command.batch.evidenceDigest,
            command.expectedPreviousJournalDigest,
            command.batch.previousSequenceCheckpointDigest,
            command.batch.nextSequenceCheckpointDigest,
            command.batch.registryDigest,
            command.batch.releaseDigest,
            [...command.batch.receiptDigests],
            command.expectedJournalVersion,
            command.recordedAt,
            entryDigest,
          ],
        );
      } catch {
        fail("append failed");
      }
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
        fail("database acknowledgment row count is invalid");
      }
      return acknowledgment(normalizeRow(result.rows[0], command, entryDigest));
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
