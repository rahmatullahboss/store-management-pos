import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryInternalTokenProductionAttestationReceiptJournal,
  createInternalTokenProductionAttestationReceiptJournalSnapshotDigest,
  verifyAndRecordInternalTokenProductionSignedControlEvidence,
  verifyInternalTokenProductionAttestationReceiptJournalSnapshot,
} from "../../tooling/scripts/internal-token-production-attestation-receipt-journal.mjs";
import {
  evaluateInternalTokenProductionLaunchAdmission,
} from "../../tooling/scripts/internal-token-production-launch-admission.mjs";
import {
  evaluateInternalTokenProductionLaunchRevocation,
} from "../../tooling/scripts/internal-token-production-launch-revocation.mjs";
import {
  controlAttestationDigest,
  createProductionLaunchBundleFromEvidence,
} from "../helpers/production-control-attestation-fixtures.mjs";
import {
  createProductionAttestationIssuerIdentityFixture,
  issuerIdentityNow,
  resignProductionAttestationReceipt,
} from "../helpers/production-attestation-issuer-identity-fixtures.mjs";
import {
  createProductionLaunchRevocationSnapshot,
} from "../helpers/production-launch-governance-fixtures.mjs";

const genesisDigest = controlAttestationDigest("attestation-receipt-journal-genesis");
const firstBatchNonceDigest = controlAttestationDigest("attestation-receipt-batch-one");
const secondBatchNonceDigest = controlAttestationDigest("attestation-receipt-batch-two");

function createJournal(fixture) {
  return createInMemoryInternalTokenProductionAttestationReceiptJournal({
    genesisDigest,
    initialSequenceCheckpointDigest:
      fixture.expected.sequenceCheckpointDigest,
  });
}

function journalCommand(batchNonceDigest, version, previousJournalDigest) {
  return {
    batchNonceDigest,
    expectedJournalVersion: version,
    expectedPreviousJournalDigest: previousJournalDigest,
  };
}

async function record(
  fixture,
  journal,
  context = journalCommand(firstBatchNonceDigest, 0, genesisDigest),
) {
  return verifyAndRecordInternalTokenProductionSignedControlEvidence(
    fixture.input,
    fixture.expected,
    context,
    journal,
    issuerIdentityNow,
  );
}

function prepareNextBatch(fixture, nextSequenceCheckpoint) {
  fixture.input.sequenceCheckpoint = structuredClone(nextSequenceCheckpoint);
  fixture.expected.sequenceCheckpointDigest =
    nextSequenceCheckpoint.checkpointDigest;
  for (const [index, receipt] of fixture.input.receipts.entries()) {
    receipt.receiptSequence = 2;
    receipt.receiptNonceDigest = controlAttestationDigest(
      `second-receipt-nonce-${index}`,
    );
    receipt.sequenceCheckpointDigest = nextSequenceCheckpoint.checkpointDigest;
    resignProductionAttestationReceipt(fixture, index);
  }
}

function resealSnapshot(snapshot) {
  const body = {
    entries: snapshot.entries,
    environment: snapshot.environment,
    genesisDigest: snapshot.genesisDigest,
    headDigest: snapshot.headDigest,
    latestSequenceCheckpointDigest: snapshot.latestSequenceCheckpointDigest,
    schemaVersion: snapshot.schemaVersion,
    version: snapshot.version,
  };
  snapshot.snapshotDigest =
    createInternalTokenProductionAttestationReceiptJournalSnapshotDigest(body);
  return snapshot;
}

function assertAggregateOnly(summary) {
  for (const key of [
    "acknowledgmentDigest",
    "batchDigest",
    "batchNonceDigest",
    "entryDigest",
    "evidenceDigest",
    "issuerDigest",
    "previousJournalDigest",
    "receiptDigest",
    "registryDigest",
    "releaseDigest",
    "sequenceCheckpointDigest",
    "signature",
  ]) {
    assert.equal(Object.hasOwn(summary, key), false);
  }
}

test("verified thirteen-receipt batch records atomically and continues through admission and revocation", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  const result = await record(fixture, journal);

  assert.deepEqual(result.summary, {
    activeIssuerCount: 13,
    attestationCount: 13,
    controlCount: 10,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: issuerIdentityNow + 240,
    identifiersIncluded: false,
    journalAcknowledgmentDigestsIncluded: false,
    journalVersion: 1,
    launchApprovalIncluded: false,
    receiptDigestsIncluded: false,
    recorded: true,
    replayCheckpointAdvanced: true,
    replayedIdempotently: false,
    schemaVersion: 1,
    signedReceiptCount: 13,
    status: "verified_assembled_and_recorded",
  });
  assertAggregateOnly(result.summary);

  const bundle = createProductionLaunchBundleFromEvidence(result.evidence);
  const admission = evaluateInternalTokenProductionLaunchAdmission(
    bundle,
    issuerIdentityNow,
  );
  assert.equal(admission.launchGate, "clear");
  const revocation = createProductionLaunchRevocationSnapshot({
    bundle,
    expiresAt: issuerIdentityNow + 120,
    generatedAt: issuerIdentityNow - 5,
  });
  const revocationResult = evaluateInternalTokenProductionLaunchRevocation(
    revocation,
    {
      admissionBundleDigest: bundle.bundleDigest,
      headDigest: revocation.headDigest,
      releaseDigest: result.evidence.releaseDigest,
    },
    issuerIdentityNow,
  );
  assert.equal(revocationResult.launchGate, "clear");

  const snapshot = journal.snapshot();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].receiptCount, 13);
});

test("an exact retry is idempotent and does not advance journal state twice", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  const first = await record(fixture, journal);
  const second = await record(fixture, journal);
  assert.equal(first.summary.journalVersion, 1);
  assert.equal(first.summary.replayedIdempotently, false);
  assert.equal(second.summary.journalVersion, 1);
  assert.equal(second.summary.replayedIdempotently, true);
  assert.equal(journal.snapshot().entries.length, 1);
});

test("the same batch nonce cannot identify a different signed receipt batch", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  await record(fixture, journal);
  fixture.input.receipts[0].receiptNonceDigest =
    controlAttestationDigest("conflicting-receipt-nonce");
  resignProductionAttestationReceipt(fixture, 0);
  await assert.rejects(
    record(fixture, journal),
    /batch nonce was already used for a different receipt batch/u,
  );
  assert.equal(journal.snapshot().version, 1);
});

test("two valid batches form contiguous journal and sequence-checkpoint chains", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  const first = await record(fixture, journal);
  const afterFirst = journal.snapshot();
  prepareNextBatch(fixture, first.nextSequenceCheckpoint);
  const second = await record(
    fixture,
    journal,
    journalCommand(secondBatchNonceDigest, 1, afterFirst.headDigest),
  );
  assert.equal(second.summary.journalVersion, 2);
  assert.equal(second.summary.replayedIdempotently, false);
  const snapshot = journal.snapshot();
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.entries[1].previousJournalDigest, snapshot.entries[0].entryDigest);
  assert.equal(
    snapshot.entries[1].previousSequenceCheckpointDigest,
    snapshot.entries[0].nextSequenceCheckpointDigest,
  );
});

test("stale version, journal head and sequence checkpoint fail without partial append", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  const first = await record(fixture, journal);
  const before = journal.snapshot();
  prepareNextBatch(fixture, first.nextSequenceCheckpoint);

  await assert.rejects(
    record(
      fixture,
      journal,
      journalCommand(secondBatchNonceDigest, 0, genesisDigest),
    ),
    /journal compare-and-swap failed/u,
  );
  assert.deepEqual(journal.snapshot(), before);

  const wrongHead = controlAttestationDigest("wrong-journal-head");
  await assert.rejects(
    record(
      fixture,
      journal,
      journalCommand(secondBatchNonceDigest, 1, wrongHead),
    ),
    /journal compare-and-swap failed/u,
  );
  assert.deepEqual(journal.snapshot(), before);

  fixture.expected.sequenceCheckpointDigest =
    controlAttestationDigest("wrong-protected-sequence-checkpoint");
  await assert.rejects(
    record(
      fixture,
      journal,
      journalCommand(secondBatchNonceDigest, 1, before.headDigest),
    ),
    /sequence checkpoint digest does not match the protected checkpoint/u,
  );
  assert.deepEqual(journal.snapshot(), before);
});

test("partial or invalid receipt batches never call the recorder", async () => {
  for (const mutation of [
    (fixture) => fixture.input.receipts.pop(),
    (fixture) => {
      const bytes = Buffer.from(fixture.input.receipts[0].signature, "base64url");
      bytes[0] ^= 0x01;
      fixture.input.receipts[0].signature = bytes.toString("base64url");
    },
  ]) {
    const fixture = createProductionAttestationIssuerIdentityFixture();
    mutation(fixture);
    let appendCalls = 0;
    const recorder = {
      async append() {
        appendCalls += 1;
        throw new Error("append must not be called");
      },
    };
    await assert.rejects(
      verifyAndRecordInternalTokenProductionSignedControlEvidence(
        fixture.input,
        fixture.expected,
        journalCommand(firstBatchNonceDigest, 0, genesisDigest),
        recorder,
        issuerIdentityNow,
      ),
    );
    assert.equal(appendCalls, 0);
  }
});

test("recorder failure returns no evidence and leaves durable state external to the boundary", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  let appendCalls = 0;
  const recorder = {
    async append() {
      appendCalls += 1;
      throw new Error("durable transaction rolled back");
    },
  };
  await assert.rejects(
    verifyAndRecordInternalTokenProductionSignedControlEvidence(
      fixture.input,
      fixture.expected,
      journalCommand(firstBatchNonceDigest, 0, genesisDigest),
      recorder,
      issuerIdentityNow,
    ),
    /durable transaction rolled back/u,
  );
  assert.equal(appendCalls, 1);
});

test("recovery snapshot reconciles exact protected version, head and sequence checkpoint", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  const first = await record(fixture, journal);
  const afterFirst = journal.snapshot();
  prepareNextBatch(fixture, first.nextSequenceCheckpoint);
  await record(
    fixture,
    journal,
    journalCommand(secondBatchNonceDigest, 1, afterFirst.headDigest),
  );
  const snapshot = journal.snapshot();
  const result = verifyInternalTokenProductionAttestationReceiptJournalSnapshot(
    snapshot,
    {
      headDigest: snapshot.headDigest,
      latestSequenceCheckpointDigest: snapshot.latestSequenceCheckpointDigest,
      version: 2,
    },
  );
  assert.deepEqual(result, {
    environment: "production",
    entryCount: 2,
    evidenceDigestsIncluded: false,
    identifiersIncluded: false,
    journalVersion: 2,
    latestSequenceCheckpointPresent: true,
    schemaVersion: 1,
    status: "reconciled",
  });
  assertAggregateOnly(result);
});

test("journal tampering and validly resealed tail truncation fail closed", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  const first = await record(fixture, journal);
  const afterFirst = journal.snapshot();
  prepareNextBatch(fixture, first.nextSequenceCheckpoint);
  await record(
    fixture,
    journal,
    journalCommand(secondBatchNonceDigest, 1, afterFirst.headDigest),
  );
  const complete = journal.snapshot();

  const tampered = structuredClone(complete);
  tampered.entries[0].evidenceDigest =
    controlAttestationDigest("tampered-journal-evidence");
  assert.throws(
    () =>
      verifyInternalTokenProductionAttestationReceiptJournalSnapshot(
        tampered,
        {
          headDigest: complete.headDigest,
          latestSequenceCheckpointDigest:
            complete.latestSequenceCheckpointDigest,
          version: 2,
        },
      ),
    /entry 1 digest does not match/u,
  );

  const truncated = structuredClone(complete);
  truncated.entries.pop();
  truncated.version = 1;
  truncated.headDigest = truncated.entries[0].entryDigest;
  truncated.latestSequenceCheckpointDigest =
    truncated.entries[0].nextSequenceCheckpointDigest;
  resealSnapshot(truncated);
  assert.throws(
    () =>
      verifyInternalTokenProductionAttestationReceiptJournalSnapshot(
        truncated,
        {
          headDigest: complete.headDigest,
          latestSequenceCheckpointDigest:
            complete.latestSequenceCheckpointDigest,
          version: 2,
        },
      ),
    /does not match the protected checkpoint/u,
  );
});

test("exact command schemas reject raw operator, database and provider resource fields", async () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const journal = createJournal(fixture);
  for (const extra of [
    { operatorEmail: "release-owner@example.com" },
    { databaseUrl: "postgres://production" },
    { providerResource: "projects/prod/keyRings/attestation" },
  ]) {
    await assert.rejects(
      record(fixture, journal, {
        ...journalCommand(firstBatchNonceDigest, 0, genesisDigest),
        ...extra,
      }),
      /command context fields are invalid/u,
    );
    assert.equal(journal.snapshot().version, 0);
  }
});
