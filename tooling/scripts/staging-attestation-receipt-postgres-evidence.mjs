import { createHash } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import {
  createInternalTokenProductionAttestationReceiptBatchDigest,
} from "./internal-token-production-attestation-receipt-journal.mjs";
import {
  INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL,
  createPostgresInternalTokenProductionAttestationReceiptJournalRecorder,
} from "./internal-token-production-attestation-receipt-postgres.mjs";

function digest(label) {
  return createHash("sha256").update(label).digest("base64url");
}

function createCommand({
  label,
  batchNonceDigest,
  expectedJournalVersion,
  expectedPreviousJournalDigest,
  previousSequenceCheckpointDigest,
  recordedAt,
}) {
  const batch = Object.freeze({
    batchNonceDigest: batchNonceDigest ?? digest(`${label}:batch-nonce`),
    evidenceDigest: digest(`${label}:evidence`),
    nextSequenceCheckpointDigest: digest(`${label}:next-sequence`),
    previousSequenceCheckpointDigest,
    receiptDigests: Object.freeze(
      Array.from({ length: 13 }, (_, index) =>
        digest(`${label}:receipt:${index + 1}`),
      ).sort(),
    ),
    registryDigest: digest(`${label}:registry`),
    releaseDigest: digest(`${label}:release`),
    schemaVersion: 1,
  });
  return Object.freeze({
    batch,
    batchDigest:
      createInternalTokenProductionAttestationReceiptBatchDigest(batch),
    expectedJournalVersion,
    expectedPreviousJournalDigest,
    recordedAt,
    schemaVersion: 1,
  });
}

async function protectedCoordinates(client) {
  const result = await client.query(`
    SELECT
      state.schema_version::int,
      state.journal_version::text,
      state.genesis_digest,
      state.head_digest,
      state.latest_sequence_checkpoint_digest,
      state.entry_count::text
    FROM platform.internal_token_production_attestation_receipt_journal_state AS state
    WHERE state.singleton = true`);
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw new Error("Attestation receipt journal state cardinality is invalid");
  }
  return result.rows[0];
}

async function rowCounts(client, batchNonceDigest) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::int
          FROM platform.internal_token_production_attestation_receipt_journal_state) AS state_rows,
       (SELECT count(*)::int
          FROM platform.internal_token_production_attestation_receipt_journal) AS entry_rows,
       (SELECT count(*)::int
          FROM platform.internal_token_production_attestation_receipt_journal
         WHERE batch_nonce_digest = $1) AS matching_batch_rows`,
    [batchNonceDigest],
  );
  return result.rows[0];
}

async function privileges(client) {
  const result = await client.query(`
    SELECT
      NOT has_table_privilege(
        'store_app_runtime',
        'platform.internal_token_production_attestation_receipt_journal',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_entry_dml_denied,
      NOT has_table_privilege(
        'store_app_runtime',
        'platform.internal_token_production_attestation_receipt_journal_state',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_state_dml_denied,
      NOT has_table_privilege(
        'store_app_reporting',
        'platform.internal_token_production_attestation_receipt_journal',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS reporting_entry_dml_denied,
      has_function_privilege(
        'store_key_governance_runtime',
        'platform.append_internal_token_production_attestation_receipt_journal(smallint,text,text,text,text,text,text,text,text,text[],bigint,bigint,text)',
        'EXECUTE'
      ) AS governance_append_granted,
      NOT has_function_privilege(
        'public',
        'platform.append_internal_token_production_attestation_receipt_journal(smallint,text,text,text,text,text,text,text,text,text[],bigint,bigint,text)',
        'EXECUTE'
      ) AS public_append_denied`);
  return result.rows[0];
}

function sameCoordinates(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runProductionAttestationReceiptPostgresEvidence({
  connectionString,
  runId,
}) {
  if (typeof connectionString !== "string" || connectionString.length < 1) {
    throw new Error("Attestation receipt Postgres evidence requires a connection string");
  }
  const client = new Client({ connectionString });
  await client.connect();
  const label = `staging-attestation-receipt:${runId || Date.now()}`;
  const defaultGenesis = digest(`${label}:genesis`);
  const defaultSequence = digest(`${label}:initial-sequence`);
  const batchNonceDigest = digest(`${label}:batch-nonce`);
  let transactionOpen = false;
  try {
    const beforeState = await protectedCoordinates(client);
    const beforeCounts = await rowCounts(client, batchNonceDigest);
    const expectedJournalVersion = beforeState
      ? Number(beforeState.journal_version)
      : 0;
    if (!Number.isSafeInteger(expectedJournalVersion) || expectedJournalVersion < 0) {
      throw new Error("Attestation receipt journal version is unsafe");
    }
    const expectedPreviousJournalDigest =
      beforeState?.head_digest ?? defaultGenesis;
    const previousSequenceCheckpointDigest =
      beforeState?.latest_sequence_checkpoint_digest ?? defaultSequence;
    const recordedAt = Date.now();
    const command = createCommand({
      label,
      batchNonceDigest,
      expectedJournalVersion,
      expectedPreviousJournalDigest,
      previousSequenceCheckpointDigest,
      recordedAt,
    });
    const captured = [];
    const recorder =
      createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
        async query(sql, parameters) {
          if (sql === INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL) {
            captured.push([...parameters]);
          }
          return await client.query(sql, parameters);
        },
      });

    await client.query("BEGIN");
    transactionOpen = true;

    const recorded = await recorder.append(command);
    if (recorded.status !== "recorded") {
      throw new Error("Attestation receipt journal first append was not recorded");
    }
    const replay = await recorder.append(command);
    if (
      replay.status !== "idempotent" ||
      replay.entryDigest !== recorded.entryDigest ||
      replay.journalVersion !== recorded.journalVersion
    ) {
      throw new Error("Attestation receipt journal exact retry was not idempotent");
    }

    const state = await recorder.readState();
    if (
      state.version !== expectedJournalVersion + 1 ||
      state.entryCount !== state.version ||
      state.headDigest !== recorded.entryDigest ||
      state.latestSequenceCheckpointDigest !==
        command.batch.nextSequenceCheckpointDigest
    ) {
      throw new Error("Attestation receipt journal transactional state is inconsistent");
    }

    let staleCasRejected = false;
    try {
      await recorder.append(
        createCommand({
          label: `${label}:stale`,
          expectedJournalVersion,
          expectedPreviousJournalDigest,
          previousSequenceCheckpointDigest,
          recordedAt,
        }),
      );
    } catch {
      staleCasRejected = true;
    }
    if (!staleCasRejected) {
      throw new Error("Attestation receipt journal stale compare-and-swap was accepted");
    }

    let nonceConflictRejected = false;
    try {
      await recorder.append(
        createCommand({
          label: `${label}:nonce-conflict`,
          batchNonceDigest,
          expectedJournalVersion: state.version,
          expectedPreviousJournalDigest: state.headDigest,
          previousSequenceCheckpointDigest:
            state.latestSequenceCheckpointDigest,
          recordedAt,
        }),
      );
    } catch {
      nonceConflictRejected = true;
    }
    if (!nonceConflictRejected) {
      throw new Error("Attestation receipt journal conflicting nonce was accepted");
    }

    const firstParameters = captured[0];
    if (!Array.isArray(firstParameters) || firstParameters.length !== 13) {
      throw new Error("Attestation receipt journal append parameters were not captured");
    }
    let tamperedEntryRejected = false;
    try {
      await client.query(
        INTERNAL_TOKEN_PRODUCTION_ATTESTATION_RECEIPT_POSTGRES_APPEND_SQL,
        [...firstParameters.slice(0, 12), digest(`${label}:tampered-entry`)],
      );
    } catch {
      tamperedEntryRejected = true;
    }
    if (!tamperedEntryRejected) {
      throw new Error("Attestation receipt journal tampered entry digest was accepted");
    }

    const privilegeEvidence = await privileges(client);
    if (
      privilegeEvidence.runtime_entry_dml_denied !== true ||
      privilegeEvidence.runtime_state_dml_denied !== true ||
      privilegeEvidence.reporting_entry_dml_denied !== true ||
      privilegeEvidence.governance_append_granted !== true ||
      privilegeEvidence.public_append_denied !== true
    ) {
      throw new Error("Attestation receipt journal privilege boundary is incomplete");
    }

    await client.query("ROLLBACK");
    transactionOpen = false;

    const afterState = await protectedCoordinates(client);
    const afterCounts = await rowCounts(client, batchNonceDigest);
    if (
      !sameCoordinates(beforeState, afterState) ||
      Number(afterCounts.state_rows) !== Number(beforeCounts.state_rows) ||
      Number(afterCounts.entry_rows) !== Number(beforeCounts.entry_rows) ||
      Number(afterCounts.matching_batch_rows) !== 0
    ) {
      throw new Error("Attestation receipt journal transaction rollback was incomplete");
    }

    return Object.freeze({
      applicationDmlDenied: true,
      databaseDigestRecomputed: true,
      exactReplayIdempotent: true,
      nonceConflictRejected: true,
      publicExecuteDenied: true,
      rollbackVerified: true,
      schemaVersion: 1,
      staleCompareAndSwapRejected: true,
      status: "passed",
      tamperedEntryDigestRejected: true,
      transactionSerialized: true,
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the primary fail-closed evidence error.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}
