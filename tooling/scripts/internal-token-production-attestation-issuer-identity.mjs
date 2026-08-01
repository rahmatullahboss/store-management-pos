import {
  createPublicKey,
  createHash,
  verify as verifySignature,
} from "node:crypto";
import {
  assembleInternalTokenProductionControlEvidence,
  createInternalTokenProductionControlAttestationDigest,
  INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_CRITICAL_CONTROLS,
} from "./internal-token-production-control-attestation.mjs";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAX_SNAPSHOT_LIFETIME_SECONDS = 5 * 60;
const MAX_RECEIPT_AGE_SECONDS = 5 * 60;
const PUBLIC_JWK_FIELDS = Object.freeze(["alg", "crv", "kty", "use", "x"]);

export const INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION = 1;

function fail(message) {
  throw new Error(`Internal-token production attestation issuer identity: ${message}`);
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

function normalizePublicJwk(input, name) {
  const value = exact(input, PUBLIC_JWK_FIELDS, name);
  if (
    value.kty !== "OKP" ||
    value.crv !== "Ed25519" ||
    value.alg !== "EdDSA" ||
    value.use !== "sig" ||
    typeof value.x !== "string" ||
    !DIGEST.test(value.x)
  ) {
    fail(`${name} is not an Ed25519 verification key`);
  }
  return Object.freeze({
    alg: "EdDSA",
    crv: "Ed25519",
    kty: "OKP",
    use: "sig",
    x: value.x,
  });
}

function normalizePrincipalBody(input, index = null) {
  const label = index === null ? "issuer principal body" : `issuer principal ${index + 1}`;
  const value = exact(
    input,
    [
      "issuerClass",
      "issuerDigest",
      "keyDigest",
      "keyEpoch",
      "publicKeyJwk",
      "schemaVersion",
      "status",
      "trustDomainDigest",
      "validFrom",
      "validUntil",
    ],
    label,
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION
  ) {
    fail(`${label} schema version is invalid`);
  }
  if (
    typeof value.issuerClass !== "string" ||
    !/^[a-z][a-z0-9-]{2,63}$/u.test(value.issuerClass)
  ) {
    fail(`${label} issuer class is invalid`);
  }
  if (!new Set(["active", "revoked", "suspended"]).has(value.status)) {
    fail(`${label} status is invalid`);
  }
  const validFrom = integer(value.validFrom, `${label} valid-from`, 1);
  const validUntil = integer(value.validUntil, `${label} valid-until`, 1);
  if (validUntil <= validFrom) fail(`${label} validity window is invalid`);
  const publicKeyJwk = normalizePublicJwk(value.publicKeyJwk, `${label} public key`);
  const body = Object.freeze({
    issuerClass: value.issuerClass,
    issuerDigest: digest(value.issuerDigest, `${label} issuer digest`),
    keyEpoch: integer(value.keyEpoch, `${label} key epoch`, 1),
    publicKeyJwk,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION,
    status: value.status,
    trustDomainDigest: digest(
      value.trustDomainDigest,
      `${label} trust-domain digest`,
    ),
    validFrom,
    validUntil,
  });
  const keyDigest = digest(value.keyDigest, `${label} key digest`);
  if (hash(body) !== keyDigest) fail(`${label} key digest does not match`);
  distinct(
    [body.issuerDigest, body.trustDomainDigest, keyDigest],
    `${label} digests`,
  );
  return Object.freeze({ ...body, keyDigest });
}

export function createInternalTokenProductionAttestationIssuerKeyDigest(input) {
  const value = exact(
    input,
    [
      "issuerClass",
      "issuerDigest",
      "keyEpoch",
      "publicKeyJwk",
      "schemaVersion",
      "status",
      "trustDomainDigest",
      "validFrom",
      "validUntil",
    ],
    "issuer principal key body",
  );
  const normalized = normalizePrincipalBody({
    ...value,
    keyDigest: hash({
      issuerClass: value.issuerClass,
      issuerDigest: value.issuerDigest,
      keyEpoch: value.keyEpoch,
      publicKeyJwk: normalizePublicJwk(value.publicKeyJwk, "issuer principal key body public key"),
      schemaVersion: value.schemaVersion,
      status: value.status,
      trustDomainDigest: value.trustDomainDigest,
      validFrom: value.validFrom,
      validUntil: value.validUntil,
    }),
  });
  return normalized.keyDigest;
}

function normalizeRegistryBody(input) {
  const value = exact(
    input,
    ["environment", "expiresAt", "generatedAt", "principals", "schemaVersion"],
    "issuer trust registry body",
  );
  if (
    value.schemaVersion !==
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION ||
    value.environment !== "production"
  ) {
    fail("issuer trust registry environment or schema version is invalid");
  }
  const generatedAt = integer(value.generatedAt, "issuer trust registry generated-at", 1);
  const expiresAt = integer(value.expiresAt, "issuer trust registry expiry", 1);
  if (
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > MAX_SNAPSHOT_LIFETIME_SECONDS
  ) {
    fail("issuer trust registry validity window is invalid");
  }
  if (!Array.isArray(value.principals) || value.principals.length === 0 || value.principals.length > 100) {
    fail("issuer trust registry principals are invalid");
  }
  const principals = value.principals
    .map((principal, index) => normalizePrincipalBody(principal, index))
    .sort((left, right) => left.issuerDigest.localeCompare(right.issuerDigest));
  distinct(principals.map((principal) => principal.issuerDigest), "issuer registry principals");
  distinct(principals.map((principal) => principal.keyDigest), "issuer registry keys");
  return Object.freeze({
    environment: "production",
    expiresAt,
    generatedAt,
    principals,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION,
  });
}

export function createInternalTokenProductionAttestationTrustRegistryDigest(input) {
  return hash(normalizeRegistryBody(input));
}

function normalizeRegistry(input, expectedDigest, now) {
  const value = exact(
    input,
    [
      "environment",
      "expiresAt",
      "generatedAt",
      "principals",
      "registryDigest",
      "schemaVersion",
    ],
    "issuer trust registry",
  );
  const body = normalizeRegistryBody({
    environment: value.environment,
    expiresAt: value.expiresAt,
    generatedAt: value.generatedAt,
    principals: value.principals,
    schemaVersion: value.schemaVersion,
  });
  const registryDigest = digest(value.registryDigest, "issuer trust registry digest");
  if (hash(body) !== registryDigest || registryDigest !== expectedDigest) {
    fail("issuer trust registry digest does not match the protected checkpoint");
  }
  if (body.generatedAt > now + 30 || now > body.expiresAt) {
    fail("issuer trust registry is stale or not yet valid");
  }
  return Object.freeze({ ...body, registryDigest });
}

function normalizeSequenceEntry(input, index) {
  const value = exact(
    input,
    ["issuerDigest", "nextSequence"],
    `issuer sequence checkpoint entry ${index + 1}`,
  );
  return Object.freeze({
    issuerDigest: digest(
      value.issuerDigest,
      `issuer sequence checkpoint entry ${index + 1} issuer digest`,
    ),
    nextSequence: integer(
      value.nextSequence,
      `issuer sequence checkpoint entry ${index + 1} next sequence`,
      1,
    ),
  });
}

function normalizeSequenceCheckpointBody(input) {
  const value = exact(
    input,
    ["entries", "environment", "expiresAt", "generatedAt", "schemaVersion"],
    "issuer sequence checkpoint body",
  );
  if (
    value.schemaVersion !==
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION ||
    value.environment !== "production"
  ) {
    fail("issuer sequence checkpoint environment or schema version is invalid");
  }
  const generatedAt = integer(value.generatedAt, "issuer sequence checkpoint generated-at", 1);
  const expiresAt = integer(value.expiresAt, "issuer sequence checkpoint expiry", 1);
  if (
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > MAX_SNAPSHOT_LIFETIME_SECONDS
  ) {
    fail("issuer sequence checkpoint validity window is invalid");
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > 100) {
    fail("issuer sequence checkpoint entries are invalid");
  }
  const entries = value.entries
    .map((entry, index) => normalizeSequenceEntry(entry, index))
    .sort((left, right) => left.issuerDigest.localeCompare(right.issuerDigest));
  distinct(entries.map((entry) => entry.issuerDigest), "issuer sequence checkpoint issuers");
  return Object.freeze({
    entries,
    environment: "production",
    expiresAt,
    generatedAt,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION,
  });
}

export function createInternalTokenProductionAttestationSequenceCheckpointDigest(input) {
  return hash(normalizeSequenceCheckpointBody(input));
}

function normalizeSequenceCheckpoint(input, expectedDigest, now) {
  const value = exact(
    input,
    [
      "checkpointDigest",
      "entries",
      "environment",
      "expiresAt",
      "generatedAt",
      "schemaVersion",
    ],
    "issuer sequence checkpoint",
  );
  const body = normalizeSequenceCheckpointBody({
    entries: value.entries,
    environment: value.environment,
    expiresAt: value.expiresAt,
    generatedAt: value.generatedAt,
    schemaVersion: value.schemaVersion,
  });
  const checkpointDigest = digest(
    value.checkpointDigest,
    "issuer sequence checkpoint digest",
  );
  if (hash(body) !== checkpointDigest || checkpointDigest !== expectedDigest) {
    fail("issuer sequence checkpoint digest does not match the protected checkpoint");
  }
  if (body.generatedAt > now + 30 || now > body.expiresAt) {
    fail("issuer sequence checkpoint is stale or not yet valid");
  }
  return Object.freeze({ ...body, checkpointDigest });
}

function normalizeReceiptBody(input) {
  const value = exact(
    input,
    [
      "attestation",
      "issuedAt",
      "issuerKeyDigest",
      "receiptNonceDigest",
      "receiptSequence",
      "registryDigest",
      "schemaVersion",
      "sequenceCheckpointDigest",
    ],
    "signed attestation receipt body",
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION
  ) {
    fail("signed attestation receipt schema version is invalid");
  }
  if (!value.attestation || typeof value.attestation !== "object" || Array.isArray(value.attestation)) {
    fail("signed attestation receipt attestation is invalid");
  }
  return Object.freeze({
    attestation: value.attestation,
    issuedAt: integer(value.issuedAt, "signed attestation receipt issued-at", 1),
    issuerKeyDigest: digest(
      value.issuerKeyDigest,
      "signed attestation receipt issuer-key digest",
    ),
    receiptNonceDigest: digest(
      value.receiptNonceDigest,
      "signed attestation receipt nonce digest",
    ),
    receiptSequence: integer(
      value.receiptSequence,
      "signed attestation receipt sequence",
      1,
    ),
    registryDigest: digest(
      value.registryDigest,
      "signed attestation receipt registry digest",
    ),
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION,
    sequenceCheckpointDigest: digest(
      value.sequenceCheckpointDigest,
      "signed attestation receipt sequence-checkpoint digest",
    ),
  });
}

export function createInternalTokenProductionAttestationSignedReceiptPayload(input) {
  return canonical(normalizeReceiptBody(input));
}

function verifyReceipt(input, context, index) {
  const value = exact(
    input,
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
    `signed attestation receipt ${index + 1}`,
  );
  const body = normalizeReceiptBody({
    attestation: value.attestation,
    issuedAt: value.issuedAt,
    issuerKeyDigest: value.issuerKeyDigest,
    receiptNonceDigest: value.receiptNonceDigest,
    receiptSequence: value.receiptSequence,
    registryDigest: value.registryDigest,
    schemaVersion: value.schemaVersion,
    sequenceCheckpointDigest: value.sequenceCheckpointDigest,
  });
  const attestation = exact(
    body.attestation,
    [
      "attestationDigest",
      "controlId",
      "environment",
      "expiresAt",
      "issuerClass",
      "issuerDigest",
      "observedAt",
      "providerClass",
      "releaseDigest",
      "schemaVersion",
      "sourceDigest",
      "status",
    ],
    `signed attestation receipt ${index + 1} attestation`,
  );
  const expectedAttestationDigest = createInternalTokenProductionControlAttestationDigest({
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
  if (attestation.attestationDigest !== expectedAttestationDigest) {
    fail(`signed attestation receipt ${index + 1} attestation digest does not match`);
  }
  if (
    body.registryDigest !== context.registry.registryDigest ||
    body.sequenceCheckpointDigest !== context.sequenceCheckpoint.checkpointDigest ||
    attestation.releaseDigest !== context.releaseDigest
  ) {
    fail(`signed attestation receipt ${index + 1} protected binding is invalid`);
  }
  if (
    body.issuedAt < attestation.observedAt ||
    body.issuedAt > context.generatedAt ||
    context.generatedAt - body.issuedAt > MAX_RECEIPT_AGE_SECONDS
  ) {
    fail(`signed attestation receipt ${index + 1} is stale or future-dated`);
  }
  const principal = context.principals.get(attestation.issuerDigest);
  if (!principal || principal.issuerClass !== attestation.issuerClass) {
    fail(`signed attestation receipt ${index + 1} issuer is not trusted`);
  }
  if (
    principal.status !== "active" ||
    body.issuedAt < principal.validFrom ||
    body.issuedAt > principal.validUntil ||
    body.issuerKeyDigest !== principal.keyDigest
  ) {
    fail(`signed attestation receipt ${index + 1} issuer key is not active`);
  }
  const checkpoint = context.sequences.get(attestation.issuerDigest);
  if (!checkpoint || body.receiptSequence !== checkpoint.nextSequence) {
    fail(`signed attestation receipt ${index + 1} sequence does not match the protected checkpoint`);
  }
  if (typeof value.signature !== "string" || !ED25519_SIGNATURE.test(value.signature)) {
    fail(`signed attestation receipt ${index + 1} signature is invalid`);
  }
  let publicKey;
  try {
    publicKey = createPublicKey({ key: principal.publicKeyJwk, format: "jwk" });
  } catch {
    fail(`signed attestation receipt ${index + 1} public key is invalid`);
  }
  const verified = verifySignature(
    null,
    Buffer.from(canonical(body), "utf8"),
    publicKey,
    Buffer.from(value.signature, "base64url"),
  );
  if (!verified) fail(`signed attestation receipt ${index + 1} signature did not verify`);
  return Object.freeze({ attestation, body, principal });
}

function nextSequenceCheckpoint(sequenceCheckpoint, receipts, generatedAt, expiresAt) {
  const increments = new Map(
    receipts.map((receipt) => [
      receipt.attestation.issuerDigest,
      receipt.body.receiptSequence + 1,
    ]),
  );
  const body = {
    entries: sequenceCheckpoint.entries.map((entry) => ({
      issuerDigest: entry.issuerDigest,
      nextSequence: increments.get(entry.issuerDigest) ?? entry.nextSequence,
    })),
    environment: "production",
    expiresAt,
    generatedAt,
    schemaVersion:
      INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION,
  };
  return Object.freeze({
    ...body,
    checkpointDigest:
      createInternalTokenProductionAttestationSequenceCheckpointDigest(body),
  });
}

export function verifyAndAssembleInternalTokenProductionSignedControlEvidence(
  input,
  expectedInput,
  nowInput,
) {
  const now = integer(nowInput, "signed attestation verification clock", 1);
  const expected = exact(
    expectedInput,
    ["registryDigest", "releaseDigest", "sequenceCheckpointDigest"],
    "expected signed attestation checkpoints",
  );
  const expectedRegistryDigest = digest(expected.registryDigest, "expected registry digest");
  const expectedReleaseDigest = digest(expected.releaseDigest, "expected release digest");
  const expectedSequenceCheckpointDigest = digest(
    expected.sequenceCheckpointDigest,
    "expected sequence-checkpoint digest",
  );
  const value = exact(
    input,
    [
      "assembly",
      "receipts",
      "registry",
      "sequenceCheckpoint",
    ],
    "signed control evidence input",
  );
  if (!value.assembly || typeof value.assembly !== "object" || Array.isArray(value.assembly)) {
    fail("signed control evidence assembly is invalid");
  }
  const releaseDigest = digest(
    value.assembly.releaseDigest,
    "signed control evidence release digest",
  );
  if (releaseDigest !== expectedReleaseDigest) {
    fail("signed control evidence release does not match the protected checkpoint");
  }
  const registry = normalizeRegistry(value.registry, expectedRegistryDigest, now);
  const sequenceCheckpoint = normalizeSequenceCheckpoint(
    value.sequenceCheckpoint,
    expectedSequenceCheckpointDigest,
    now,
  );
  if (!Array.isArray(value.receipts) || value.receipts.length === 0 || value.receipts.length > 100) {
    fail("signed attestation receipts are invalid");
  }
  if (
    registry.principals.length !== value.receipts.length ||
    sequenceCheckpoint.entries.length !== value.receipts.length
  ) {
    fail("issuer registry, sequence checkpoint and receipt coverage are inconsistent");
  }
  const principals = new Map(
    registry.principals.map((principal) => [principal.issuerDigest, principal]),
  );
  const sequences = new Map(
    sequenceCheckpoint.entries.map((entry) => [entry.issuerDigest, entry]),
  );
  const generatedAt = integer(
    value.assembly.generatedAt,
    "signed control evidence generated-at",
    1,
  );
  const receipts = value.receipts.map((receipt, index) =>
    verifyReceipt(
      receipt,
      {
        generatedAt,
        principals,
        registry,
        releaseDigest,
        sequenceCheckpoint,
        sequences,
      },
      index,
    ),
  );
  distinct(
    receipts.map((receipt) => receipt.attestation.issuerDigest),
    "signed receipt issuers",
  );
  distinct(
    receipts.map((receipt) => receipt.body.receiptNonceDigest),
    "signed receipt nonces",
  );
  for (const controlId of INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_CRITICAL_CONTROLS) {
    const controlReceipts = receipts.filter(
      (receipt) => receipt.attestation.controlId === controlId,
    );
    if (
      controlReceipts.length !== 2 ||
      new Set(controlReceipts.map((receipt) => receipt.principal.trustDomainDigest)).size !== 2
    ) {
      fail(`critical control ${controlId} does not have independent trust domains`);
    }
  }
  const assembled = assembleInternalTokenProductionControlEvidence(
    {
      ...value.assembly,
      attestations: receipts.map((receipt) => receipt.attestation),
    },
    now,
  );
  const checkpoint = nextSequenceCheckpoint(
    sequenceCheckpoint,
    receipts,
    generatedAt,
    value.assembly.expiresAt,
  );
  return Object.freeze({
    evidence: assembled.evidence,
    nextSequenceCheckpoint: checkpoint,
    summary: Object.freeze({
      activeIssuerCount: receipts.length,
      attestationCount: assembled.summary.attestationCount,
      controlCount: assembled.summary.controlCount,
      criticalControlCount: assembled.summary.criticalControlCount,
      dualSourceControlCount: assembled.summary.dualSourceControlCount,
      environment: "production",
      evidenceDigestsIncluded: false,
      expiresAt: assembled.summary.expiresAt,
      identifiersIncluded: false,
      issuerKeyDigestsIncluded: false,
      launchApprovalIncluded: false,
      receiptNonceDigestsIncluded: false,
      releaseDigestIncluded: false,
      replayCheckpointAdvanced: true,
      schemaVersion:
        INTERNAL_TOKEN_PRODUCTION_ATTESTATION_ISSUER_IDENTITY_SCHEMA_VERSION,
      signedReceiptCount: receipts.length,
      status: "verified_and_assembled",
      trustRegistryDigestIncluded: false,
    }),
  });
}
