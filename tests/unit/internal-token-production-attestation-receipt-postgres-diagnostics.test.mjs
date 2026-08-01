import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createInternalTokenProductionAttestationReceiptBatchDigest,
} from "../../tooling/scripts/internal-token-production-attestation-receipt-journal.mjs";
import {
  createPostgresInternalTokenProductionAttestationReceiptJournalRecorder,
} from "../../tooling/scripts/internal-token-production-attestation-receipt-postgres.mjs";

function digest(label) {
  return createHash("sha256").update(label).digest("base64url");
}

function command() {
  const batch = Object.freeze({
    batchNonceDigest: digest("diagnostics:batch-nonce"),
    evidenceDigest: digest("diagnostics:evidence"),
    nextSequenceCheckpointDigest: digest("diagnostics:next-sequence"),
    previousSequenceCheckpointDigest: digest("diagnostics:previous-sequence"),
    receiptDigests: Object.freeze(
      Array.from({ length: 13 }, (_, index) =>
        digest(`diagnostics:receipt:${index + 1}`),
      ),
    ),
    registryDigest: digest("diagnostics:registry"),
    releaseDigest: digest("diagnostics:release"),
    schemaVersion: 1,
  });
  return Object.freeze({
    batch,
    batchDigest:
      createInternalTokenProductionAttestationReceiptBatchDigest(batch),
    expectedJournalVersion: 0,
    expectedPreviousJournalDigest: digest("diagnostics:previous-journal"),
    recordedAt: 1_800_000_000_000,
    schemaVersion: 1,
  });
}

test("Postgres recorder exposes structural diagnostics without leaking database values", async () => {
  const databaseError = Object.assign(
    new Error("value secret-receipt-value is out of range for type integer"),
    {
      code: "22003",
      where:
        "PL/pgSQL function platform.record_internal_token_production_attestation_receipt_batch(jsonb) line 58 at assignment",
      routine: "pg_strtoint32_safe",
      dataType: "integer",
      schema: "platform",
      table: "internal_token_production_attestation_receipt_journal",
      column: "journal_version",
      constraint: "journal_version_guard",
      detail: "secret-detail-value",
      hint: "secret-hint-value",
      query: "SELECT secret-query-value",
    },
  );
  const recorder =
    createPostgresInternalTokenProductionAttestationReceiptJournalRecorder({
      async query() {
        throw databaseError;
      },
    });

  await assert.rejects(recorder.append(command()), (error) => {
    assert.equal(error.code, "22003");
    assert.deepEqual(error.diagnostics, {
      pgCode: "22003",
      databaseWhere:
        "PL/pgSQL function platform.record_internal_token_production_attestation_receipt_batch(jsonb) line 58 at assignment",
      databaseRoutine: "pg_strtoint32_safe",
      databaseDataType: "integer",
      databaseSchema: "platform",
      databaseTable:
        "internal_token_production_attestation_receipt_journal",
      databaseColumn: "journal_version",
      databaseConstraint: "journal_version_guard",
    });
    assert.match(error.message, /append failed/u);
    assert.match(error.message, /pgCode=22003/u);
    assert.match(error.message, /line 58 at assignment/u);
    assert.doesNotMatch(
      JSON.stringify({ message: error.message, diagnostics: error.diagnostics }),
      /secret-receipt-value|secret-detail-value|secret-hint-value|secret-query-value/u,
    );
    return true;
  });
});
