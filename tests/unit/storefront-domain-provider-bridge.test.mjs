import assert from "node:assert/strict";
import test from "node:test";

import {
  mapStorefrontTrustedDomainLifecycleObservationV1,
  mapStorefrontTrustedDomainVerificationObservationV1,
  parseStorefrontTrustedDomainLifecycleObservationV1,
  parseStorefrontTrustedDomainVerificationObservationV1,
} from "../../build/modules/storefront/src/domain-provider-bridge.js";

const domainId = "018f0000-0000-4000-8000-000000000801";
const challengeHash = "a".repeat(64);

function verification(overrides = {}) {
  return {
    observationVersion: "storefront-trusted-domain-verification-observation.v1",
    source: "trusted-control-plane",
    observationId: "cf-verification-000001",
    domainId,
    attempt: 2,
    challengeType: "dns_txt",
    challengeName: "_storefront-verify.shop.example.com",
    challengeValueHash: challengeHash,
    verificationStatus: "verified",
    providerReference: "cf-verification-ref-01",
    observedAt: "2026-08-02T02:00:00.000Z",
    expiresAt: "2026-08-02T03:00:00.000Z",
    ...overrides,
  };
}

function lifecycle(overrides = {}) {
  return {
    observationVersion: "storefront-trusted-domain-lifecycle-observation.v1",
    source: "trusted-control-plane",
    observationId: "cf-lifecycle-000001",
    domainId,
    status: "active",
    certificateStatus: "active",
    providerHostnameId: "cf-hostname-000001",
    failureCode: null,
    observedAt: "2026-08-02T02:05:00.000Z",
    ...overrides,
  };
}

test("trusted verification observation maps to a bounded internal command without free-form provider detail", () => {
  assert.deepEqual(
    parseStorefrontTrustedDomainVerificationObservationV1(verification()),
    verification(),
  );

  const command = mapStorefrontTrustedDomainVerificationObservationV1(
    verification(),
  );
  assert.deepEqual(command, {
    domainId,
    attempt: 2,
    challengeType: "dns_txt",
    challengeName: "_storefront-verify.shop.example.com",
    challengeValueHash: challengeHash,
    resultStatus: "verified",
    providerReference: "cf-verification-ref-01",
    observedDetail: {
      source: "trusted-control-plane",
      observationId: "cf-verification-000001",
    },
    observedAt: "2026-08-02T02:00:00.000Z",
    expiresAt: "2026-08-02T03:00:00.000Z",
    idempotencyKey: "domain-provider-verification:cf-verification-000001",
  });
  assert.equal("providerToken" in command, false);
  assert.equal("failureDetail" in command, false);
});

test("verification bridge rejects tenant-style authority and raw provider metadata", () => {
  for (const [field, value] of [
    ["canonical", true],
    ["providerToken", "secret-token"],
    ["observedDetail", { raw: "provider-body" }],
    ["failureDetail", "raw provider error body"],
  ]) {
    assert.throws(
      () =>
        parseStorefrontTrustedDomainVerificationObservationV1(
          verification({ [field]: value }),
        ),
      new RegExp(`unsupported fields: ${field}`, "u"),
    );
  }
});

test("verification observation enforces trusted source, digest, attempt and time ordering", () => {
  assert.throws(
    () =>
      parseStorefrontTrustedDomainVerificationObservationV1(
        verification({ source: "tenant-request" }),
      ),
    /source is unsupported/u,
  );
  assert.throws(
    () =>
      parseStorefrontTrustedDomainVerificationObservationV1(
        verification({ challengeValueHash: "not-a-digest" }),
      ),
    /SHA-256 hex digest/u,
  );
  assert.throws(
    () =>
      parseStorefrontTrustedDomainVerificationObservationV1(
        verification({ attempt: 0 }),
      ),
    /between 1 and 1000/u,
  );
  assert.throws(
    () =>
      parseStorefrontTrustedDomainVerificationObservationV1(
        verification({
          observedAt: "2026-08-02T03:00:00.000Z",
          expiresAt: "2026-08-02T03:00:00.000Z",
        }),
      ),
    /expiry must be after observation/u,
  );
});

test("trusted lifecycle observation can activate only with provider hostname and active certificate", () => {
  const parsed = parseStorefrontTrustedDomainLifecycleObservationV1(lifecycle());
  assert.deepEqual(parsed, lifecycle());

  const command = mapStorefrontTrustedDomainLifecycleObservationV1(
    lifecycle(),
    { canonical: true },
  );
  assert.deepEqual(command, {
    domainId,
    status: "active",
    certificateStatus: "active",
    providerHostnameId: "cf-hostname-000001",
    canonical: true,
    idempotencyKey: "domain-provider-lifecycle:cf-lifecycle-000001",
  });

  for (const overrides of [
    { certificateStatus: "pending" },
    { providerHostnameId: null },
  ]) {
    assert.throws(
      () =>
        parseStorefrontTrustedDomainLifecycleObservationV1(
          lifecycle(overrides),
        ),
      /requires active certificate and provider hostname ID/u,
    );
  }
});

test("provider observation cannot assert canonical state or arbitrary failure detail", () => {
  for (const [field, value] of [
    ["canonical", true],
    ["failureDetail", "raw TLS issuer diagnostics"],
    ["providerToken", "secret-token"],
  ]) {
    assert.throws(
      () =>
        parseStorefrontTrustedDomainLifecycleObservationV1(
          lifecycle({ [field]: value }),
        ),
      new RegExp(`unsupported fields: ${field}`, "u"),
    );
  }

  assert.throws(
    () =>
      mapStorefrontTrustedDomainLifecycleObservationV1(
        lifecycle({ status: "suspended" }),
        { canonical: true },
      ),
    /Only an active trusted provider observation/u,
  );
});

test("failed lifecycle observation requires a low-cardinality failure code and never maps raw failure detail", () => {
  const failed = lifecycle({
    observationId: "cf-lifecycle-000002",
    status: "failed",
    certificateStatus: "failed",
    failureCode: "certificate_validation_failed",
  });
  const command = mapStorefrontTrustedDomainLifecycleObservationV1(failed, {
    canonical: false,
  });
  assert.equal(command.status, "failed");
  assert.equal(command.failureCode, "certificate_validation_failed");
  assert.equal(command.canonical, false);
  assert.equal("failureDetail" in command, false);

  assert.throws(
    () =>
      parseStorefrontTrustedDomainLifecycleObservationV1(
        lifecycle({ status: "failed", certificateStatus: "failed" }),
      ),
    /requires a failureCode/u,
  );
  assert.throws(
    () =>
      parseStorefrontTrustedDomainLifecycleObservationV1(
        lifecycle({
          status: "failed",
          certificateStatus: "failed",
          failureCode: "provider failed: token=secret",
        }),
      ),
    /low-cardinality token/u,
  );
});
