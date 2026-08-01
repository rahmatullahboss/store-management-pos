import { createHash } from "node:crypto";
import {
  createInternalTokenProductionControlAttestationDigest,
} from "../../tooling/scripts/internal-token-production-control-attestation.mjs";
import {
  createInternalTokenProductionLaunchApprovalDigest,
  createInternalTokenProductionLaunchBundleDigest,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS,
} from "../../tooling/scripts/internal-token-production-launch-admission.mjs";

export const controlAttestationNow = 2_010_000_000;
export const controlAttestationDigest = (value) =>
  createHash("sha256").update(value).digest("base64url");

const policies = Object.freeze({
  database_backup_recovery: Object.freeze({
    providerClass: "managed-postgres",
    issuerClasses: Object.freeze([
      "database-provider-control-plane",
      "independent-recovery-verifier",
    ]),
  }),
  evidence_archive_legal_hold: Object.freeze({
    providerClass: "object-lock-archive",
    issuerClasses: Object.freeze(["archive-provider-control-plane"]),
  }),
  incident_response_ownership: Object.freeze({
    providerClass: "documented-human-ownership",
    issuerClasses: Object.freeze(["governance-registry"]),
  }),
  kms_non_exportable_signing: Object.freeze({
    providerClass: "managed-hsm",
    issuerClasses: Object.freeze([
      "kms-provider-control-plane",
      "independent-key-policy-verifier",
    ]),
  }),
  production_monitoring_paging: Object.freeze({
    providerClass: "managed-observability",
    issuerClasses: Object.freeze([
      "monitoring-provider-control-plane",
      "independent-alert-delivery-verifier",
    ]),
  }),
  protected_jwks_publication: Object.freeze({
    providerClass: "edge-protected-jwks",
    issuerClasses: Object.freeze(["edge-runtime-verifier"]),
  }),
  provider_audit_sink: Object.freeze({
    providerClass: "immutable-provider-audit",
    issuerClasses: Object.freeze(["audit-sink-verifier"]),
  }),
  recovery_email_delivery: Object.freeze({
    providerClass: "transactional-email-provider",
    issuerClasses: Object.freeze(["email-provider-verifier"]),
  }),
  retention_disposition_ownership: Object.freeze({
    providerClass: "documented-human-ownership",
    issuerClasses: Object.freeze(["governance-registry"]),
  }),
  signing_workload_identity: Object.freeze({
    providerClass: "federated-workload-identity",
    issuerClasses: Object.freeze(["identity-provider-verifier"]),
  }),
});

export function createProductionControlAttestationAssembly({
  expiresAt = controlAttestationNow + 600,
  generatedAt = controlAttestationNow - 30,
  releaseDigest = controlAttestationDigest("release-control-attestation-v1"),
} = {}) {
  let index = 0;
  const attestations = [];
  for (const controlId of INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS) {
    const policy = policies[controlId];
    for (const issuerClass of policy.issuerClasses) {
      const body = {
        controlId,
        environment: "production",
        expiresAt,
        issuerClass,
        issuerDigest: controlAttestationDigest(
          `issuer-${controlId}-${issuerClass}-${index}`,
        ),
        observedAt: generatedAt - index,
        providerClass: policy.providerClass,
        releaseDigest,
        schemaVersion: 1,
        sourceDigest: controlAttestationDigest(
          `source-${controlId}-${issuerClass}-${index}`,
        ),
        status: "verified",
      };
      attestations.push({
        ...body,
        attestationDigest:
          createInternalTokenProductionControlAttestationDigest(body),
      });
      index += 1;
    }
  }
  return {
    attestations,
    environment: "production",
    expiresAt,
    generatedAt,
    releaseDigest,
    schemaVersion: 1,
  };
}

export function createProductionLaunchBundleFromEvidence(evidence) {
  const approvals = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES.map(
    (role, index) => {
      const body = {
        actorDigest: controlAttestationDigest(`launch-owner-${role}-${index}`),
        approvedAt: evidence.generatedAt + 10 + index,
        evidenceDigest: evidence.evidenceDigest,
        releaseDigest: evidence.releaseDigest,
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
    approvalDigests: approvals.map((approval) => approval.approvalDigest),
    environment: "production",
    evidenceDigest: evidence.evidenceDigest,
    expiresAt: evidence.expiresAt,
    releaseDigest: evidence.releaseDigest,
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
