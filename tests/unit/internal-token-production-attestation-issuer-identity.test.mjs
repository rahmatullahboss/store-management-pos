import assert from "node:assert/strict";
import test from "node:test";
import {
  createInternalTokenProductionAttestationIssuerKeyDigest,
  createInternalTokenProductionAttestationSequenceCheckpointDigest,
  createInternalTokenProductionAttestationTrustRegistryDigest,
  verifyAndAssembleInternalTokenProductionSignedControlEvidence,
} from "../../tooling/scripts/internal-token-production-attestation-issuer-identity.mjs";
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
  resealAndResignProductionAttestationReceipt,
} from "../helpers/production-attestation-issuer-identity-fixtures.mjs";
import {
  createProductionLaunchRevocationSnapshot,
} from "../helpers/production-launch-governance-fixtures.mjs";

function principalBody(principal) {
  return {
    issuerClass: principal.issuerClass,
    issuerDigest: principal.issuerDigest,
    keyEpoch: principal.keyEpoch,
    publicKeyJwk: principal.publicKeyJwk,
    schemaVersion: principal.schemaVersion,
    status: principal.status,
    trustDomainDigest: principal.trustDomainDigest,
    validFrom: principal.validFrom,
    validUntil: principal.validUntil,
  };
}

function registryBody(registry) {
  return {
    environment: registry.environment,
    expiresAt: registry.expiresAt,
    generatedAt: registry.generatedAt,
    principals: registry.principals,
    schemaVersion: registry.schemaVersion,
  };
}

function checkpointBody(checkpoint) {
  return {
    entries: checkpoint.entries,
    environment: checkpoint.environment,
    expiresAt: checkpoint.expiresAt,
    generatedAt: checkpoint.generatedAt,
    schemaVersion: checkpoint.schemaVersion,
  };
}

function rebindRegistry(fixture) {
  for (const principal of fixture.input.registry.principals) {
    principal.keyDigest =
      createInternalTokenProductionAttestationIssuerKeyDigest(
        principalBody(principal),
      );
  }
  fixture.input.registry.registryDigest =
    createInternalTokenProductionAttestationTrustRegistryDigest(
      registryBody(fixture.input.registry),
    );
  fixture.expected.registryDigest = fixture.input.registry.registryDigest;
  for (const [index, receipt] of fixture.input.receipts.entries()) {
    const principal = fixture.input.registry.principals.find(
      (candidate) =>
        candidate.issuerDigest === receipt.attestation.issuerDigest,
    );
    receipt.registryDigest = fixture.input.registry.registryDigest;
    if (principal) receipt.issuerKeyDigest = principal.keyDigest;
    resignProductionAttestationReceipt(fixture, index);
  }
}

function rebindCheckpoint(fixture) {
  fixture.input.sequenceCheckpoint.checkpointDigest =
    createInternalTokenProductionAttestationSequenceCheckpointDigest(
      checkpointBody(fixture.input.sequenceCheckpoint),
    );
  fixture.expected.sequenceCheckpointDigest =
    fixture.input.sequenceCheckpoint.checkpointDigest;
  for (const [index, receipt] of fixture.input.receipts.entries()) {
    receipt.sequenceCheckpointDigest =
      fixture.input.sequenceCheckpoint.checkpointDigest;
    resignProductionAttestationReceipt(fixture, index);
  }
}

function verifyFixture(fixture) {
  return verifyAndAssembleInternalTokenProductionSignedControlEvidence(
    fixture.input,
    fixture.expected,
    issuerIdentityNow,
  );
}

function assertAggregateOnly(summary) {
  for (const key of [
    "issuerDigest",
    "issuerKeyDigest",
    "receiptNonceDigest",
    "registryDigest",
    "releaseDigest",
    "sequenceCheckpointDigest",
    "signature",
    "sourceDigest",
    "trustDomainDigest",
  ]) {
    assert.equal(Object.hasOwn(summary, key), false);
  }
}

test("thirteen Ed25519 receipts verify and assemble deterministic launch evidence", () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const result = verifyFixture(fixture);
  assert.deepEqual(result.summary, {
    activeIssuerCount: 13,
    attestationCount: 13,
    controlCount: 10,
    criticalControlCount: 3,
    dualSourceControlCount: 3,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: issuerIdentityNow + 240,
    identifiersIncluded: false,
    issuerKeyDigestsIncluded: false,
    launchApprovalIncluded: false,
    receiptNonceDigestsIncluded: false,
    releaseDigestIncluded: false,
    replayCheckpointAdvanced: true,
    schemaVersion: 1,
    signedReceiptCount: 13,
    status: "verified_and_assembled",
    trustRegistryDigestIncluded: false,
  });
  assert.equal(result.evidence.controls.length, 10);
  assert.equal(result.nextSequenceCheckpoint.entries.length, 13);
  assert.equal(
    result.nextSequenceCheckpoint.entries.every(
      (entry) => entry.nextSequence === 2,
    ),
    true,
  );
  assertAggregateOnly(result.summary);
});

test("input ordering does not change signed assembled evidence", () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const first = verifyFixture(fixture);
  fixture.input.receipts.reverse();
  fixture.input.registry.principals.reverse();
  fixture.input.sequenceCheckpoint.entries.reverse();
  const second = verifyFixture(fixture);
  assert.deepEqual(first.evidence, second.evidence);
  assert.deepEqual(first.summary, second.summary);
});

test("signed evidence completes admission and clear revocation end to end", () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const verified = verifyFixture(fixture);
  const bundle = createProductionLaunchBundleFromEvidence(verified.evidence);
  const admission = evaluateInternalTokenProductionLaunchAdmission(
    bundle,
    issuerIdentityNow,
  );
  assert.equal(admission.launchGate, "clear");
  assert.equal(admission.status, "admitted");

  const revocation = createProductionLaunchRevocationSnapshot({
    bundle,
    expiresAt: issuerIdentityNow + 120,
    generatedAt: issuerIdentityNow - 5,
  });
  const result = evaluateInternalTokenProductionLaunchRevocation(
    revocation,
    {
      admissionBundleDigest: bundle.bundleDigest,
      headDigest: revocation.headDigest,
      releaseDigest: verified.evidence.releaseDigest,
    },
    issuerIdentityNow,
  );
  assert.equal(result.launchGate, "clear");
  assert.equal(result.revocationState, "clear");
});

test("signature tampering and unknown issuers fail closed", () => {
  const tampered = createProductionAttestationIssuerIdentityFixture();
  tampered.input.receipts[0].signature =
    `${tampered.input.receipts[0].signature.slice(0, -1)}A`;
  assert.throws(() => verifyFixture(tampered), /signature did not verify/u);

  const unknown = createProductionAttestationIssuerIdentityFixture();
  unknown.input.receipts[0].attestation.issuerDigest =
    controlAttestationDigest("unknown-signed-issuer");
  resealAndResignProductionAttestationReceipt(unknown, 0);
  assert.throws(() => verifyFixture(unknown), /issuer is not trusted/u);
});

test("revoked keys, wrong key binding and private or confused JWKs fail closed", () => {
  const revoked = createProductionAttestationIssuerIdentityFixture();
  revoked.input.registry.principals[0].status = "revoked";
  rebindRegistry(revoked);
  assert.throws(() => verifyFixture(revoked), /issuer key is not active/u);

  const wrongKey = createProductionAttestationIssuerIdentityFixture();
  wrongKey.input.receipts[0].issuerKeyDigest =
    controlAttestationDigest("wrong-issuer-key");
  resignProductionAttestationReceipt(wrongKey, 0);
  assert.throws(() => verifyFixture(wrongKey), /issuer key is not active/u);

  const privateJwk = createProductionAttestationIssuerIdentityFixture();
  privateJwk.input.registry.principals[0].publicKeyJwk.d =
    controlAttestationDigest("prohibited-private-jwk");
  assert.throws(() => verifyFixture(privateJwk), /public key fields are invalid/u);

  const confused = createProductionAttestationIssuerIdentityFixture();
  confused.input.registry.principals[0].publicKeyJwk = {
    alg: "RS256",
    crv: "Ed25519",
    kty: "RSA",
    use: "sig",
    x: controlAttestationDigest("not-an-ed25519-key"),
  };
  assert.throws(() => verifyFixture(confused), /not an Ed25519 verification key/u);
});

test("critical dual sources cannot share a trust domain", () => {
  const fixture = createProductionAttestationIssuerIdentityFixture();
  const receipts = fixture.input.receipts.filter(
    (receipt) =>
      receipt.attestation.controlId === "kms_non_exportable_signing",
  );
  const principals = receipts.map((receipt) =>
    fixture.input.registry.principals.find(
      (principal) =>
        principal.issuerDigest === receipt.attestation.issuerDigest,
    ),
  );
  principals[1].trustDomainDigest = principals[0].trustDomainDigest;
  rebindRegistry(fixture);
  assert.throws(
    () => verifyFixture(fixture),
    /does not have independent trust domains/u,
  );
});

test("nonce duplication, sequence mismatch and consumed-checkpoint replay fail closed", () => {
  const duplicateNonce = createProductionAttestationIssuerIdentityFixture();
  duplicateNonce.input.receipts[1].receiptNonceDigest =
    duplicateNonce.input.receipts[0].receiptNonceDigest;
  resignProductionAttestationReceipt(duplicateNonce, 1);
  assert.throws(() => verifyFixture(duplicateNonce), /nonces must be distinct/u);

  const wrongSequence = createProductionAttestationIssuerIdentityFixture();
  wrongSequence.input.receipts[0].receiptSequence = 2;
  resignProductionAttestationReceipt(wrongSequence, 0);
  assert.throws(
    () => verifyFixture(wrongSequence),
    /sequence does not match the protected checkpoint/u,
  );

  const replay = createProductionAttestationIssuerIdentityFixture();
  const first = verifyFixture(replay);
  replay.input.sequenceCheckpoint = structuredClone(
    first.nextSequenceCheckpoint,
  );
  replay.expected.sequenceCheckpointDigest =
    first.nextSequenceCheckpoint.checkpointDigest;
  assert.throws(
    () => verifyFixture(replay),
    /protected binding is invalid|sequence does not match/u,
  );
});

test("protected registry and checkpoint digests, freshness and release binding fail closed", () => {
  const wrongRegistry = createProductionAttestationIssuerIdentityFixture();
  wrongRegistry.expected.registryDigest =
    controlAttestationDigest("wrong-registry-checkpoint");
  assert.throws(
    () => verifyFixture(wrongRegistry),
    /registry digest does not match the protected checkpoint/u,
  );

  const wrongCheckpoint = createProductionAttestationIssuerIdentityFixture();
  wrongCheckpoint.expected.sequenceCheckpointDigest =
    controlAttestationDigest("wrong-sequence-checkpoint");
  assert.throws(
    () => verifyFixture(wrongCheckpoint),
    /sequence checkpoint digest does not match the protected checkpoint/u,
  );

  const staleRegistry = createProductionAttestationIssuerIdentityFixture();
  staleRegistry.input.registry.generatedAt = issuerIdentityNow - 301;
  staleRegistry.input.registry.expiresAt = issuerIdentityNow - 1;
  rebindRegistry(staleRegistry);
  assert.throws(() => verifyFixture(staleRegistry), /registry is stale/u);

  const staleCheckpoint = createProductionAttestationIssuerIdentityFixture();
  staleCheckpoint.input.sequenceCheckpoint.generatedAt = issuerIdentityNow - 301;
  staleCheckpoint.input.sequenceCheckpoint.expiresAt = issuerIdentityNow - 1;
  rebindCheckpoint(staleCheckpoint);
  assert.throws(() => verifyFixture(staleCheckpoint), /checkpoint is stale/u);

  const crossRelease = createProductionAttestationIssuerIdentityFixture();
  crossRelease.input.assembly.releaseDigest =
    controlAttestationDigest("cross-release-assembly");
  crossRelease.expected.releaseDigest = crossRelease.input.assembly.releaseDigest;
  assert.throws(() => verifyFixture(crossRelease), /protected binding is invalid/u);
});

test("exact schemas reject raw issuer identity, certificate and provider resource fields", () => {
  const rawPrincipal = createProductionAttestationIssuerIdentityFixture();
  rawPrincipal.input.registry.principals[0].issuerEmail =
    "security-owner@example.com";
  assert.throws(() => verifyFixture(rawPrincipal), /principal 1 fields are invalid/u);

  const rawCertificate = createProductionAttestationIssuerIdentityFixture();
  rawCertificate.input.registry.principals[0].certificatePem =
    "-----BEGIN CERTIFICATE-----";
  assert.throws(() => verifyFixture(rawCertificate), /principal 1 fields are invalid/u);

  const rawReceipt = createProductionAttestationIssuerIdentityFixture();
  rawReceipt.input.receipts[0].providerResource =
    "projects/prod/locations/global/keyRings/issuer";
  assert.throws(() => verifyFixture(rawReceipt), /receipt 1 fields are invalid/u);
});
