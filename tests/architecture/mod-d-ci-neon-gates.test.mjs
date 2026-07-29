import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../.github/workflows/foundation-ci.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("MOD-D PRs use the assigned Neon branch rehearsal instead of an ephemeral preview branch", async () => {
  const source = await workflow();
  const previewStart = source.indexOf("  neon-preview:");
  const recoveryStart = source.indexOf("  neon-recovery:");
  const modDStart = source.indexOf("  mod-d-neon-rehearsal:");
  const cloudflareStart = source.indexOf("  cloudflare-preview:");

  assert.ok(previewStart >= 0 && recoveryStart > previewStart);
  assert.ok(modDStart > recoveryStart && cloudflareStart > modDStart);

  const previewJob = source.slice(previewStart, recoveryStart);
  const modDJob = source.slice(modDStart, cloudflareStart);

  assert.match(previewJob, /github\.event\.pull_request\.head\.ref != 'module\/pos-cash-offline-v1'/u);
  assert.match(modDJob, /github\.event\.pull_request\.head\.ref == 'module\/pos-cash-offline-v1'/u);
  assert.match(modDJob, /MOD_D_NEON_BRANCH_ID: br-rapid-river-axoz0rfs/u);
  assert.match(modDJob, /npm run ci:neon-mod-d/u);
  assert.match(modDJob, /if-no-files-found: error/u);
});

test("generic Neon preview remains active for integration and main pushes", async () => {
  const source = await workflow();
  const previewJob = source.slice(source.indexOf("  neon-preview:"), source.indexOf("  neon-recovery:"));

  assert.match(previewJob, /github\.event_name != 'pull_request'/u);
  assert.match(previewJob, /npm run ci:neon-preview/u);
  assert.match(previewJob, /NEON_PARENT_BRANCH_ID: br-spring-grass-ax3ptydv/u);
});
