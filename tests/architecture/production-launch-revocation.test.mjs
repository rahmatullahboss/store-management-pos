import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production launch checker requires external revocation state and protected head", async () => {
  const checker = await readFile(
    new URL(
      "../../tooling/scripts/check-production-launch-admission.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(checker, /PRODUCTION_LAUNCH_REVOCATION_STATE_PATH/u);
  assert.match(checker, /PRODUCTION_LAUNCH_REVOCATION_EXPECTED_HEAD_DIGEST/u);
  assert.match(checker, /inline production revocation state is prohibited/u);
  assert.match(checker, /evaluateInternalTokenProductionLaunchRevocation/u);
  assert.match(checker, /report\.environment === "production"/u);
  assert.match(checker, /report\.launchGate !== "clear"/u);
  assert.doesNotMatch(checker, /console\.(?:log|error).*headDigest/u);
});

test("revocation journal is append-only, release-bound and aggregate-only", async () => {
  const boundary = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-production-launch-revocation.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(boundary, /previousEntryDigest/u);
  assert.match(boundary, /revocation journal chain is not contiguous/u);
  assert.match(boundary, /protected checkpoint/u);
  assert.match(boundary, /follows a terminal revocation/u);
  assert.match(boundary, /approval actors must be distinct/u);
  assert.match(boundary, /entryAction === "emergency_stop"/u);
  assert.match(boundary, /\["security_owner"\]/u);
  assert.match(boundary, /evidenceDigestsIncluded: false/u);
  assert.match(boundary, /identifiersIncluded: false/u);
  assert.doesNotMatch(boundary, /resourceName|incidentUrl|emailAddress/u);
});

test("dedicated admission workflow tracks every revocation implementation surface", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/production-launch-admission.yml",
      import.meta.url,
    ),
    "utf8",
  );
  for (const path of [
    "internal-token-production-launch-revocation.mjs",
    "production-launch-governance-fixtures.mjs",
    "internal-token-production-launch-revocation*.test.mjs",
    "production-launch-revocation.test.mjs",
    "production-launch-revocation.md",
  ]) {
    assert.match(workflow, new RegExp(path.replaceAll(".", "\\."), "u"));
  }
  assert.doesNotMatch(workflow, /STORE_DEPLOYMENT_TARGET:\s*production/u);
  assert.doesNotMatch(workflow, /PRODUCTION_LAUNCH_REVOCATION_STATE_PATH:/u);
  assert.doesNotMatch(workflow, /secrets\./u);
});
