import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createInternalTokenProductionLaunchApprovalDigest,
  createInternalTokenProductionLaunchBundleDigest,
  createInternalTokenProductionLaunchEvidenceDigest,
  createInternalTokenProductionLaunchNotRequestedEvidence,
  evaluateInternalTokenProductionLaunchAdmission,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS,
} from "../../tooling/scripts/internal-token-production-launch-admission.mjs";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const now = 2_000_000_000;
const providers = {
  database_backup_recovery: "managed-postgres",
  evidence_archive_legal_hold: "object-lock-archive",
  incident_response_ownership: "documented-human-ownership",
  kms_non_exportable_signing: "managed-hsm",
  production_monitoring_paging: "managed-observability",
  protected_jwks_publication: "edge-protected-jwks",
  provider_audit_sink: "immutable-provider-audit",
  recovery_email_delivery: "transactional-email-provider",
  retention_disposition_ownership: "documented-human-ownership",
  signing_workload_identity: "federated-workload-identity",
};

function bundle() {
  const releaseDigest = digest("release-2026-07-31");
  const generatedAt = now - 60;
  const expiresAt = now + 600;
  const controls = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS.map((controlId, index) => ({
    controlId,
    evidenceDigest: digest(`control-evidence-${index}`),
    providerClass: providers[controlId],
    schemaVersion: 1,
    status: "verified",
    verifiedAt: generatedAt - index,
  }));
  const evidenceBody = {
    controls,
    environment: "production",
    expiresAt,
    generatedAt,
    releaseDigest,
    schemaVersion: 1,
  };
  const evidence = {
    ...evidenceBody,
    evidenceDigest: createInternalTokenProductionLaunchEvidenceDigest(evidenceBody),
  };
  const approvals = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES.map((role, index) => {
    const body = {
      actorDigest: digest(`approver-${index}`),
      approvedAt: generatedAt + 10 + index,
      evidenceDigest: evidence.evidenceDigest,
      releaseDigest,
      role,
      schemaVersion: 1,
    };
    return {
      ...body,
      approvalDigest: createInternalTokenProductionLaunchApprovalDigest(body),
    };
  });
  const bundleBody = {
    approvalDigests: approvals.map((item) => item.approvalDigest),
    environment: "production",
    evidenceDigest: evidence.evidenceDigest,
    expiresAt,
    releaseDigest,
    schemaVersion: 1,
  };
  return {
    approvals,
    bundleDigest: createInternalTokenProductionLaunchBundleDigest(bundleBody),
    environment: "production",
    evidence,
    schemaVersion: 1,
  };
}

function resign(value) {
  const evidenceBody = {
    controls: value.evidence.controls,
    environment: value.evidence.environment,
    expiresAt: value.evidence.expiresAt,
    generatedAt: value.evidence.generatedAt,
    releaseDigest: value.evidence.releaseDigest,
    schemaVersion: value.evidence.schemaVersion,
  };
  value.evidence.evidenceDigest = createInternalTokenProductionLaunchEvidenceDigest(evidenceBody);
  value.approvals = value.approvals.map((approval) => {
    const body = {
      actorDigest: approval.actorDigest,
      approvedAt: approval.approvedAt,
      evidenceDigest: value.evidence.evidenceDigest,
      releaseDigest: value.evidence.releaseDigest,
      role: approval.role,
      schemaVersion: 1,
    };
    return { ...body, approvalDigest: createInternalTokenProductionLaunchApprovalDigest(body) };
  });
  const bundleBody = {
    approvalDigests: value.approvals.map((item) => item.approvalDigest),
    environment: "production",
    evidenceDigest: value.evidence.evidenceDigest,
    expiresAt: value.evidence.expiresAt,
    releaseDigest: value.evidence.releaseDigest,
    schemaVersion: 1,
  };
  value.bundleDigest = createInternalTokenProductionLaunchBundleDigest(bundleBody);
  return value;
}

function assertAggregateOnly(result) {
  for (const key of [
    "actorDigest",
    "approvalDigest",
    "bundleDigest",
    "evidenceDigest",
    "providerClass",
    "releaseDigest",
  ]) {
    assert.equal(Object.hasOwn(result, key), false);
  }
}

test("complete production evidence and three independent approvals clear the launch gate", () => {
  const result = evaluateInternalTokenProductionLaunchAdmission(bundle(), now);
  assert.deepEqual(result, {
    approvalCount: 3,
    controlCount: 10,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: now + 600,
    identifiersIncluded: false,
    launchGate: "clear",
    schemaVersion: 1,
    status: "admitted",
  });
  assertAggregateOnly(result);
});

test("missing, duplicate and unknown production controls fail closed", () => {
  const missing = structuredClone(bundle());
  missing.evidence.controls.pop();
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(missing), now),
    /every required control exactly once/u,
  );
  const duplicate = structuredClone(bundle());
  duplicate.evidence.controls[9] = {
    ...duplicate.evidence.controls[0],
    evidenceDigest: digest("different-duplicate-evidence"),
  };
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(duplicate), now),
    /missing, duplicated or unknown/u,
  );
  const unknown = structuredClone(bundle());
  unknown.evidence.controls[0].controlId = "unknown_control";
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(unknown), now),
    /control 1 id is invalid/u,
  );
});

test("stale, unverified or unsupported provider evidence cannot admit production", () => {
  const stale = structuredClone(bundle());
  stale.evidence.generatedAt = now - 90_000;
  stale.evidence.expiresAt = stale.evidence.generatedAt + 600;
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(stale), now),
    /stale or not yet valid/u,
  );
  const unverified = structuredClone(bundle());
  unverified.evidence.controls[0].status = "pending";
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(unverified), now),
    /status or schema version is invalid/u,
  );
  const provider = structuredClone(bundle());
  provider.evidence.controls[3].providerClass = "software-secret";
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(provider), now),
    /provider class is invalid/u,
  );
});

test("approval roles, actors and timestamps remain independent and bounded", () => {
  const sameActor = structuredClone(bundle());
  sameActor.approvals[1].actorDigest = sameActor.approvals[0].actorDigest;
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(sameActor), now),
    /approval actors must be distinct/u,
  );
  const duplicateRole = structuredClone(bundle());
  duplicateRole.approvals[1].role = duplicateRole.approvals[0].role;
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(duplicateRole), now),
    /roles are missing, duplicated or unknown/u,
  );
  const early = structuredClone(bundle());
  early.approvals[0].approvedAt = early.evidence.generatedAt - 1;
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(resign(early), now),
    /outside the evidence window/u,
  );
});

test("evidence, approval and bundle tampering are detected", () => {
  const evidence = structuredClone(bundle());
  evidence.evidence.controls[0].verifiedAt -= 1;
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(evidence, now),
    /evidence digest does not match/u,
  );
  const approval = structuredClone(bundle());
  approval.approvals[0].approvedAt += 1;
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(approval, now),
    /approval 1 digest does not match/u,
  );
  const finalBundle = structuredClone(bundle());
  finalBundle.bundleDigest = digest("tampered-bundle");
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(finalBundle, now),
    /bundle digest does not match/u,
  );
});

test("exact schemas reject raw production identifiers and resources", () => {
  const rawControl = structuredClone(bundle());
  rawControl.evidence.controls[0].resourceName = "projects/example/keys/private";
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(rawControl, now),
    /control 1 fields are invalid/u,
  );
  const rawApproval = structuredClone(bundle());
  rawApproval.approvals[0].email = "security@example.com";
  assert.throws(
    () => evaluateInternalTokenProductionLaunchAdmission(rawApproval, now),
    /approval 1 fields are invalid/u,
  );
});

test("non-production targets remain blocked and cannot reuse not-requested evidence for production", () => {
  const result = createInternalTokenProductionLaunchNotRequestedEvidence("staging");
  assert.deepEqual(result, {
    approvalCount: 0,
    controlCount: 0,
    environment: "staging",
    evidenceDigestsIncluded: false,
    identifiersIncluded: false,
    launchGate: "blocked",
    schemaVersion: 1,
    status: "not_requested",
  });
  assertAggregateOnly(result);
  assert.throws(
    () => createInternalTokenProductionLaunchNotRequestedEvidence("production"),
    /cannot use not-requested/u,
  );
});
