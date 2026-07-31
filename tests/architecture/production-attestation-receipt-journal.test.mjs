import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("receipt journal verifies signed evidence before invoking the append recorder", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-receipt-journal.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const verifyIndex = boundary.indexOf(
    "verifyAndAssembleInternalTokenProductionSignedControlEvidence(",
  );
  const appendIndex = boundary.indexOf("await recorderInput.append(command)");
  assert.ok(verifyIndex >= 0);
  assert.ok(appendIndex > verifyIndex);
  assert.match(boundary, /must contain exactly thirteen receipts/u);
  assert.match(boundary, /compare-and-swap failed/u);
  assert.match(boundary, /idempotent retry/u);
  assert.match(boundary, /batch nonce was already used/u);
});

test("journal state is append-only, checkpoint-chained and recoverable", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-receipt-journal.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(boundary, /previousJournalDigest/u);
  assert.match(boundary, /previousSequenceCheckpointDigest/u);
  assert.match(boundary, /nextSequenceCheckpointDigest/u);
  assert.match(boundary, /snapshot chain is not contiguous/u);
  assert.match(boundary, /does not match the protected checkpoint/u);
  assert.match(boundary, /status: "reconciled"/u);
  assert.doesNotMatch(boundary, /DELETE FROM|UPDATE .*journal/iu);
});

test("journal public summaries are aggregate-only and workflow-tracked", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-receipt-journal.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const marker of [
    "identifiersIncluded: false",
    "evidenceDigestsIncluded: false",
    "journalAcknowledgmentDigestsIncluded: false",
    "receiptDigestsIncluded: false",
    "launchApprovalIncluded: false",
  ]) {
    assert.equal(boundary.includes(marker), true);
  }

  const workflow = await readFile(
    new URL(
      "../../.github/workflows/production-launch-admission.yml",
      import.meta.url,
    ),
    "utf8",
  );
  for (const requiredPath of [
    "internal-token-production-attestation-receipt-journal.mjs",
    "internal-token-production-attestation-receipt-journal*.test.mjs",
    "production-attestation-receipt-journal.test.mjs",
    "production-attestation-receipt-journal.md",
  ]) {
    assert.equal(workflow.includes(requiredPath), true);
  }
  assert.doesNotMatch(workflow, /STORE_DEPLOYMENT_TARGET:\s*production/u);
  assert.doesNotMatch(workflow, /secrets\./u);
});
