import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signed attestation receipts use Ed25519 public trust and protected replay checkpoints", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-issuer-identity.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(boundary, /Ed25519/u);
  assert.match(boundary, /verifySignature/u);
  assert.match(boundary, /createPublicKey/u);
  assert.match(boundary, /registryDigest !== expectedDigest/u);
  assert.match(boundary, /checkpointDigest !== expectedDigest/u);
  assert.match(boundary, /receiptSequence !== checkpoint\.nextSequence/u);
  assert.match(boundary, /signed receipt nonces/u);
  assert.match(boundary, /replayCheckpointAdvanced: true/u);
  assert.doesNotMatch(boundary, /privateKey|BEGIN PRIVATE KEY/u);
});

test("critical dual-source attestations require independent trust domains", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-issuer-identity.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    boundary,
    /INTERNAL_TOKEN_PRODUCTION_CONTROL_ATTESTATION_CRITICAL_CONTROLS/u,
  );
  assert.match(boundary, /trustDomainDigest/u);
  assert.match(boundary, /does not have independent trust domains/u);
  assert.match(boundary, /principal\.status !== "active"/u);
  assert.match(boundary, /principal\.validFrom/u);
  assert.match(boundary, /principal\.validUntil/u);
});

test("issuer identity summaries are aggregate-only and workflow-tracked", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-attestation-issuer-identity.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const marker of [
    "identifiersIncluded: false",
    "evidenceDigestsIncluded: false",
    "issuerKeyDigestsIncluded: false",
    "receiptNonceDigestsIncluded: false",
    "releaseDigestIncluded: false",
    "trustRegistryDigestIncluded: false",
  ]) {
    assert.equal(boundary.includes(marker), true);
  }

  const workflow = await readFile(
    new URL(
      "../../.github/workflows/production-launch-admission.yml",
      import.meta.url,
    ),
    "utf8",
  );
  for (const requiredPath of [
    "internal-token-production-attestation-issuer-identity.mjs",
    "production-attestation-issuer-identity-fixtures.mjs",
    "internal-token-production-attestation-issuer-identity*.test.mjs",
    "production-attestation-issuer-identity.test.mjs",
    "production-attestation-issuer-identity.md",
  ]) {
    assert.equal(workflow.includes(requiredPath), true);
  }
  assert.doesNotMatch(workflow, /STORE_DEPLOYMENT_TARGET:\s*production/u);
  assert.doesNotMatch(workflow, /secrets\./u);
});
