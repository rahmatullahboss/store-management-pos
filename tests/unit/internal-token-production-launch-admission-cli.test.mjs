import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createInternalTokenProductionLaunchApprovalDigest,
  createInternalTokenProductionLaunchBundleDigest,
  createInternalTokenProductionLaunchEvidenceDigest,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_APPROVAL_ROLES,
  INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS,
} from "../../tooling/scripts/internal-token-production-launch-admission.mjs";
import {
  checkProductionLaunchAdmission,
} from "../../tooling/scripts/check-production-launch-admission.mjs";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const now = 2_000_000_000;
const providers = {
  database_backup_recovery: "verified-external-backup",
  evidence_archive_legal_hold: "vault-archive",
  incident_response_ownership: "documented-human-ownership",
  kms_non_exportable_signing: "cloud-kms",
  production_monitoring_paging: "managed-observability",
  protected_jwks_publication: "origin-protected-jwks",
  provider_audit_sink: "immutable-security-lake",
  recovery_email_delivery: "transactional-email-provider",
  retention_disposition_ownership: "documented-human-ownership",
  signing_workload_identity: "hardware-bound-service-identity",
};

function validBundle() {
  const releaseDigest = digest("cli-release");
  const generatedAt = now - 60;
  const expiresAt = now + 600;
  const controls = INTERNAL_TOKEN_PRODUCTION_LAUNCH_REQUIRED_CONTROLS.map((controlId, index) => ({
    controlId,
    evidenceDigest: digest(`cli-control-${index}`),
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
      actorDigest: digest(`cli-actor-${index}`),
      approvedAt: generatedAt + 20 + index,
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

async function paths() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "production-launch-admission-"));
  return {
    evidencePath: path.join(directory, "evidence.json"),
    reportPath: path.join(directory, "report.json"),
  };
}

test("non-production CLI mode writes aggregate blocked evidence and succeeds", async () => {
  const { reportPath } = await paths();
  const result = await checkProductionLaunchAdmission({
    environment: { STORE_DEPLOYMENT_TARGET: "staging" },
    now,
    reportPath,
  });
  assert.equal(result.status, "not_requested");
  assert.equal(result.launchGate, "blocked");
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), result);
  assert.doesNotMatch(JSON.stringify(result), /Digest|path|resource/u);
});

test("production CLI mode validates a file and writes aggregate admission evidence", async () => {
  const { evidencePath, reportPath } = await paths();
  await writeFile(evidencePath, JSON.stringify(validBundle()), "utf8");
  const result = await checkProductionLaunchAdmission({
    environment: {
      PRODUCTION_LAUNCH_EVIDENCE_PATH: evidencePath,
      STORE_DEPLOYMENT_TARGET: "production",
    },
    now,
    reportPath,
  });
  assert.equal(result.status, "admitted");
  assert.equal(result.launchGate, "clear");
  assert.equal(result.controlCount, 10);
  assert.equal(result.approvalCount, 3);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), result);
  assert.doesNotMatch(JSON.stringify(result), /Digest|actor|provider|resource/u);
});

test("production CLI mode rejects missing or inline evidence before reading content", async () => {
  const { reportPath } = await paths();
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: { STORE_DEPLOYMENT_TARGET: "production" },
      now,
      reportPath,
    }),
    /production evidence file is required/u,
  );
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: {
        PRODUCTION_LAUNCH_EVIDENCE_JSON: "{\"providerSecret\":\"do-not-log\"}",
        STORE_DEPLOYMENT_TARGET: "production",
      },
      now,
      reportPath,
    }),
    (error) => {
      assert.match(error.message, /inline production evidence is prohibited/u);
      assert.doesNotMatch(error.message, /providerSecret|do-not-log/u);
      return true;
    },
  );
});

test("production CLI mode masks unreadable, malformed and invalid evidence details", async () => {
  const { evidencePath, reportPath } = await paths();
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: {
        PRODUCTION_LAUNCH_EVIDENCE_PATH: `${evidencePath}-missing-sensitive-provider`,
        STORE_DEPLOYMENT_TARGET: "production",
      },
      now,
      reportPath,
    }),
    (error) => {
      assert.match(error.message, /could not be read or parsed/u);
      assert.doesNotMatch(error.message, /missing-sensitive-provider/u);
      return true;
    },
  );
  await writeFile(evidencePath, "{not-json:private-provider-resource}", "utf8");
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: {
        PRODUCTION_LAUNCH_EVIDENCE_PATH: evidencePath,
        STORE_DEPLOYMENT_TARGET: "production",
      },
      now,
      reportPath,
    }),
    (error) => {
      assert.match(error.message, /could not be read or parsed/u);
      assert.doesNotMatch(error.message, /not-json|private-provider-resource/u);
      return true;
    },
  );
  const invalid = validBundle();
  invalid.bundleDigest = digest("invalid-cli-bundle");
  await writeFile(evidencePath, JSON.stringify(invalid), "utf8");
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: {
        PRODUCTION_LAUNCH_EVIDENCE_PATH: evidencePath,
        STORE_DEPLOYMENT_TARGET: "production",
      },
      now,
      reportPath,
    }),
    (error) => {
      assert.match(error.message, /production evidence validation failed/u);
      assert.doesNotMatch(error.message, /bundle digest|invalid-cli-bundle/u);
      return true;
    },
  );
});
