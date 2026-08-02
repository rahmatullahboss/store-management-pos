import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveStorefrontDomainLifecycleViewV1,
  parseStorefrontDomainLifecycleSnapshotV1,
} from "../../build/modules/storefront/src/domain-lifecycle.js";

const domainId = "018f0000-0000-4000-8000-000000000801";
const storefrontId = "018f0000-0000-4000-8000-000000000802";

function snapshot(overrides = {}) {
  return {
    snapshotVersion: "storefront-domain-lifecycle-snapshot.v1",
    domainId,
    storefrontId,
    hostname: "shop.example.com",
    kind: "custom",
    status: "verification_pending",
    certificateStatus: "none",
    verificationStatus: "pending",
    canonical: false,
    updatedAt: "2026-08-01T20:00:00.000Z",
    ...overrides,
  };
}

test("domain lifecycle snapshot strict parser excludes provider and challenge authority", () => {
  assert.deepEqual(parseStorefrontDomainLifecycleSnapshotV1(snapshot()), snapshot());

  for (const forbidden of [
    ["providerHostnameId", "provider-hostname-secret"],
    ["providerReference", "provider-reference-secret"],
    ["challengeValueHash", "a".repeat(64)],
    ["challengeValue", "dns-secret"],
    ["failureDetail", "provider-internal-detail"],
  ]) {
    assert.throws(
      () => parseStorefrontDomainLifecycleSnapshotV1(snapshot({ [forbidden[0]]: forbidden[1] })),
      new RegExp(`unsupported fields: ${forbidden[0]}`, "u"),
    );
  }
});

test("domain lifecycle derives only read-only local phases", () => {
  const cases = [
    [snapshot({ status: "pending", verificationStatus: "none" }), "setup_pending"],
    [snapshot(), "ownership_pending"],
    [snapshot({ status: "certificate_pending", verificationStatus: "verified", certificateStatus: "pending" }), "certificate_pending"],
    [snapshot({ status: "active", verificationStatus: "verified", certificateStatus: "active", canonical: true }), "active"],
    [snapshot({ status: "failed", verificationStatus: "failed", certificateStatus: "failed" }), "attention"],
    [snapshot({ status: "active", verificationStatus: "verified", certificateStatus: "expiring" }), "attention"],
    [snapshot({ status: "suspended", verificationStatus: "verified", certificateStatus: "active" }), "suspended"],
    [snapshot({ status: "deleting", verificationStatus: "verified", certificateStatus: "revoked" }), "removing"],
    [snapshot({ status: "deleted", verificationStatus: "verified", certificateStatus: "revoked" }), "removed"],
  ];

  for (const [input, expectedPhase] of cases) {
    assert.equal(
      deriveStorefrontDomainLifecycleViewV1(input, { providerControlAvailable: false }).phase,
      expectedPhase,
    );
  }
});

test("provider-unavailable lifecycle guidance never exposes an activation action", () => {
  const pending = deriveStorefrontDomainLifecycleViewV1(snapshot(), {
    providerControlAvailable: false,
  });
  assert.equal(pending.recommendedAction, "review_configuration");
  assert.equal(pending.providerControlAvailable, false);

  const active = deriveStorefrontDomainLifecycleViewV1(
    snapshot({
      status: "active",
      verificationStatus: "verified",
      certificateStatus: "active",
      canonical: true,
    }),
    { providerControlAvailable: false },
  );
  assert.equal(active.recommendedAction, "none");

  const failed = deriveStorefrontDomainLifecycleViewV1(
    snapshot({
      status: "failed",
      verificationStatus: "failed",
      certificateStatus: "failed",
    }),
    { providerControlAvailable: false },
  );
  assert.equal(failed.recommendedAction, "contact_support");

  for (const view of [pending, active, failed]) {
    assert.equal("providerHostnameId" in view, false);
    assert.equal("providerReference" in view, false);
    assert.equal("challengeValue" in view, false);
    assert.equal("markVerified" in view, false);
    assert.equal("activate" in view, false);
  }
});

test("trusted provider availability changes guidance, not local authority facts", () => {
  const unavailable = deriveStorefrontDomainLifecycleViewV1(snapshot(), {
    providerControlAvailable: false,
  });
  const available = deriveStorefrontDomainLifecycleViewV1(snapshot(), {
    providerControlAvailable: true,
  });

  assert.equal(unavailable.phase, available.phase);
  assert.equal(unavailable.status, available.status);
  assert.equal(unavailable.verificationStatus, available.verificationStatus);
  assert.equal(unavailable.certificateStatus, available.certificateStatus);
  assert.equal(unavailable.recommendedAction, "review_configuration");
  assert.equal(available.recommendedAction, "wait_for_provider");
});

test("active presentation requires all local active facts at once", () => {
  for (const input of [
    snapshot({ status: "active", verificationStatus: "pending", certificateStatus: "active" }),
    snapshot({ status: "active", verificationStatus: "verified", certificateStatus: "pending" }),
    snapshot({ status: "certificate_pending", verificationStatus: "verified", certificateStatus: "active" }),
  ]) {
    assert.notEqual(
      deriveStorefrontDomainLifecycleViewV1(input, { providerControlAvailable: true }).phase,
      "active",
    );
  }
});
