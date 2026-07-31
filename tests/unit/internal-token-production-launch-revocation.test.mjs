import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateInternalTokenProductionLaunchRevocation,
} from "../../tooling/scripts/internal-token-production-launch-revocation.mjs";
import {
  createProductionLaunchBundle,
  createProductionLaunchRevocationSnapshot,
  productionLaunchDigest,
  productionLaunchNow,
  resealProductionLaunchRevocationSnapshot,
} from "../helpers/production-launch-governance-fixtures.mjs";

function expected(snapshot, bundle) {
  return {
    admissionBundleDigest: bundle.bundleDigest,
    headDigest: snapshot.headDigest,
    releaseDigest: bundle.evidence.releaseDigest,
  };
}

function assertAggregateOnly(result) {
  for (const key of [
    "actorDigest",
    "admissionBundleDigest",
    "approvalDigest",
    "entryDigest",
    "genesisDigest",
    "headDigest",
    "incidentDigest",
    "reasonDigest",
    "releaseDigest",
    "snapshotDigest",
  ]) {
    assert.equal(Object.hasOwn(result, key), false);
  }
}

test("a fresh empty protected journal keeps an admitted launch clear", () => {
  const bundle = createProductionLaunchBundle();
  const snapshot = createProductionLaunchRevocationSnapshot({ bundle });
  const result = evaluateInternalTokenProductionLaunchRevocation(
    snapshot,
    expected(snapshot, bundle),
    productionLaunchNow,
  );
  assert.deepEqual(result, {
    approvalCount: 0,
    emergencyStopCount: 0,
    entryCount: 0,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: productionLaunchNow + 120,
    identifiersIncluded: false,
    latestAction: "none",
    launchGate: "clear",
    revocationState: "clear",
    schemaVersion: 1,
    status: "clear",
  });
  assertAggregateOnly(result);
});

test("three-owner suspension blocks launch until three-owner reinstatement", () => {
  const bundle = createProductionLaunchBundle();
  const suspended = createProductionLaunchRevocationSnapshot({
    actions: ["suspend"],
    bundle,
  });
  assert.deepEqual(
    evaluateInternalTokenProductionLaunchRevocation(
      suspended,
      expected(suspended, bundle),
      productionLaunchNow,
    ),
    {
      approvalCount: 3,
      emergencyStopCount: 0,
      entryCount: 1,
      environment: "production",
      evidenceDigestsIncluded: false,
      expiresAt: productionLaunchNow + 120,
      identifiersIncluded: false,
      latestAction: "suspend",
      launchGate: "blocked",
      revocationState: "suspended",
      schemaVersion: 1,
      status: "suspended",
    },
  );

  const reinstated = createProductionLaunchRevocationSnapshot({
    actions: ["suspend", "reinstate"],
    bundle,
  });
  const result = evaluateInternalTokenProductionLaunchRevocation(
    reinstated,
    expected(reinstated, bundle),
    productionLaunchNow,
  );
  assert.equal(result.launchGate, "clear");
  assert.equal(result.revocationState, "clear");
  assert.equal(result.approvalCount, 6);
  assert.equal(result.latestAction, "reinstate");
  assertAggregateOnly(result);
});

test("one security owner can emergency-stop but cannot silently reinstate", () => {
  const bundle = createProductionLaunchBundle();
  const stopped = createProductionLaunchRevocationSnapshot({
    actions: ["emergency_stop"],
    bundle,
  });
  const stoppedResult = evaluateInternalTokenProductionLaunchRevocation(
    stopped,
    expected(stopped, bundle),
    productionLaunchNow,
  );
  assert.equal(stoppedResult.launchGate, "blocked");
  assert.equal(stoppedResult.revocationState, "suspended");
  assert.equal(stoppedResult.approvalCount, 1);
  assert.equal(stoppedResult.emergencyStopCount, 1);

  const reinstated = createProductionLaunchRevocationSnapshot({
    actions: ["emergency_stop", "reinstate"],
    bundle,
  });
  const reinstatedResult = evaluateInternalTokenProductionLaunchRevocation(
    reinstated,
    expected(reinstated, bundle),
    productionLaunchNow,
  );
  assert.equal(reinstatedResult.launchGate, "clear");
  assert.equal(reinstatedResult.approvalCount, 4);
});

test("revocation is terminal whether launch is clear or suspended", () => {
  const bundle = createProductionLaunchBundle();
  for (const actions of [["revoke"], ["suspend", "revoke"]]) {
    const snapshot = createProductionLaunchRevocationSnapshot({ actions, bundle });
    const result = evaluateInternalTokenProductionLaunchRevocation(
      snapshot,
      expected(snapshot, bundle),
      productionLaunchNow,
    );
    assert.equal(result.launchGate, "blocked");
    assert.equal(result.revocationState, "revoked");
    assert.equal(result.latestAction, "revoke");
  }

  const afterRevocation = createProductionLaunchRevocationSnapshot({
    actions: ["revoke", "reinstate"],
    bundle,
  });
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        afterRevocation,
        expected(afterRevocation, bundle),
        productionLaunchNow,
      ),
    /follows a terminal revocation/u,
  );
});

test("normal actions require all three roles and distinct actors", () => {
  const bundle = createProductionLaunchBundle();
  const missing = createProductionLaunchRevocationSnapshot({
    actions: ["suspend"],
    bundle,
  });
  missing.entries[0].approvals.pop();
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        missing,
        expected(missing, bundle),
        productionLaunchNow,
      ),
    /approval count is invalid/u,
  );

  const duplicateActors = createProductionLaunchRevocationSnapshot({
    actions: [
      {
        action: "suspend",
        actors: ["same-owner", "same-owner", "third-owner"],
      },
    ],
    bundle,
  });
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        duplicateActors,
        expected(duplicateActors, bundle),
        productionLaunchNow,
      ),
    /approval actors must be distinct/u,
  );
});

test("tampering, stale evidence and cross-release reuse fail closed", () => {
  const bundle = createProductionLaunchBundle();
  const tampered = createProductionLaunchRevocationSnapshot({
    actions: ["suspend"],
    bundle,
  });
  tampered.entries[0].reasonDigest = productionLaunchDigest("tampered-reason");
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        tampered,
        expected(tampered, bundle),
        productionLaunchNow,
      ),
    /approval 1 binding is invalid|entry 1 digest does not match/u,
  );

  const stale = createProductionLaunchRevocationSnapshot({
    bundle,
    expiresAt: productionLaunchNow - 1,
    generatedAt: productionLaunchNow - 120,
  });
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        stale,
        expected(stale, bundle),
        productionLaunchNow,
      ),
    /stale or not yet valid/u,
  );

  const otherBundle = createProductionLaunchBundle(productionLaunchNow + 1);
  const snapshot = createProductionLaunchRevocationSnapshot({ bundle });
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        snapshot,
        {
          admissionBundleDigest: otherBundle.bundleDigest,
          headDigest: snapshot.headDigest,
          releaseDigest: otherBundle.evidence.releaseDigest,
        },
        productionLaunchNow,
      ),
    /not bound to the admitted launch/u,
  );
});

test("protected journal head prevents a validly resealed truncated snapshot", () => {
  const bundle = createProductionLaunchBundle();
  const complete = createProductionLaunchRevocationSnapshot({
    actions: ["suspend", "reinstate", "revoke"],
    bundle,
  });
  const protectedHeadDigest = complete.headDigest;
  const truncated = structuredClone(complete);
  truncated.entries.pop();
  truncated.headDigest = truncated.entries.at(-1).entryDigest;
  resealProductionLaunchRevocationSnapshot(truncated);
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        truncated,
        {
          admissionBundleDigest: bundle.bundleDigest,
          headDigest: protectedHeadDigest,
          releaseDigest: bundle.evidence.releaseDigest,
        },
        productionLaunchNow,
      ),
    /protected checkpoint/u,
  );
});

test("exact schemas reject raw identities, tickets and provider resources", () => {
  const bundle = createProductionLaunchBundle();
  const rawApproval = createProductionLaunchRevocationSnapshot({
    actions: ["suspend"],
    bundle,
  });
  rawApproval.entries[0].approvals[0].email = "security@example.com";
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        rawApproval,
        expected(rawApproval, bundle),
        productionLaunchNow,
      ),
    /approval 1 fields are invalid/u,
  );

  const rawEntry = createProductionLaunchRevocationSnapshot({
    actions: ["emergency_stop"],
    bundle,
  });
  rawEntry.entries[0].incidentUrl = "https://pager.example/incidents/123";
  assert.throws(
    () =>
      evaluateInternalTokenProductionLaunchRevocation(
        rawEntry,
        expected(rawEntry, bundle),
        productionLaunchNow,
      ),
    /entry 1 fields are invalid/u,
  );
});
