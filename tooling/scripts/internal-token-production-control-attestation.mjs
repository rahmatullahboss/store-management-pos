import { createHash } from "node:crypto";
import {
  createInternalTokenProductionLaunchEvidenceDigest,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS,
} from "./internal-token-production-launch-admission.mjs";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const MAX_ATTESTATION_AGE_SECONDS = 15 * 60;
const MAX_VALIDITY_SECONDS = 4 * 60 * 60;

const CONTROL_POLICY = Object.freeze({
  database_backup_recovery: Object.freeze({
    providerClasses: Object.freeze([
      "managed-postgres",
      "verified-external-backup",
    ]),
    issuerClasses: Object.freeze([
      "database-provider-control-plane",
      "independent-recovery-verifier",
    ]),
  }),
  evidence_archive_legal_hold: Object.freeze({
    providerClasses: Object.freeze([
      "object-lock-archive",
      "vault-archive",
      "offline-custodian",
    ]),
    issuerClasses: Object.freeze(["archive-provider-control-plane"]),
  }),
  incident_response_ownership: Object.freeze({
    providerClasses: Object.freeze(["documented-human-ownership"]),
    issuerClasses: Object.freeze(["governance-registry"]),
  }),
  kms_non_exportable_signing: Object.freeze({
    providerClasses: Object.freeze([
      "cloud-kms",
      "managed-hsm",
      "pkcs11-hsm",
    ]),
    issuerClasses: Object.freeze([
      "kms-provider-control-plane",
      "independent-key-policy-verifier",
    ]),
  }),
  production_monitoring_paging: Object.freeze({
    providerClasses: Object.freeze([
      "managed-observability",
      "self-hosted-observability",
    ]),
    issuerClasses: Object.freeze([
      "monitoring-provider-control-plane",
      "independent-alert-delivery-verifier",
    ]),
  }),
  protected_jwks_publication: Object.freeze({
    providerClasses: Object.freeze([
      "edge-protected-jwks",
      "origin-protected-jwks",
    ]),
    issuerClasses: Object.freeze(["edge-runtime-verifier"]),
  }),
  provider_audit_sink: Object.freeze({
    providerClasses: Object.freeze([
      "immutable-provider-audit",
      "immutable-security-lake",
    ]),
    issuerClasses: Object.freeze(["audit-sink-verifier"]),
  }),
  recovery_email_delivery: Object.freeze({
    providerClasses: Object.freeze(["transactional-email-provider"]),
    issuerClasses: Object.freeze(["email-provider-verifier"]),
  }),
  retention_disposition_ownership: Object.freeze({
    providerClasses: Object.freeze(["documented-human-ownership"]),
    issuerClasses: Object.freeze(["governance-registry"]),
  }),
  signing_workload_identity: Object.freeze({
    providerClasses: Object.freeze([
      "federated-workload-identity",
      "hardware-bound-service-identity",
    ]),
    issuerClasses: Object.freeze(["identity-provider-verifier"]),
  }),
});

export const INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_CRITICAL_CONTROLS =
  Object.freeze([
    "database_backup_recovery",
    "kms_non_exportable_signing",
    "production_monitoring_paging",
  ]);

function fail(message) {
  throw new Error(`Internal-token production control attestation: ${message}`);
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

function normalizeAttestationBody(input) {
  const value = exact(
    input,
    [
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
    "control attestation body",
  );
  if (
    value.schemaVersion !==
      INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_SCHEMA_VERSION ||
    value.environment !== "production" ||
    value.status !== "verified"
  ) {
    fail("control attestation environment, status or schema version is invalid");
  }
  if (
    typeof value.controlId !== "string" ||
    !Object.hasOwn(CONTROL_POLICY, value.controlId)
  ) {
    fail("control attestation control id is invalid");
  }
  const policy = CONTROL_POLICY[value.controlId];
  if (
    typeof value.providerClass !== "string" ||
    !policy.providerClasses.includes(value.providerClass)
  ) {
    fail("control attestation provider class is invalid");
  }
  if (
    typeof value.issuerClass !== "string" ||
    !policy.issuerClasses.includes(value.issuerClass)
  ) {
    fail("control attestation issuer class is invalid");
  }
  const observedAt = integer(value.observedAt, "control attestation observed-at", 1);
  const expiresAt = integer(value.expiresAt, "control attestation expiry", 1);
  if (expiresAt <= observedAt || expiresAt - observedAt > MAX_VALIDITY_SECONDS) {
    fail("control attestation validity window is invalid");
  }
  const body = Object.freeze({
    controlId: value.controlId,
    environment: "production",
    expiresAt,
    issuerClass: value.issuerClass,
    issuerDigest: digest(value.issuerDigest, "control attestation issuer digest"),
    observedAt,
    providerClass: value.providerClass,
    releaseDigest: digest(value.releaseDigest, "control attestation release digest"),
    schemaVersion: INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_SCHEMA_VERSION,
    sourceDigest: digest(value.sourceDigest, "control attestation source digest"),
    status: "verified",
  });
  distinct(
    [body.issuerDigest, body.releaseDigest, body.sourceDigest],
    "control attestation digests",
  );
  return body;
}

export function createInternalTokenProductionControlAttestationDigest(input) {
  return hash(normalizeAttestationBody(input));
}

function normalizeAttestation(input, assembly, index) {
  const value = exact(
    input,
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
    `control attestation ${index + 1}`,
  );
  const body = normalizeAttestationBody({
    controlId: value.controlId,
    environment: value.environment,
    expiresAt: value.expiresAt,
    issuerClass: value.issuerClass,
    issuerDigest: value.issuerDigest,
    observedAt: value.observedAt,
    providerClass: value.providerClass,
    releaseDigest: value.releaseDigest,
    schemaVersion: value.schemaVersion,
    sourceDigest: value.sourceDigest,
    status: value.status,
  });
  if (
    body.releaseDigest !== assembly.releaseDigest ||
    body.observedAt > assembly.generatedAt ||
    body.observedAt < assembly.generatedAt - MAX_ATTESTATION_AGE_SECONDS ||
    body.expiresAt < assembly.expiresAt
  ) {
    fail(`control attestation ${index + 1} is stale or not bound to the assembly`);
  }
  const attestationDigest = digest(
    value.attestationDigest,
    `control attestation ${index + 1} digest`,
  );
  if (hash(body) !== attestationDigest) {
    fail(`control attestation ${index + 1} digest does not match`);
  }
  distinct(
    [
      attestationDigest,
      body.issuerDigest,
      body.releaseDigest,
      body.sourceDigest,
    ],
    `control attestation ${index + 1} digests`,
  );
  return Object.freeze({ ...body, attestationDigest });
}

function orderControlAttestations(attestations, controlId) {
  const policy = CONTROL_POLICY[controlId];
  const selected = attestations.filter(
    (attestation) => attestation.controlId === controlId,
  );
  if (selected.length !== policy.issuerClasses.length) {
    fail(`control ${controlId} has an invalid attestation count`);
  }
  const byIssuerClass = new Map();
  for (const attestation of selected) {
    if (byIssuerClass.has(attestation.issuerClass)) {
      fail(`control ${controlId} issuer coverage is incomplete`);
    }
    byIssuerClass.set(attestation.issuerClass, attestation);
  }
  const ordered = policy.issuerClasses.map((issuerClass) =>
    byIssuerClass.get(issuerClass),
  );
  if (ordered.some((attestation) => attestation === undefined)) {
    fail(`control ${controlId} issuer coverage is incomplete`);
  }
  if (
    new Set(ordered.map((attestation) => attestation.providerClass)).size !== 1
  ) {
    fail(`control ${controlId} provider binding is inconsistent`);
  }
  return ordered;
}

function controlEvidenceDigest(control) {
  return hash({
    attestationDigests: control.attestations.map(
      (attestation) => attestation.attestationDigest,
    ),
    controlId: control.controlId,
    providerClass: control.providerClass,
    releaseDigest: control.releaseDigest,
    schemaVersion: INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_SCHEMA_VERSION,
    verifiedAt: control.verifiedAt,
  });
}

export function assembleInternalTokenProductionControlEvidence(input, nowInput) {
  const now = integer(nowInput, "control attestation clock", 1);
  const value = exact(
    input,
    [
      "attestations",
      "environment",
      "expiresAt",
      "generatedAt",
      "releaseDigest",
      "schemaVersion",
    ],
    "control evidence assembly",
  );
  if (
    value.schemaVersion !==
      INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_SCHEMA_VERSION ||
    value.environment !== "production"
  ) {
    fail("control evidence assembly environment or schema version is invalid");
  }
  const generatedAt = integer(value.generatedAt, "assembly generated-at", 1);
  const expiresAt = integer(value.expiresAt, "assembly expiry", 1);
  if (
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > MAX_VALIDITY_SECONDS ||
    generatedAt > now + 30 ||
    now > expiresAt
  ) {
    fail("control evidence assembly is stale or not yet valid");
  }
  const releaseDigest = digest(value.releaseDigest, "assembly release digest");
  if (!Array.isArray(value.attestations)) {
    fail("control attestations are invalid");
  }
  const expectedCount = Object.values(CONTROL_POLICY).reduce(
    (total, policy) => total + policy.issuerClasses.length,
    0,
  );
  if (value.attestations.length !== expectedCount) {
    fail("control evidence assembly does not contain every required attestation");
  }

  const assembly = { expiresAt, generatedAt, releaseDigest };
  const attestations = value.attestations.map((attestation, index) =>
    normalizeAttestation(attestation, assembly, index),
  );
  distinct(
    attestations.map((attestation) => attestation.attestationDigest),
    "control attestation digests",
  );
  distinct(
    attestations.map((attestation) => attestation.sourceDigest),
    "control attestation sources",
  );
  distinct(
    attestations.map((attestation) => attestation.issuerDigest),
    "control attestation issuers",
  );

  const controls = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS.map(
    (controlId) => {
      const ordered = orderControlAttestations(attestations, controlId);
      const verifiedAt = Math.min(
        ...ordered.map((attestation) => attestation.observedAt),
      );
      const normalized = {
        attestations: ordered,
        controlId,
        providerClass: ordered[0].providerClass,
        releaseDigest,
        verifiedAt,
      };
      return Object.freeze({
        controlId,
        evidenceDigest: controlEvidenceDigest(normalized),
        providerClass: normalized.providerClass,
        schemaVersion: 1,
        status: "verified",
        verifiedAt,
      });
    },
  );

  distinct(
    [
      releaseDigest,
      ...controls.map((control) => control.evidenceDigest),
      ...attestations.map((attestation) => attestation.attestationDigest),
    ],
    "assembled control evidence digests",
  );
  const evidenceBody = {
    controls,
    environment: "production",
    expiresAt,
    generatedAt,
    releaseDigest,
    schemaVersion: 1,
  };
  const evidenceDigest =
    createInternalTokenProductionLaunchEvidenceDigest(evidenceBody);
  return Object.freeze({
    evidence: Object.freeze({ ...evidenceBody, evidenceDigest }),
    summary: Object.freeze({
      attestationCount: attestations.length,
      controlCount: controls.length,
      criticalControlCount:
        INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_CRITICAL_CONTROLS.length,
      dualSourceControlCount:
        INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_CRITICAL_CONTROLS.length,
      environment: "production",
      evidenceDigestsIncluded: false,
      expiresAt,
      identifiersIncluded: false,
      launchApprovalIncluded: false,
      releaseDigestIncluded: false,
      schemaVersion:
        INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_SCHEMA_VERSION,
      status: "assembled",
    }),
  });
}
