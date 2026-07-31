import { createHash } from "node:crypto";
import {
  verifyAndAssembleInternalTokenProductionSignedControlEvidence,
} from "./internal-token-production-attestation-issuer-identity.mjs";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const RECEIPT_COUNT = 13;
const MAX_ENTRIES = 10_000;

export const INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION = 1;

function fail(message) {
  throw new Error(`Internal-token production attestation receipt journal: ${message}`);
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

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} is invalid`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}

function distinct(values, name) {
  if (new Set(values).size !== values.length) fail(`${name} must be distinct`);
}

function normalizeBatchBody(input) {
  const value = exact(
    input,
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
    "attestation receipt batch body",
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION
  ) {
    fail("attestation receipt batch schema version is invalid");
  }
  if (!Array.isArray(value.receiptDigests) || value.receiptDigests.length !== RECEIPT_COUNT) {
    fail("attestation receipt batch must contain exactly thirteen receipts");
  }
  const receiptDigests = value.receiptDigests.map((item, index) =>
    digest(item, `attestation receipt ${index + 1} digest`),
  ).sort();
  distinct(receiptDigests, "attestation receipt digests");
  const body = Object.freeze({
    batchNonceDigest: digest(value.batchNonceDigest, "batch nonce digest"),
    evidenceDigest: digest(value.evidenceDigest, "batch evidence digest"),
    nextSequenceCheckpointDigest: digest(
      value.nextSequenceCheckpointDigest,
      "next sequence-checkpoint digest",
    ),
    previousSequenceCheckpointDigest: digest(
      value.previousSequenceCheckpointDigest,
      "previous sequence-checkpoint digest",
    ),
    receiptDigests,
    registryDigest: digest(value.registryDigest, "batch registry digest"),
    releaseDigest: digest(value.releaseDigest, "batch release digest"),
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
  });
  distinct(
    [
      body.batchNonceDigest,
      body.evidenceDigest,
      body.nextSequenceCheckpointDigest,
      body.previousSequenceCheckpointDigest,
      body.registryDigest,
      body.releaseDigest,
      ...receiptDigests,
    ],
    "attestation receipt batch digests",
  );
  return body;
}

export function createInternalTokenProductionAttestationReceiptBatchDigest(input) {
  return hash(normalizeBatchBody(input));
}

function normalizeEntryBody(input) {
  const value = exact(
    input,
    [
      "batchDigest",
      "batchNonceDigest",
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
    ],
    "attestation receipt journal entry body",
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION
  ) {
    fail("attestation receipt journal entry schema version is invalid");
  }
  const body = Object.freeze({
    batchDigest: digest(value.batchDigest, "journal batch digest"),
    batchNonceDigest: digest(value.batchNonceDigest, "journal batch nonce digest"),
    evidenceDigest: digest(value.evidenceDigest, "journal evidence digest"),
    journalVersion: integer(value.journalVersion, "journal version", 1),
    nextSequenceCheckpointDigest: digest(
      value.nextSequenceCheckpointDigest,
      "journal next sequence-checkpoint digest",
    ),
    previousJournalDigest: digest(
      value.previousJournalDigest,
      "journal previous digest",
    ),
    previousSequenceCheckpointDigest: digest(
      value.previousSequenceCheckpointDigest,
      "journal previous sequence-checkpoint digest",
    ),
    receiptCount: integer(value.receiptCount, "journal receipt count", RECEIPT_COUNT, RECEIPT_COUNT),
    recordedAt: integer(value.recordedAt, "journal recorded-at", 1),
    registryDigest: digest(value.registryDigest, "journal registry digest"),
    releaseDigest: digest(value.releaseDigest, "journal release digest"),
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
  });
  distinct(
    [
      body.batchDigest,
      body.batchNonceDigest,
      body.evidenceDigest,
      body.nextSequenceCheckpointDigest,
      body.previousJournalDigest,
      body.previousSequenceCheckpointDigest,
      body.registryDigest,
      body.releaseDigest,
    ],
    "attestation receipt journal entry digests",
  );
  return body;
}

export function createInternalTokenProductionAttestationReceiptJournalEntryDigest(input) {
  return hash(normalizeEntryBody(input));
}

function normalizeAppendCommand(input) {
  const value = exact(
    input,
    [
      "batch",
      "batchDigest",
      "expectedJournalVersion",
      "expectedPreviousJournalDigest",
      "recordedAt",
      "schemaVersion",
    ],
    "attestation receipt journal append command",
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION
  ) {
    fail("attestation receipt journal command schema version is invalid");
  }
  const batch = normalizeBatchBody(value.batch);
  const batchDigest = digest(value.batchDigest, "journal command batch digest");
  if (hash(batch) !== batchDigest) fail("journal command batch digest does not match");
  return Object.freeze({
    batch,
    batchDigest,
    expectedJournalVersion: integer(
      value.expectedJournalVersion,
      "expected journal version",
      0,
    ),
    expectedPreviousJournalDigest: digest(
      value.expectedPreviousJournalDigest,
      "expected previous journal digest",
    ),
    recordedAt: integer(value.recordedAt, "journal command recorded-at", 1),
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
  });
}

function acknowledgmentBody(entry, entryDigest, status) {
  return Object.freeze({
    batchDigest: entry.batchDigest,
    batchNonceDigest: entry.batchNonceDigest,
    entryDigest,
    evidenceDigest: entry.evidenceDigest,
    journalVersion: entry.journalVersion,
    nextSequenceCheckpointDigest: entry.nextSequenceCheckpointDigest,
    previousJournalDigest: entry.previousJournalDigest,
    previousSequenceCheckpointDigest: entry.previousSequenceCheckpointDigest,
    receiptCount: entry.receiptCount,
    recordedAt: entry.recordedAt,
    registryDigest: entry.registryDigest,
    releaseDigest: entry.releaseDigest,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
    status,
  });
}

export function createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest(input) {
  return hash(
    exact(
      input,
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
      "attestation receipt journal acknowledgment body",
    ),
  );
}

function acknowledgment(entry, entryDigest, status) {
  const body = acknowledgmentBody(entry, entryDigest, status);
  return Object.freeze({
    ...body,
    acknowledgmentDigest:
      createInternalTokenProductionAttestationReceiptJournalAcknowledgmentDigest(body),
  });
}

function normalizeAcknowledgment(input, command) {
  const value = exact(
    input,
    [
      "acknowledgmentDigest",
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
    "attestation receipt journal acknowledgment",
  );
  if (!new Set(["idempotent", "recorded"]).has(value.status)) {
    fail("attestation receipt journal acknowledgment status is invalid");
  }
  const entry = normalizeEntryBody({
    batchDigest: value.batchDigest,
    batchNonceDigest: value.batchNonceDigest,
    evidenceDigest: value.evidenceDigest,
    journalVersion: value.journalVersion,
    nextSequenceCheckpointDigest: value.nextSequenceCheckpointDigest,
    previousJournalDigest: value.previousJournalDigest,
    previousSequenceCheckpointDigest: value.previousSequenceCheckpointDigest,
    receiptCount: value.receiptCount,
    recordedAt: value.recordedAt,
    registryDigest: value.registryDigest,
    releaseDigest: value.releaseDigest,
    schemaVersion: value.schemaVersion,
  });
  const entryDigest = digest(value.entryDigest, "acknowledgment entry digest");
  if (hash(entry) !== entryDigest) fail("acknowledgment entry digest does not match");
  const body = acknowledgmentBody(entry, entryDigest, value.status);
  const acknowledgmentDigest = digest(
    value.acknowledgmentDigest,
    "journal acknowledgment digest",
  );
  if (hash(body) !== acknowledgmentDigest) {
    fail("journal acknowledgment digest does not match");
  }
  if (
    entry.batchDigest !== command.batchDigest ||
    entry.batchNonceDigest !== command.batch.batchNonceDigest ||
    entry.evidenceDigest !== command.batch.evidenceDigest ||
    entry.nextSequenceCheckpointDigest !== command.batch.nextSequenceCheckpointDigest ||
    entry.previousSequenceCheckpointDigest !== command.batch.previousSequenceCheckpointDigest ||
    entry.registryDigest !== command.batch.registryDigest ||
    entry.releaseDigest !== command.batch.releaseDigest ||
    entry.receiptCount !== RECEIPT_COUNT ||
    entry.previousJournalDigest !== command.expectedPreviousJournalDigest ||
    entry.journalVersion !== command.expectedJournalVersion + 1 ||
    entry.recordedAt !== command.recordedAt
  ) {
    fail("journal acknowledgment is not bound to the append command");
  }
  return Object.freeze({ ...body, acknowledgmentDigest });
}

function normalizeSnapshotEntry(input, index) {
  const value = exact(
    input,
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
    ],
    `attestation receipt journal snapshot entry ${index + 1}`,
  );
  const body = normalizeEntryBody({
    batchDigest: value.batchDigest,
    batchNonceDigest: value.batchNonceDigest,
    evidenceDigest: value.evidenceDigest,
    journalVersion: value.journalVersion,
    nextSequenceCheckpointDigest: value.nextSequenceCheckpointDigest,
    previousJournalDigest: value.previousJournalDigest,
    previousSequenceCheckpointDigest: value.previousSequenceCheckpointDigest,
    receiptCount: value.receiptCount,
    recordedAt: value.recordedAt,
    registryDigest: value.registryDigest,
    releaseDigest: value.releaseDigest,
    schemaVersion: value.schemaVersion,
  });
  const entryDigest = digest(
    value.entryDigest,
    `attestation receipt journal snapshot entry ${index + 1} digest`,
  );
  if (hash(body) !== entryDigest) {
    fail(`attestation receipt journal snapshot entry ${index + 1} digest does not match`);
  }
  return Object.freeze({ ...body, entryDigest });
}

function normalizeSnapshotBody(input) {
  const value = exact(
    input,
    [
      "entries",
      "environment",
      "genesisDigest",
      "headDigest",
      "latestSequenceCheckpointDigest",
      "schemaVersion",
      "version",
    ],
    "attestation receipt journal snapshot body",
  );
  if (
    value.schemaVersion !==
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION ||
    value.environment !== "production"
  ) {
    fail("attestation receipt journal snapshot environment or schema version is invalid");
  }
  const genesisDigest = digest(value.genesisDigest, "journal genesis digest");
  if (!Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) {
    fail("attestation receipt journal snapshot entries are invalid");
  }
  const entries = value.entries.map((entry, index) =>
    normalizeSnapshotEntry(entry, index),
  );
  let previousDigest = genesisDigest;
  let previousCheckpoint = null;
  for (const [index, entry] of entries.entries()) {
    if (
      entry.journalVersion !== index + 1 ||
      entry.previousJournalDigest !== previousDigest
    ) {
      fail("attestation receipt journal snapshot chain is not contiguous");
    }
    if (
      previousCheckpoint !== null &&
      entry.previousSequenceCheckpointDigest !== previousCheckpoint
    ) {
      fail("attestation receipt journal sequence chain is not contiguous");
    }
    previousDigest = entry.entryDigest;
    previousCheckpoint = entry.nextSequenceCheckpointDigest;
  }
  const version = integer(value.version, "journal snapshot version", 0);
  if (version !== entries.length) fail("journal snapshot version does not match entry count");
  const headDigest = digest(value.headDigest, "journal snapshot head digest");
  if (headDigest !== previousDigest) fail("journal snapshot head does not match the chain");
  const latestSequenceCheckpointDigest = digest(
    value.latestSequenceCheckpointDigest,
    "journal snapshot latest sequence-checkpoint digest",
  );
  if (
    entries.length > 0 &&
    latestSequenceCheckpointDigest !== entries.at(-1).nextSequenceCheckpointDigest
  ) {
    fail("journal snapshot latest sequence checkpoint does not match the chain");
  }
  if (entries.length === 0 && latestSequenceCheckpointDigest === genesisDigest) {
    fail("empty journal checkpoint digest must be distinct from the journal genesis");
  }
  distinct(
    [genesisDigest, latestSequenceCheckpointDigest, ...entries.map((entry) => entry.entryDigest)],
    "journal snapshot chain digests",
  );
  return Object.freeze({
    entries,
    environment: "production",
    genesisDigest,
    headDigest,
    latestSequenceCheckpointDigest,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
    version,
  });
}

export function createInternalTokenProductionAttestationReceiptJournalSnapshotDigest(input) {
  return hash(normalizeSnapshotBody(input));
}

export function verifyInternalTokenProductionAttestationReceiptJournalSnapshot(
  input,
  expectedInput,
) {
  const expected = exact(
    expectedInput,
    ["headDigest", "latestSequenceCheckpointDigest", "version"],
    "expected attestation receipt journal checkpoint",
  );
  const value = exact(
    input,
    [
      "entries",
      "environment",
      "genesisDigest",
      "headDigest",
      "latestSequenceCheckpointDigest",
      "schemaVersion",
      "snapshotDigest",
      "version",
    ],
    "attestation receipt journal snapshot",
  );
  const body = normalizeSnapshotBody({
    entries: value.entries,
    environment: value.environment,
    genesisDigest: value.genesisDigest,
    headDigest: value.headDigest,
    latestSequenceCheckpointDigest: value.latestSequenceCheckpointDigest,
    schemaVersion: value.schemaVersion,
    version: value.version,
  });
  const snapshotDigest = digest(value.snapshotDigest, "journal snapshot digest");
  if (hash(body) !== snapshotDigest) fail("journal snapshot digest does not match");
  if (
    body.version !== integer(expected.version, "expected journal version", 0) ||
    body.headDigest !== digest(expected.headDigest, "expected journal head digest") ||
    body.latestSequenceCheckpointDigest !== digest(
      expected.latestSequenceCheckpointDigest,
      "expected latest sequence-checkpoint digest",
    )
  ) {
    fail("journal snapshot does not match the protected checkpoint");
  }
  return Object.freeze({
    environment: "production",
    entryCount: body.entries.length,
    evidenceDigestsIncluded: false,
    identifiersIncluded: false,
    journalVersion: body.version,
    latestSequenceCheckpointPresent: true,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
    status: "reconciled",
  });
}

export function createInMemoryInternalTokenProductionAttestationReceiptJournal({
  genesisDigest: genesisDigestInput,
  initialSequenceCheckpointDigest: initialSequenceCheckpointDigestInput,
}) {
  const genesisDigest = digest(genesisDigestInput, "journal genesis digest");
  const initialSequenceCheckpointDigest = digest(
    initialSequenceCheckpointDigestInput,
    "initial sequence-checkpoint digest",
  );
  distinct(
    [genesisDigest, initialSequenceCheckpointDigest],
    "initial journal digests",
  );
  const entries = [];
  const acknowledgmentsByNonce = new Map();

  return Object.freeze({
    async append(commandInput) {
      const command = normalizeAppendCommand(commandInput);
      const prior = acknowledgmentsByNonce.get(command.batch.batchNonceDigest);
      if (prior) {
        if (prior.batchDigest !== command.batchDigest) {
          fail("batch nonce was already used for a different receipt batch");
        }
        if (
          command.expectedJournalVersion !== prior.journalVersion - 1 ||
          command.expectedPreviousJournalDigest !== prior.previousJournalDigest ||
          command.recordedAt !== prior.recordedAt
        ) {
          fail("idempotent retry does not match the original append command");
        }
        return acknowledgment(
          normalizeEntryBody({
            batchDigest: prior.batchDigest,
            batchNonceDigest: prior.batchNonceDigest,
            evidenceDigest: prior.evidenceDigest,
            journalVersion: prior.journalVersion,
            nextSequenceCheckpointDigest: prior.nextSequenceCheckpointDigest,
            previousJournalDigest: prior.previousJournalDigest,
            previousSequenceCheckpointDigest: prior.previousSequenceCheckpointDigest,
            receiptCount: prior.receiptCount,
            recordedAt: prior.recordedAt,
            registryDigest: prior.registryDigest,
            releaseDigest: prior.releaseDigest,
            schemaVersion: prior.schemaVersion,
          }),
          prior.entryDigest,
          "idempotent",
        );
      }
      const currentVersion = entries.length;
      const currentHead = entries.length === 0 ? genesisDigest : entries.at(-1).entryDigest;
      const currentCheckpoint = entries.length === 0
        ? initialSequenceCheckpointDigest
        : entries.at(-1).nextSequenceCheckpointDigest;
      if (
        command.expectedJournalVersion !== currentVersion ||
        command.expectedPreviousJournalDigest !== currentHead
      ) {
        fail("attestation receipt journal compare-and-swap failed");
      }
      if (command.batch.previousSequenceCheckpointDigest !== currentCheckpoint) {
        fail("attestation receipt sequence checkpoint compare-and-swap failed");
      }
      const entry = normalizeEntryBody({
        batchDigest: command.batchDigest,
        batchNonceDigest: command.batch.batchNonceDigest,
        evidenceDigest: command.batch.evidenceDigest,
        journalVersion: currentVersion + 1,
        nextSequenceCheckpointDigest: command.batch.nextSequenceCheckpointDigest,
        previousJournalDigest: currentHead,
        previousSequenceCheckpointDigest: currentCheckpoint,
        receiptCount: RECEIPT_COUNT,
        recordedAt: command.recordedAt,
        registryDigest: command.batch.registryDigest,
        releaseDigest: command.batch.releaseDigest,
        schemaVersion:
          INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
      });
      const entryDigest = hash(entry);
      const stored = Object.freeze({ ...entry, entryDigest });
      entries.push(stored);
      const ack = acknowledgment(entry, entryDigest, "recorded");
      acknowledgmentsByNonce.set(entry.batchNonceDigest, ack);
      return ack;
    },

    snapshot() {
      const headDigest = entries.length === 0 ? genesisDigest : entries.at(-1).entryDigest;
      const latestSequenceCheckpointDigest = entries.length === 0
        ? initialSequenceCheckpointDigest
        : entries.at(-1).nextSequenceCheckpointDigest;
      const body = {
        entries: entries.map((entry) => ({ ...entry })),
        environment: "production",
        genesisDigest,
        headDigest,
        latestSequenceCheckpointDigest,
        schemaVersion:
          INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
        version: entries.length,
      };
      return Object.freeze({
        ...body,
        snapshotDigest:
          createInternalTokenProductionAttestationReceiptJournalSnapshotDigest(body),
      });
    },
  });
}

function receiptDigest(receipt) {
  const value = exact(
    receipt,
    [
      "attestation",
      "issuedAt",
      "issuerKeyDigest",
      "receiptNonceDigest",
      "receiptSequence",
      "registryDigest",
      "schemaVersion",
      "sequenceCheckpointDigest",
      "signature",
    ],
    "signed attestation receipt for journaling",
  );
  return hash({
    attestationDigest: digest(
      value.attestation?.attestationDigest,
      "signed attestation receipt attestation digest",
    ),
    issuedAt: integer(value.issuedAt, "signed attestation receipt issued-at", 1),
    issuerKeyDigest: digest(value.issuerKeyDigest, "signed attestation receipt issuer-key digest"),
    receiptNonceDigest: digest(value.receiptNonceDigest, "signed attestation receipt nonce digest"),
    receiptSequence: integer(value.receiptSequence, "signed attestation receipt sequence", 1),
    registryDigest: digest(value.registryDigest, "signed attestation receipt registry digest"),
    schemaVersion: value.schemaVersion,
    sequenceCheckpointDigest: digest(
      value.sequenceCheckpointDigest,
      "signed attestation receipt sequence-checkpoint digest",
    ),
    signatureDigest: hash(value.signature),
  });
}

export async function verifyAndRecordInternalTokenProductionSignedControlEvidence(
  input,
  expectedInput,
  journalInput,
  recorderInput,
  nowInput,
) {
  const journal = exact(
    journalInput,
    [
      "batchNonceDigest",
      "expectedJournalVersion",
      "expectedPreviousJournalDigest",
    ],
    "attestation receipt journal command context",
  );
  if (!recorderInput || typeof recorderInput.append !== "function") {
    fail("an append-capable attestation receipt journal recorder is required");
  }
  const verified =
    verifyAndAssembleInternalTokenProductionSignedControlEvidence(
      input,
      expectedInput,
      nowInput,
    );
  if (!Array.isArray(input.receipts) || input.receipts.length !== RECEIPT_COUNT) {
    fail("verified signed receipt coverage is incomplete");
  }
  const batch = normalizeBatchBody({
    batchNonceDigest: journal.batchNonceDigest,
    evidenceDigest: verified.evidence.evidenceDigest,
    nextSequenceCheckpointDigest:
      verified.nextSequenceCheckpoint.checkpointDigest,
    previousSequenceCheckpointDigest:
      expectedInput.sequenceCheckpointDigest,
    receiptDigests: input.receipts.map(receiptDigest),
    registryDigest: expectedInput.registryDigest,
    releaseDigest: expectedInput.releaseDigest,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
  });
  const batchDigest = hash(batch);
  const command = Object.freeze({
    batch,
    batchDigest,
    expectedJournalVersion: journal.expectedJournalVersion,
    expectedPreviousJournalDigest: journal.expectedPreviousJournalDigest,
    recordedAt: integer(nowInput, "journal recording clock", 1),
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
  });
  const rawAcknowledgment = await recorderInput.append(command);
  const ack = normalizeAcknowledgment(rawAcknowledgment, command);
  return Object.freeze({
    evidence: verified.evidence,
    nextSequenceCheckpoint: verified.nextSequenceCheckpoint,
    summary: Object.freeze({
      activeIssuerCount: verified.summary.activeIssuerCount,
      attestationCount: verified.summary.attestationCount,
      controlCount: verified.summary.controlCount,
      environment: "production",
      evidenceDigestsIncluded: false,
      expiresAt: verified.summary.expiresAt,
      identifiersIncluded: false,
      journalAcknowledgmentDigestsIncluded: false,
      journalVersion: ack.journalVersion,
      launchApprovalIncluded: false,
      receiptDigestsIncluded: false,
      recorded: true,
      replayCheckpointAdvanced: true,
      replayedIdempotently: ack.status === "idempotent",
      schemaVersion:
        INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_JOURNAL_SCHEMA_VERSION,
      signedReceiptCount: verified.summary.signedReceiptCount,
      status: "verified_assembled_and_recorded",
    }),
  });
}
