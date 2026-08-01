import { createHash } from "node:crypto";
import {
  createInternalTokenProductionLaunchApprovalDigest,
  createInternalTokenProductionLaunchBundleDigest,
  createInternalTokenProductionLaunchEvidenceDigest,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS,
} from "../../tooling/scripts/internal-token-production-launch-admission.mjs";
import {
  createInternalTokenProductionLaunchRevocationApprovalDigest,
  createInternalTokenProductionLaunchRevocationEntryDigest,
  createInternalTokenProductionLaunchRevocationSnapshotDigest,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_OWNER_ROLES,
} from "../../tooling/scripts/internal-token-production-launch-revocation.mjs";

export const productionLaunchNow = 2_000_000_000;
export const productionLaunchDigest = (value) =>
  createHash("sha256").update(value).digest("base64url");

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

export function createProductionLaunchBundle(now = productionLaunchNow) {
  const releaseDigest = productionLaunchDigest("release-2026-08-01");
  const generatedAt = now - 60;
  const expiresAt = now + 600;
  const controls = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS.map(
    (controlId, index) => ({
      controlId,
      evidenceDigest: productionLaunchDigest(`control-evidence-${index}`),
      providerClass: providers[controlId],
      schemaVersion: 1,
      status: "verified",
      verifiedAt: generatedAt - index,
    }),
  );
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
  const approvals = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES.map(
    (role, index) => {
      const body = {
        actorDigest: productionLaunchDigest(`launch-approver-${index}`),
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
    },
  );
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

function actionName(value) {
  return typeof value === "string" ? value : value.action;
}

function actionActors(value, roles, sequence) {
  if (typeof value === "object" && value !== null && Array.isArray(value.actors)) {
    return value.actors;
  }
  return roles.map((role) => `${role}-${sequence}`);
}

export function createProductionLaunchRevocationSnapshot({
  actions = [],
  bundle = createProductionLaunchBundle(),
  expiresAt = productionLaunchNow + 120,
  generatedAt = productionLaunchNow - 5,
  genesisDigest = productionLaunchDigest("revocation-genesis-2026-08-01"),
} = {}) {
  const entries = [];
  let previousEntryDigest = genesisDigest;
  const baseTime = generatedAt - actions.length * 20 - 20;
  for (const [index, rawAction] of actions.entries()) {
    const entryAction = actionName(rawAction);
    const sequence = index + 1;
    const proposedAt = baseTime + index * 20;
    const effectiveAt = proposedAt + 10;
    const reasonDigest = productionLaunchDigest(
      typeof rawAction === "object" && rawAction !== null && rawAction.reason
        ? rawAction.reason
        : `reason-${entryAction}-${sequence}`,
    );
    const incidentDigest = entryAction === "emergency_stop"
      ? productionLaunchDigest(
          typeof rawAction === "object" && rawAction !== null && rawAction.incident
            ? rawAction.incident
            : `incident-${sequence}`,
        )
      : null;
    const roles = entryAction === "emergency_stop"
      ? ["security_owner"]
      : INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_OWNER_ROLES;
    const actors = actionActors(rawAction, roles, sequence);
    const approvals = roles.map((role, approvalIndex) => {
      const body = {
        action: entryAction,
        actorDigest: productionLaunchDigest(actors[approvalIndex]),
        admissionBundleDigest: bundle.bundleDigest,
        approvedAt: proposedAt + 2 + approvalIndex,
        entrySequence: sequence,
        incidentDigest,
        reasonDigest,
        releaseDigest: bundle.evidence.releaseDigest,
        role,
        schemaVersion: 1,
      };
      return {
        ...body,
        approvalDigest:
          createInternalTokenProductionLaunchRevocationApprovalDigest(body),
      };
    });
    const entryBody = {
      action: entryAction,
      admissionBundleDigest: bundle.bundleDigest,
      approvalDigests: approvals.map((approval) => approval.approvalDigest),
      effectiveAt,
      incidentDigest,
      previousEntryDigest,
      proposedAt,
      reasonDigest,
      releaseDigest: bundle.evidence.releaseDigest,
      schemaVersion: 1,
      sequence,
    };
    const entry = {
      action: entryAction,
      admissionBundleDigest: bundle.bundleDigest,
      approvals,
      effectiveAt,
      entryDigest:
        createInternalTokenProductionLaunchRevocationEntryDigest(entryBody),
      incidentDigest,
      previousEntryDigest,
      proposedAt,
      reasonDigest,
      releaseDigest: bundle.evidence.releaseDigest,
      schemaVersion: 1,
      sequence,
    };
    entries.push(entry);
    previousEntryDigest = entry.entryDigest;
  }
  const snapshotBody = {
    admissionBundleDigest: bundle.bundleDigest,
    entries,
    environment: "production",
    expiresAt,
    generatedAt,
    genesisDigest,
    headDigest: previousEntryDigest,
    releaseDigest: bundle.evidence.releaseDigest,
    schemaVersion: 1,
  };
  return {
    ...snapshotBody,
    snapshotDigest:
      createInternalTokenProductionLaunchRevocationSnapshotDigest(snapshotBody),
  };
}

export function resealProductionLaunchRevocationSnapshot(snapshot) {
  const body = {
    admissionBundleDigest: snapshot.admissionBundleDigest,
    entries: snapshot.entries,
    environment: snapshot.environment,
    expiresAt: snapshot.expiresAt,
    generatedAt: snapshot.generatedAt,
    genesisDigest: snapshot.genesisDigest,
    headDigest: snapshot.headDigest,
    releaseDigest: snapshot.releaseDigest,
    schemaVersion: snapshot.schemaVersion,
  };
  snapshot.snapshotDigest =
    createInternalTokenProductionLaunchRevocationSnapshotDigest(body);
  return snapshot;
}
