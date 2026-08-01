import { createHash } from "node:crypto";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const MAX_BUNDLE_LIFETIME_SECONDS = 4 * 60 * 60;
const MAX_EVIDENCE_AGE_SECONDS = 24 * 60 * 60;
const REQUIRED_CONTROLS = Object.freeze([
  "database_backup_recovery",
  "evidence_archive_legal_hold",
  "incident_response_ownership",
  "kms_non_exportable_signing",
  "production_monitoring_paging",
  "protected_jwks_publication",
  "provider_audit_sink",
  "recovery_email_delivery",
  "retention_disposition_ownership",
  "signing_workload_identity",
]);
const REQUIRED_CONTROL_SET = new Set(REQUIRED_CONTROLS);
const REQUIRED_APPROVAL_ROLES = Object.freeze([
  "operations_owner",
  "platform_owner",
  "security_owner",
]);
const REQUIRED_APPROVAL_ROLE_SET = new Set(REQUIRED_APPROVAL_ROLES);
const CONTROL_PROVIDER_CLASSES = Object.freeze({
  database_backup_recovery: new Set(["managed-postgres", "verified-external-backup"]),
  evidence_archive_legal_hold: new Set(["object-lock-archive", "vault-archive", "offline-custodian"]),
  incident_response_ownership: new Set(["documented-human-ownership"]),
  kms_non_exportable_signing: new Set(["cloud-kms", "managed-hsm", "pkcs11-hsm"]),
  production_monitoring_paging: new Set(["managed-observability", "self-hosted-observability"]),
  protected_jwks_publication: new Set(["edge-protected-jwks", "origin-protected-jwks"]),
  provider_audit_sink: new Set(["immutable-provider-audit", "immutable-security-lake"]),
  recovery_email_delivery: new Set(["transactional-email-provider"]),
  retention_disposition_ownership: new Set(["documented-human-ownership"]),
  signing_workload_identity: new Set(["federated-workload-identity", "hardware-bound-service-identity"]),
});

export const INTERNAL_TOKEN_PRODUCTION_LAUNCH_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS = REQUIRED_CONTROLS;
export const INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES = REQUIRED_APPROVAL_ROLES;

function fail(message) {
  throw new Error(`Internal-token production launch admission: ${message}`);
}

function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} is invalid`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
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
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}

function assertDistinct(values, name) {
  if (new Set(values).size !== values.length) fail(`${name} must have distinct purposes`);
}

function normalizeControl(input, generatedAt, expiresAt, index) {
  const value = exact(input, [
    "controlId",
    "evidenceDigest",
    "providerClass",
    "schemaVersion",
    "status",
    "verifiedAt",
  ], `control ${index + 1}`);
  if (value.schemaVersion !== 1 || value.status !== "verified") {
    fail(`control ${index + 1} status or schema version is invalid`);
  }
  if (typeof value.controlId !== "string" || !REQUIRED_CONTROL_SET.has(value.controlId)) {
    fail(`control ${index + 1} id is invalid`);
  }
  const allowedProviders = CONTROL_PROVIDER_CLASSES[value.controlId];
  if (typeof value.providerClass !== "string" || !allowedProviders.has(value.providerClass)) {
    fail(`control ${index + 1} provider class is invalid`);
  }
  const verifiedAt = integer(value.verifiedAt, `control ${index + 1} verified-at`, 1);
  if (verifiedAt < generatedAt - MAX_EVIDENCE_AGE_SECONDS || verifiedAt > generatedAt || verifiedAt > expiresAt) {
    fail(`control ${index + 1} verification time is invalid`);
  }
  return Object.freeze({
    controlId: value.controlId,
    evidenceDigest: digest(value.evidenceDigest, `control ${index + 1} evidence digest`),
    providerClass: value.providerClass,
    schemaVersion: 1,
    status: "verified",
    verifiedAt,
  });
}

function normalizeEvidence(input, now) {
  const value = exact(input, [
    "controls",
    "environment",
    "evidenceDigest",
    "expiresAt",
    "generatedAt",
    "releaseDigest",
    "schemaVersion",
  ], "production launch evidence");
  if (value.schemaVersion !== 1 || value.environment !== "production") {
    fail("production launch evidence environment or schema version is invalid");
  }
  const generatedAt = integer(value.generatedAt, "evidence generation time", 1);
  const expiresAt = integer(value.expiresAt, "evidence expiry", 1);
  if (expiresAt <= generatedAt || expiresAt - generatedAt > MAX_BUNDLE_LIFETIME_SECONDS) {
    fail("production launch evidence lifetime is invalid");
  }
  if (generatedAt < now - MAX_EVIDENCE_AGE_SECONDS || generatedAt > now + 30 || now > expiresAt) {
    fail("production launch evidence is stale or not yet valid");
  }
  if (!Array.isArray(value.controls) || value.controls.length !== REQUIRED_CONTROLS.length) {
    fail("production launch evidence must contain every required control exactly once");
  }
  const controls = value.controls.map((item, index) =>
    normalizeControl(item, generatedAt, expiresAt, index)).sort((left, right) =>
    left.controlId.localeCompare(right.controlId));
  if (new Set(controls.map((item) => item.controlId)).size !== REQUIRED_CONTROLS.length ||
      controls.some((item, index) => item.controlId !== REQUIRED_CONTROLS[index])) {
    fail("production launch controls are missing, duplicated or unknown");
  }
  if (new Set(controls.map((item) => item.evidenceDigest)).size !== controls.length) {
    fail("production launch control evidence digests must be unique");
  }
  const body = {
    controls,
    environment: "production",
    expiresAt,
    generatedAt,
    releaseDigest: digest(value.releaseDigest, "release digest"),
    schemaVersion: 1,
  };
  const evidenceDigest = digest(value.evidenceDigest, "production evidence digest");
  if (hash(body) !== evidenceDigest) fail("production launch evidence digest does not match");
  assertDistinct(
    [body.releaseDigest, evidenceDigest, ...controls.map((item) => item.evidenceDigest)],
    "production launch evidence digests",
  );
  return Object.freeze({ ...body, evidenceDigest });
}

function normalizeApproval(input, evidence, index) {
  const value = exact(input, [
    "actorDigest",
    "approvalDigest",
    "approvedAt",
    "evidenceDigest",
    "releaseDigest",
    "role",
    "schemaVersion",
  ], `approval ${index + 1}`);
  if (value.schemaVersion !== 1 ||
      value.evidenceDigest !== evidence.evidenceDigest ||
      value.releaseDigest !== evidence.releaseDigest) {
    fail(`approval ${index + 1} binding is invalid`);
  }
  if (typeof value.role !== "string" || !REQUIRED_APPROVAL_ROLE_SET.has(value.role)) {
    fail(`approval ${index + 1} role is invalid`);
  }
  const approvedAt = integer(value.approvedAt, `approval ${index + 1} approved-at`, 1);
  if (approvedAt < evidence.generatedAt || approvedAt > evidence.expiresAt) {
    fail(`approval ${index + 1} timestamp is outside the evidence window`);
  }
  const body = {
    actorDigest: digest(value.actorDigest, `approval ${index + 1} actor digest`),
    approvedAt,
    evidenceDigest: evidence.evidenceDigest,
    releaseDigest: evidence.releaseDigest,
    role: value.role,
    schemaVersion: 1,
  };
  const approvalDigest = digest(value.approvalDigest, `approval ${index + 1} digest`);
  if (hash(body) !== approvalDigest) fail(`approval ${index + 1} digest does not match`);
  assertDistinct(
    [body.actorDigest, body.evidenceDigest, body.releaseDigest, approvalDigest],
    `approval ${index + 1} digests`,
  );
  return Object.freeze({ ...body, approvalDigest });
}

export function createInternalTokenProductionLaunchEvidenceDigest(input) {
  const value = exact(input, [
    "controls",
    "environment",
    "expiresAt",
    "generatedAt",
    "releaseDigest",
    "schemaVersion",
  ], "production launch evidence body");
  return hash(value);
}

export function createInternalTokenProductionLaunchApprovalDigest(input) {
  const value = exact(input, [
    "actorDigest",
    "approvedAt",
    "evidenceDigest",
    "releaseDigest",
    "role",
    "schemaVersion",
  ], "production launch approval body");
  return hash(value);
}

export function createInternalTokenProductionLaunchBundleDigest(input) {
  const value = exact(input, [
    "approvalDigests",
    "environment",
    "evidenceDigest",
    "expiresAt",
    "releaseDigest",
    "schemaVersion",
  ], "production launch bundle body");
  return hash(value);
}

export function evaluateInternalTokenProductionLaunchAdmission(input, nowInput) {
  const now = integer(nowInput, "production admission clock", 1);
  const value = exact(input, [
    "approvals",
    "bundleDigest",
    "environment",
    "evidence",
    "schemaVersion",
  ], "production launch bundle");
  if (value.schemaVersion !== 1 || value.environment !== "production") {
    fail("production launch bundle environment or schema version is invalid");
  }
  const evidence = normalizeEvidence(value.evidence, now);
  if (!Array.isArray(value.approvals) || value.approvals.length !== REQUIRED_APPROVAL_ROLES.length) {
    fail("production launch bundle requires every independent approval role");
  }
  const approvals = value.approvals.map((item, index) =>
    normalizeApproval(item, evidence, index)).sort((left, right) =>
    left.role.localeCompare(right.role));
  if (new Set(approvals.map((item) => item.role)).size !== REQUIRED_APPROVAL_ROLES.length ||
      approvals.some((item, index) => item.role !== REQUIRED_APPROVAL_ROLES[index])) {
    fail("production launch approval roles are missing, duplicated or unknown");
  }
  if (new Set(approvals.map((item) => item.actorDigest)).size !== approvals.length) {
    fail("production launch approval actors must be distinct");
  }
  if (new Set(approvals.map((item) => item.approvalDigest)).size !== approvals.length) {
    fail("production launch approval digests must be distinct");
  }
  const body = {
    approvalDigests: approvals.map((item) => item.approvalDigest),
    environment: "production",
    evidenceDigest: evidence.evidenceDigest,
    expiresAt: evidence.expiresAt,
    releaseDigest: evidence.releaseDigest,
    schemaVersion: 1,
  };
  const bundleDigest = digest(value.bundleDigest, "production launch bundle digest");
  if (hash(body) !== bundleDigest) fail("production launch bundle digest does not match");
  assertDistinct([
    bundleDigest,
    body.evidenceDigest,
    body.releaseDigest,
    ...body.approvalDigests,
    ...evidence.controls.map((item) => item.evidenceDigest),
    ...approvals.map((item) => item.actorDigest),
  ], "production launch bundle digests");
  return Object.freeze({
    approvalCount: approvals.length,
    controlCount: evidence.controls.length,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: evidence.expiresAt,
    identifiersIncluded: false,
    launchGate: "clear",
    schemaVersion: 1,
    status: "admitted",
  });
}

export function createInternalTokenProductionLaunchNotRequestedEvidence(targetInput) {
  const target = typeof targetInput === "string" && targetInput.trim() !== ""
    ? targetInput.trim().toLowerCase()
    : "unspecified";
  if (target === "production") fail("production target cannot use not-requested evidence");
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(target)) fail("deployment target is invalid");
  return Object.freeze({
    approvalCount: 0,
    controlCount: 0,
    environment: target,
    evidenceDigestsIncluded: false,
    identifiersIncluded: false,
    launchGate: "blocked",
    schemaVersion: 1,
    status: "not_requested",
  });
}
