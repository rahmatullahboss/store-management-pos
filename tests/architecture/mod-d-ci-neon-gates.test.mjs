import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../.github/workflows/foundation-ci.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

function jobSection(source, name, nextName) {
  const start = source.indexOf(`  ${name}:`);
  const end = nextName === undefined ? source.length : source.indexOf(`  ${nextName}:`);
  assert.ok(start >= 0, `${name} job is required`);
  assert.ok(end > start, `${name} job boundary is invalid`);
  return source.slice(start, end);
}

test("MOD-D PRs use the assigned Neon branch rehearsal instead of an ephemeral preview branch", async () => {
  const source = await workflow();
  const previewJob = jobSection(source, "neon-preview", "neon-recovery");
  const modDJob = jobSection(source, "mod-d-neon-rehearsal", "mod-f-neon-rehearsal");

  assert.match(previewJob, /github\.event\.pull_request\.head\.ref != 'module\/pos-cash-offline-v1'/u);
  assert.match(modDJob, /github\.event\.pull_request\.head\.ref == 'module\/pos-cash-offline-v1'/u);
  assert.match(modDJob, /MOD_D_NEON_BRANCH_ID: br-rapid-river-axoz0rfs/u);
  assert.match(modDJob, /npm run ci:neon-mod-d/u);
  assert.match(modDJob, /if-no-files-found: error/u);
});

test("quota-safe MOD-G releases use the assigned branch and retain recovery evidence", async () => {
  const source = await workflow();
  const previewJob = jobSection(source, "neon-preview", "neon-recovery");
  const recoveryJob = jobSection(source, "neon-recovery", "mod-d-neon-rehearsal");
  const modGJob = jobSection(source, "mod-g-neon-rehearsal", "cloudflare-preview");
  const finalJob = jobSection(source, "mod-g-final-readiness");

  assert.match(previewJob, /github\.event\.pull_request\.head\.ref != 'program\/integration-v1'/u);
  assert.match(previewJob, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(previewJob, /npm run ci:neon-preview/u);
  assert.match(previewJob, /NEON_PARENT_BRANCH_ID: br-spring-grass-ax3ptydv/u);

  assert.match(recoveryJob, /npm run ci:neon-recovery/u);
  assert.match(modGJob, /github\.event\.pull_request\.head\.ref == 'program\/integration-v1'/u);
  assert.match(modGJob, /github\.event\.pull_request\.base\.ref == 'main'/u);
  assert.match(modGJob, /MOD_G_NEON_BRANCH_ID: br-mute-band-axbhmsky/u);
  assert.match(modGJob, /npm run ci:neon-mod-g/u);
  assert.match(finalJob, /needs\['mod-g-neon-rehearsal'\]\.result == 'success'/u);
  assert.match(finalJob, /needs\['neon-recovery'\]\.result == 'success'/u);
  assert.match(finalJob, /needs\['cloudflare-preview'\]\.result == 'success'/u);
});

test("database-free marketing PRs preserve recovery gates without consuming a preview branch", async () => {
  const source = await workflow();
  const previewJob = jobSection(source, "neon-preview", "neon-recovery");
  const recoveryJob = jobSection(source, "neon-recovery", "mod-d-neon-rehearsal");
  const cloudflareJob = jobSection(source, "cloudflare-preview", "mod-g-final-readiness");

  assert.match(previewJob, /github\.event\.pull_request\.head\.ref != 'feature\/marketing-landing-page'/u);
  assert.match(recoveryJob, /needs: verify/u);
  assert.match(recoveryJob, /npm run ci:neon-recovery/u);
  assert.match(cloudflareJob, /needs: verify/u);
  assert.match(cloudflareJob, /npm run ci:cloudflare-preview/u);
});
