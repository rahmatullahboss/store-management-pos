import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STOREFRONT_ACTIVATION_REQUIREMENTS,
  STOREFRONT_DEPENDENCY_ISSUES,
  assertStorefrontDependencyActivationV1,
  evaluateStorefrontDependencyActivationV1,
} from "../../build/modules/storefront/src/dependency-activation.js";

const repoRoot = new URL("../../", import.meta.url);

async function manifest() {
  return JSON.parse(
    await readFile(
      new URL(
        "docs/architecture/storefront/dependency-integration-acceptance.json",
        repoRoot,
      ),
      "utf8",
    ),
  );
}

test("activation policy preserves every blocker-to-surface association from the acceptance manifest", async () => {
  const value = await manifest();
  const manifestIssues = new Set(value.blockers.map((entry) => entry.issue));

  assert.deepEqual([...STOREFRONT_DEPENDENCY_ISSUES], [
    97,
    98,
    100,
    101,
    102,
    104,
    107,
    108,
  ]);

  for (const entry of value.blockers) {
    for (const surface of entry.activationSurfaces) {
      assert.ok(
        Object.hasOwn(STOREFRONT_ACTIVATION_REQUIREMENTS, surface),
        `issue #${entry.issue} references unknown surface ${surface}`,
      );
      assert.ok(
        STOREFRONT_ACTIVATION_REQUIREMENTS[surface].includes(entry.issue),
        `surface ${surface} must remain blocked on issue #${entry.issue}`,
      );
    }
  }

  for (const [surface, issues] of Object.entries(
    STOREFRONT_ACTIVATION_REQUIREMENTS,
  )) {
    assert.ok(issues.length > 0, `${surface} requires at least one blocker`);
    assert.equal(new Set(issues).size, issues.length, `${surface} duplicate issues`);
    for (const issue of issues) {
      assert.ok(manifestIssues.has(issue), `${surface} uses undocumented issue #${issue}`);
    }
  }
});

test("every protected surface denies activation when no dependency is verified", () => {
  for (const surface of Object.keys(STOREFRONT_ACTIVATION_REQUIREMENTS)) {
    const decision = evaluateStorefrontDependencyActivationV1(surface, []);
    assert.equal(decision.allowed, false, surface);
    assert.deepEqual(decision.missingIssues, decision.requiredIssues, surface);
  }
});

test("every protected surface allows only when all of its required issues are verified", () => {
  for (const [surface, requiredIssues] of Object.entries(
    STOREFRONT_ACTIVATION_REQUIREMENTS,
  )) {
    const allowed = evaluateStorefrontDependencyActivationV1(
      surface,
      requiredIssues,
    );
    assert.equal(allowed.allowed, true, surface);
    assert.deepEqual(allowed.missingIssues, [], surface);

    for (const omitted of requiredIssues) {
      const verified = STOREFRONT_DEPENDENCY_ISSUES.filter(
        (issue) => issue !== omitted,
      );
      const denied = evaluateStorefrontDependencyActivationV1(surface, verified);
      assert.equal(
        denied.allowed,
        false,
        `${surface} must remain blocked without #${omitted}`,
      );
      assert.deepEqual(denied.missingIssues, [omitted]);
    }
  }
});

test("checkout capability and submit require price-shipping, payment and country policy together", () => {
  assert.deepEqual(STOREFRONT_ACTIVATION_REQUIREMENTS.checkout_capabilities, [
    97,
    98,
    100,
  ]);
  assert.deepEqual(STOREFRONT_ACTIVATION_REQUIREMENTS.checkout_submit, [
    97,
    98,
    100,
  ]);

  for (const verified of [
    [97],
    [98],
    [100],
    [97, 98],
    [97, 100],
    [98, 100],
  ]) {
    assert.equal(
      evaluateStorefrontDependencyActivationV1(
        "checkout_capabilities",
        verified,
      ).allowed,
      false,
      verified.join(","),
    );
    assert.equal(
      evaluateStorefrontDependencyActivationV1("checkout_submit", verified)
        .allowed,
      false,
      verified.join(","),
    );
  }
});

test("buyer return and support require trusted customer binding plus buyer-safe return authority", () => {
  assert.deepEqual(STOREFRONT_ACTIVATION_REQUIREMENTS.buyer_return_request, [
    101,
    102,
  ]);
  assert.deepEqual(STOREFRONT_ACTIVATION_REQUIREMENTS.buyer_support_request, [
    101,
    102,
  ]);

  for (const surface of ["buyer_return_request", "buyer_support_request"]) {
    assert.equal(
      evaluateStorefrontDependencyActivationV1(surface, [101]).allowed,
      false,
    );
    assert.equal(
      evaluateStorefrontDependencyActivationV1(surface, [102]).allowed,
      false,
    );
    assert.equal(
      evaluateStorefrontDependencyActivationV1(surface, [101, 102]).allowed,
      true,
    );
  }
});

test("unknown issue numbers cannot be used as substitute activation evidence", () => {
  assert.throws(
    () => evaluateStorefrontDependencyActivationV1("public_cart_quote", [999]),
    /Unsupported storefront dependency issue: 999/u,
  );
  assert.throws(
    () =>
      evaluateStorefrontDependencyActivationV1("checkout_capabilities", [
        97,
        98,
        999,
      ]),
    /Unsupported storefront dependency issue: 999/u,
  );
});

test("assertion helper fails closed with exact missing blockers and passes only after full readiness", () => {
  assert.throws(
    () => assertStorefrontDependencyActivationV1("checkout_submit", [97, 98]),
    /#100/u,
  );
  assert.doesNotThrow(() =>
    assertStorefrontDependencyActivationV1("checkout_submit", [97, 98, 100]),
  );
});
