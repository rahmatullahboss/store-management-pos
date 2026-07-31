import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("persistent staging uses a dedicated Neon project instead of generic disposable preview capacity", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ci:neon-preview"],
    "node tooling/scripts/run-neon-preview-ci.mjs",
  );

  const runner = await readFile(
    new URL("../../tooling/scripts/run-neon-preview-ci.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /selectEvictableRepositoryPreviewBranches/u);
  assert.match(runner, /repositoryStaleBranchEvictionBound: 3/u);
  assert.match(runner, /repositoryStaleBranchMinimumAgeSeconds: 3600/u);
  assert.match(runner, /await import\("\.\/neon-preview-policy\.mjs"\)/u);

  const policy = await readFile(
    new URL("../../tooling/scripts/neon-preview-policy.mjs", import.meta.url),
    "utf8",
  );
  assert.match(policy, /ops\/persistent-admin-pos-staging-v1/u);
  assert.match(policy, /agent\/asymmetric-internal-token-jwks/u);
  assert.match(policy, /agent\/internal-token-kms-signer-boundary/u);
  assert.match(policy, /agent\/internal-token-provider-audit-policy/u);
  assert.match(policy, /agent\/internal-token-change-journal-policy/u);
  assert.match(policy, /dedicated-persistent-staging-neon/u);
  assert.match(policy, /morning-flower-46531465/u);
  assert.match(policy, /br-empty-sound-afkx5vkj/u);
  assert.match(policy, /implementationBranch: branch !== persistentStagingBranch/u);
  assert.match(policy, /destructiveCleanupPerformed: false/u);
  assert.match(policy, /genericPreviewCapacityConsumed: false/u);
  assert.match(policy, /await import\("\.\/neon-preview-ci\.mjs"\)/u);
});
