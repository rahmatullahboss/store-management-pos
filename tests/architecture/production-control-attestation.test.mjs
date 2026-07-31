import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("critical launch controls require independent dual-source attestations", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-control-attestation.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const control of [
    "database_backup_recovery",
    "kms_non_exportable_signing",
    "production_monitoring_paging",
  ]) {
    assert.equal(boundary.includes(control), true);
  }
  for (const issuerClass of [
    "database-provider-control-plane",
    "independent-recovery-verifier",
    "kms-provider-control-plane",
    "independent-key-policy-verifier",
    "monitoring-provider-control-plane",
    "independent-alert-delivery-verifier",
  ]) {
    assert.equal(boundary.includes(issuerClass), true);
  }
  assert.match(boundary, /control attestation sources/u);
  assert.match(boundary, /control attestation issuers/u);
  assert.match(boundary, /provider binding is inconsistent/u);
  assert.match(boundary, /createInternalTokenProductionLaunchEvidenceDigest/u);
});

test("attestation output stays aggregate-only and does not grant launch approval", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-control-attestation.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(boundary, /identifiersIncluded: false/u);
  assert.match(boundary, /evidenceDigestsIncluded: false/u);
  assert.match(boundary, /releaseDigestIncluded: false/u);
  assert.match(boundary, /launchApprovalIncluded: false/u);
  assert.doesNotMatch(boundary, /resourceName|evidenceUrl|issuerEmail/u);
});

test("admission workflow tracks control attestation code, fixtures, tests and docs", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/production-launch-admission.yml",
      import.meta.url,
    ),
    "utf8",
  );
  for (const requiredPath of [
    "internal-token-production-control-attestation.mjs",
    "production-control-attestation-fixtures.mjs",
    "internal-token-production-control-attestation*.test.mjs",
    "production-control-attestation.test.mjs",
    "production-control-attestation.md",
  ]) {
    assert.equal(workflow.includes(requiredPath), true);
  }
  assert.doesNotMatch(workflow, /STORE_DEPLOYMENT_TARGET:\s*production/u);
  assert.doesNotMatch(workflow, /secrets\./u);
});
