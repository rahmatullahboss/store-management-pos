import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("repository verification invokes the production launch admission gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["check:production-launch"],
    "node tooling/scripts/check-production-launch-admission.mjs",
  );
  assert.match(
    packageJson.scripts.verify,
    /npm run check:production-launch/u,
  );
});

test("dedicated CI proves production remains blocked without external evidence", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/production-launch-admission.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /name: Production Launch Admission/u);
  assert.match(workflow, /STORE_DEPLOYMENT_TARGET: ci/u);
  assert.match(workflow, /npm run check:production-launch/u);
  assert.match(workflow, /Assert CI cannot report production admission/u);
  assert.match(workflow, /launchGate: 'blocked'/u);
  assert.match(workflow, /status: 'not_requested'/u);
  assert.match(workflow, /production-launch-admission\.json/u);
  assert.doesNotMatch(workflow, /STORE_DEPLOYMENT_TARGET:\s*production/u);
  assert.doesNotMatch(workflow, /PRODUCTION_LAUNCH_EVIDENCE_PATH/u);
  assert.doesNotMatch(workflow, /secrets\./u);
});

test("persistent staging cannot be reclassified as a production launch", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/persistent-admin-pos-staging.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /npm run verify/u);
  assert.match(workflow, /npm run ci:staging-deploy/u);
  assert.doesNotMatch(workflow, /STORE_DEPLOYMENT_TARGET:\s*production/u);
  assert.doesNotMatch(workflow, /PRODUCTION_LAUNCH_EVIDENCE_PATH/u);
});
