import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  createInternalTokenProductionAttestationIssuerKeyDigest,
  createInternalTokenProductionAttestationSequenceCheckpointDigest,
  createInternalTokenProductionAttestationSignedReceiptPayload,
  createInternalTokenProductionAttestationTrustRegistryDigest,
} from "../../tooling/scripts/internal-token-production-attestation-issuer-identity.mjs";
import {
  createInternalTokenProductionControlAttestationDigest,
} from "../../tooling/scripts/internal-token-production-control-attestation.mjs";
import {
  controlAttestationDigest,
  controlAttestationNow,
  createProductionControlAttestationAssembly,
} from "./production-control-attestation-fixtures.mjs";

export const issuerIdentityNow = controlAttestationNow;

function publicJwk(publicKey) {
  const value = publicKey.export({ format: "jwk" });
  return {
    alg: "EdDSA",
    crv: value.crv,
    kty: value.kty,
    use: "sig",
    x: value.x,
  };
}

function principalBody(attestation, publicKeyJwk, index, assembly) {
  return {
    issuerClass: attestation.issuerClass,
    issuerDigest: attestation.issuerDigest,
    keyEpoch: 1,
    publicKeyJwk,
    schemaVersion: 1,
    status: "active",
    trustDomainDigest: controlAttestationDigest(
      `trust-domain-${attestation.controlId}-${attestation.issuerClass}-${index}`,
    ),
    validFrom: assembly.generatedAt - 300,
    validUntil: assembly.expiresAt + 300,
  };
}

function registryBody(principals, now) {
  return {
    environment: "production",
    expiresAt: now + 120,
    generatedAt: now - 20,
    principals,
    schemaVersion: 1,
  };
}

function checkpointBody(entries, now) {
  return {
    entries,
    environment: "production",
    expiresAt: now + 120,
    generatedAt: now - 20,
    schemaVersion: 1,
  };
}

function receiptBody(attestation, principal, registry, checkpoint, assembly, index) {
  return {
    attestation,
    issuedAt: assembly.generatedAt,
    issuerKeyDigest: principal.keyDigest,
    receiptNonceDigest: controlAttestationDigest(
      `signed-receipt-nonce-${attestation.issuerDigest}-${index}`,
    ),
    receiptSequence: 1,
    registryDigest: registry.registryDigest,
    schemaVersion: 1,
    sequenceCheckpointDigest: checkpoint.checkpointDigest,
  };
}

function signature(body, privateKey) {
  return sign(
    null,
    Buffer.from(
      createInternalTokenProductionAttestationSignedReceiptPayload(body),
      "utf8",
    ),
    privateKey,
  ).toString("base64url");
}

export function createProductionAttestationIssuerIdentityFixture({
  now = issuerIdentityNow,
} = {}) {
  const rawAssembly = createProductionControlAttestationAssembly({
    expiresAt: now + 240,
    generatedAt: now - 30,
  });
  const assembly = {
    environment: rawAssembly.environment,
    expiresAt: rawAssembly.expiresAt,
    generatedAt: rawAssembly.generatedAt,
    releaseDigest: rawAssembly.releaseDigest,
    schemaVersion: rawAssembly.schemaVersion,
  };
  const privateKeys = new Map();
  const principals = rawAssembly.attestations.map((attestation, index) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const body = principalBody(attestation, publicJwk(publicKey), index, assembly);
    const principal = {
      ...body,
      keyDigest:
        createInternalTokenProductionAttestationIssuerKeyDigest(body),
    };
    privateKeys.set(attestation.issuerDigest, privateKey);
    return principal;
  });
  const registryBase = registryBody(principals, now);
  const registry = {
    ...registryBase,
    registryDigest:
      createInternalTokenProductionAttestationTrustRegistryDigest(registryBase),
  };
  const checkpointBase = checkpointBody(
    rawAssembly.attestations.map((attestation) => ({
      issuerDigest: attestation.issuerDigest,
      nextSequence: 1,
    })),
    now,
  );
  const sequenceCheckpoint = {
    ...checkpointBase,
    checkpointDigest:
      createInternalTokenProductionAttestationSequenceCheckpointDigest(
        checkpointBase,
      ),
  };
  const receipts = rawAssembly.attestations.map((attestation, index) => {
    const principal = principals.find(
      (candidate) => candidate.issuerDigest === attestation.issuerDigest,
    );
    const body = receiptBody(
      attestation,
      principal,
      registry,
      sequenceCheckpoint,
      assembly,
      index,
    );
    return {
      ...body,
      signature: signature(body, privateKeys.get(attestation.issuerDigest)),
    };
  });
  return {
    expected: {
      registryDigest: registry.registryDigest,
      releaseDigest: assembly.releaseDigest,
      sequenceCheckpointDigest: sequenceCheckpoint.checkpointDigest,
    },
    input: {
      assembly,
      receipts,
      registry,
      sequenceCheckpoint,
    },
    privateKeys,
  };
}

export function resignProductionAttestationReceipt(fixture, index) {
  const receipt = fixture.input.receipts[index];
  const body = {
    attestation: receipt.attestation,
    issuedAt: receipt.issuedAt,
    issuerKeyDigest: receipt.issuerKeyDigest,
    receiptNonceDigest: receipt.receiptNonceDigest,
    receiptSequence: receipt.receiptSequence,
    registryDigest: receipt.registryDigest,
    schemaVersion: receipt.schemaVersion,
    sequenceCheckpointDigest: receipt.sequenceCheckpointDigest,
  };
  receipt.signature = signature(
    body,
    fixture.privateKeys.get(receipt.attestation.issuerDigest),
  );
  return receipt;
}

export function resealAndResignProductionAttestationReceipt(fixture, index) {
  const receipt = fixture.input.receipts[index];
  const attestation = receipt.attestation;
  attestation.attestationDigest =
    createInternalTokenProductionControlAttestationDigest({
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
    });
  return resignProductionAttestationReceipt(fixture, index);
}

export function resealProductionAttestationTrustRegistry(fixture) {
  const registry = fixture.input.registry;
  const body = {
    environment: registry.environment,
    expiresAt: registry.expiresAt,
    generatedAt: registry.generatedAt,
    principals: registry.principals,
    schemaVersion: registry.schemaVersion,
  };
  registry.registryDigest =
    createInternalTokenProductionAttestationTrustRegistryDigest(body);
  return registry;
}

export function resealProductionAttestationSequenceCheckpoint(fixture) {
  const checkpoint = fixture.input.sequenceCheckpoint;
  const body = {
    entries: checkpoint.entries,
    environment: checkpoint.environment,
    expiresAt: checkpoint.expiresAt,
    generatedAt: checkpoint.generatedAt,
    schemaVersion: checkpoint.schemaVersion,
  };
  checkpoint.checkpointDigest =
    createInternalTokenProductionAttestationSequenceCheckpointDigest(body);
  return checkpoint;
}
