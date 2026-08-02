import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../", import.meta.url);

async function text(path) {
  return await readFile(new URL(path, repoRoot), "utf8");
}

async function manifest() {
  return JSON.parse(await text("docs/architecture/storefront/dependency-integration-acceptance.json"));
}

test("dependency acceptance manifest covers every current external authority/runtime blocker", async () => {
  const value = await manifest();

  assert.equal(value.schemaVersion, "storefront-dependency-integration-acceptance.v1");
  assert.equal(value.integrationTarget, "program/integration-v1");
  assert.equal(value.activationDefault, "fail_closed");

  const issues = value.blockers.map((entry) => entry.issue);
  assert.deepEqual(issues, [97, 98, 100, 101, 102, 104, 107, 108]);
  assert.equal(new Set(issues).size, issues.length);

  for (const entry of value.blockers) {
    assert.equal(entry.activationAllowed, false, `issue #${entry.issue}`);
    assert.match(entry.owner, /\S/u);
    assert.match(entry.capability, /\S/u);
    assert.ok(entry.storefrontBoundaries.length > 0, `issue #${entry.issue} boundaries`);
    assert.ok(entry.activationSurfaces.length > 0, `issue #${entry.issue} surfaces`);
    assert.ok(entry.requiredEvidence.length >= 4, `issue #${entry.issue} evidence`);
  }
});

test("manifest references only existing repository-owned integration boundaries", async () => {
  const value = await manifest();

  for (const entry of value.blockers) {
    for (const boundary of entry.storefrontBoundaries) {
      assert.match(
        boundary,
        /^(modules\/storefront|packages\/storefront-contracts|apps\/api\/src\/modules\/storefront)(?:\/|$)/u,
        `issue #${entry.issue}: ${boundary}`,
      );
      const target = new URL(boundary, repoRoot);
      await access(target);
      const info = await stat(target);
      assert.equal(info.isFile() || info.isDirectory(), true, boundary);
    }
  }
});

test("verified provider bridges are assigned only to their owning blocker entries", async () => {
  const value = await manifest();
  const byIssue = new Map(value.blockers.map((entry) => [entry.issue, entry]));

  assert.deepEqual(byIssue.get(104).storefrontBoundaries, [
    "modules/storefront/src/domain-provider-bridge.ts",
    "apps/api/src/modules/storefront/handler.ts",
  ]);
  assert.deepEqual(byIssue.get(107).storefrontBoundaries, [
    "modules/storefront/src/abuse-control.ts",
    "modules/storefront/src/abuse-control-provider-bridge.ts",
  ]);
  assert.deepEqual(byIssue.get(108).storefrontBoundaries, [
    "modules/storefront/src/observability.ts",
    "modules/storefront/src/operational-sink-bridge.ts",
  ]);
});

test("acceptance instructions do not authorize blocked runtime or private route activation", async () => {
  const value = await manifest();
  const api = await text("apps/api/src/index.ts");
  const buyerRuntime = await text("apps/storefront-web/src/runtime.ts");
  const combined = `${api}\n${buyerRuntime}`;

  for (const forbidden of [
    "cart-quote-handler",
    "checkout-capability-handler",
    "customer-account-handler",
    "domain-provider-bridge",
    "abuse-control-provider-bridge",
    "operational-sink-bridge",
    "dependency-activation",
    "evaluateStorefrontDependencyActivationV1",
    "assertStorefrontDependencyActivationV1",
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }

  for (const entry of value.blockers) {
    assert.equal(entry.activationAllowed, false, `issue #${entry.issue}`);
  }
});
