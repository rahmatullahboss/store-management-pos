import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleInternalTokenProductionControlEvidence,
  createInternalTokenProductionControlAttestationDigest,
} from "../../tooling/scripts/internal-token-production-control-attestation.mjs";
import {
  evaluateInternalTokenProductionLaunchAdmission,
} from "../../tooling/scripts/internal-token-production-launch-admission.mjs";
import {
  evaluateInternalTokenProductionLaunchRevocation,
} from "../../tooling/scripts/internal-token-production-launch-revocation.mjs";
import {
  controlAttestationDigest,
  controlAttestationNow,
  createProductionControlAttestationAssembly,
  createProductionLaunchBundleFromEvidence,
} from "../helpers/production-control-attestation-fixtures.mjs";
import {
  createProductionLaunchRevocationSnapshot,
} from "../helpers/production-launch-governance-fixtures.mjs";

function resealAttestation(attestation) {
  const body = {
    controlId: attestation.controlId,
    environment: attestation.environment,
    expiresAt: attestation.expiresAt,
    issuerClass: attestation.issuerClass,
    issuerDigest: attestation.issuerDigest,
    observedAt: attestation.observedAt,
    providerClass: attestation.providerClass,
    releaseDigest: attestation.releaseDigest,
    schemaVersion: attestation.schemaVersion,
    sourceDigest: attestation.sourceDigest,
    status: attestation.status,
  };
  attestation.attestationDigest =
    createInternalTokenProductionControlAttestationDigest(body);
  return attestation;
}

function assemble(input = createProductionControlAttestationAssembly()) {
  return assembleInternalTokenProductionControlEvidence(
    input,
    controlAttestationNow,
  );
}

function assertAggregateOnly(summary) {
  for (const key of [
    "attestationDigest",
    "evidenceDigest",
    "issuerDigest",
    "releaseDigest",
    "sourceDigest",
  ]) {
    assert.equal(Object.hasOwn(summary, key), false);
  }
}

test("thirteen attestations deterministically assemble all ten launch controls", () => {
  const input = createProductionControlAttestationAssembly();
  const first = assemble(input);
  const shuffled = structuredClone(input);
  shuffled.attestations.reverse();
  const second = assemble(shuffled);

  assert.deepEqual(first.evidence, second.evidence);
  assert.deepEqual(first.summary, {
    attestationCount: 13,
    controlCount: 10,
    criticalControlCount: 3,
    dualSourceControlCount: 3,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: controlAttestationNow + 600,
    identifiersIncluded: false,
    launchApprovalIncluded: false,
    releaseDigestIncluded: false,
    schemaVersion: 1,
    status: "assembled",
  });
  assert.equal(first.evidence.controls.length, 10);
  assert.equal(
    new Set(first.evidence.controls.map((control) => control.evidenceDigest)).size,
    10,
  );
  assertAggregateOnly(first.summary);
});

test("assembled evidence is accepted by launch admission and a clear revocation checkpoint", () => {
  const { evidence } = assemble();
  const bundle = createProductionLaunchBundleFromEvidence(evidence);
  const admission = evaluateInternalTokenProductionLaunchAdmission(
    bundle,
    controlAttestationNow,
  );
  assert.equal(admission.status, "admitted");
  assert.equal(admission.launchGate, "clear");
  assert.equal(admission.controlCount, 10);
  assert.equal(admission.approvalCount, 3);

  const revocation = createProductionLaunchRevocationSnapshot({
    bundle,
    expiresAt: controlAttestationNow + 120,
    generatedAt: controlAttestationNow - 5,
  });
  const revocationResult = evaluateInternalTokenProductionLaunchRevocation(
    revocation,
    {
      admissionBundleDigest: bundle.bundleDigest,
      headDigest: revocation.headDigest,
      releaseDigest: evidence.releaseDigest,
    },
    controlAttestationNow,
  );
  assert.equal(revocationResult.revocationState, "clear");
  assert.equal(revocationResult.launchGate, "clear");
});

test("every critical control requires both exact independent issuer classes", () => {
  const missing = createProductionControlAttestationAssembly();
  missing.attestations = missing.attestations.filter(
    (attestation) =>
      !(
        attestation.controlId === "kms_non_exportable_signing" &&
        attestation.issuerClass === "independent-key-policy-verifier"
      ),
  );
  assert.throws(
    () => assemble(missing),
    /does not contain every required attestation/u,
  );

  const wrongIssuer = createProductionControlAttestationAssembly();
  const target = wrongIssuer.attestations.find(
    (attestation) =>
      attestation.controlId === "production_monitoring_paging" &&
      attestation.issuerClass === "independent-alert-delivery-verifier",
  );
  target.issuerClass = "monitoring-provider-control-plane";
  target.issuerDigest = controlAttestationDigest("different-monitoring-issuer");
  resealAttestation(target);
  assert.throws(
    () => assemble(wrongIssuer),
    /issuer coverage is incomplete|issuer class is invalid/u,
  );
});

test("issuer and source independence is enforced globally", () => {
  const duplicateSource = createProductionControlAttestationAssembly();
  duplicateSource.attestations[1].sourceDigest =
    duplicateSource.attestations[0].sourceDigest;
  resealAttestation(duplicateSource.attestations[1]);
  assert.throws(
    () => assemble(duplicateSource),
    /control attestation sources must be distinct/u,
  );

  const duplicateIssuer = createProductionControlAttestationAssembly();
  duplicateIssuer.attestations[1].issuerDigest =
    duplicateIssuer.attestations[0].issuerDigest;
  resealAttestation(duplicateIssuer.attestations[1]);
  assert.throws(
    () => assemble(duplicateIssuer),
    /control attestation issuers must be distinct/u,
  );
});

test("provider mismatch and unsupported provider classes fail closed", () => {
  const inconsistent = createProductionControlAttestationAssembly();
  const backup = inconsistent.attestations.filter(
    (attestation) => attestation.controlId === "database_backup_recovery",
  );
  backup[1].providerClass = "verified-external-backup";
  resealAttestation(backup[1]);
  assert.throws(
    () => assemble(inconsistent),
    /provider binding is inconsistent/u,
  );

  const unsupported = createProductionControlAttestationAssembly();
  unsupported.attestations[0].providerClass = "self-declared-backup";
  assert.throws(
    () => assemble(unsupported),
    /provider class is invalid/u,
  );
});

test("stale, future, expired and cross-release attestations fail closed", () => {
  const stale = createProductionControlAttestationAssembly();
  stale.attestations[0].observedAt = controlAttestationNow - 901;
  resealAttestation(stale.attestations[0]);
  assert.throws(() => assemble(stale), /stale or not bound/u);

  const future = createProductionControlAttestationAssembly();
  future.attestations[0].observedAt = controlAttestationNow + 1;
  resealAttestation(future.attestations[0]);
  assert.throws(() => assemble(future), /stale or not bound/u);

  const shortExpiry = createProductionControlAttestationAssembly();
  shortExpiry.attestations[0].expiresAt = controlAttestationNow + 599;
  resealAttestation(shortExpiry.attestations[0]);
  assert.throws(() => assemble(shortExpiry), /stale or not bound/u);

  const otherRelease = createProductionControlAttestationAssembly();
  otherRelease.attestations[0].releaseDigest =
    controlAttestationDigest("other-release");
  resealAttestation(otherRelease.attestations[0]);
  assert.throws(() => assemble(otherRelease), /stale or not bound/u);
});

test("tampered digests and missing controls fail closed", () => {
  const tampered = createProductionControlAttestationAssembly();
  tampered.attestations[0].sourceDigest =
    controlAttestationDigest("tampered-source");
  assert.throws(() => assemble(tampered), /digest does not match/u);

  const duplicate = createProductionControlAttestationAssembly();
  duplicate.attestations[0] = structuredClone(duplicate.attestations[1]);
  assert.throws(
    () => assemble(duplicate),
    /invalid attestation count|attestation digests must be distinct/u,
  );
});

test("exact schemas prohibit raw identities, resource names and URLs", () => {
  const rawIssuer = createProductionControlAttestationAssembly();
  rawIssuer.attestations[0].issuerEmail = "operator@example.com";
  assert.throws(() => assemble(rawIssuer), /fields are invalid/u);

  const rawResource = createProductionControlAttestationAssembly();
  rawResource.attestations[0].resourceName =
    "projects/prod/keyRings/internal/cryptoKeys/signing";
  assert.throws(() => assemble(rawResource), /fields are invalid/u);

  const rawUrl = createProductionControlAttestationAssembly();
  rawUrl.attestations[0].evidenceUrl = "https://provider.example/evidence/123";
  assert.throws(() => assemble(rawUrl), /fields are invalid/u);
});
