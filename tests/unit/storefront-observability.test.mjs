import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorefrontOperationalEventV1,
  serializeStorefrontOperationalEventV1,
} from "../../build/modules/storefront/src/observability.js";

function event(overrides = {}) {
  return {
    eventVersion: "storefront-operational-event.v1",
    eventName: "storefront.abuse_control.decision",
    occurredAt: "2026-08-02T01:00:00.000Z",
    severity: "warn",
    outcome: "denied",
    reason: "rate_limited",
    requestId: "request-018f0000",
    traceId: "trace-018f0000",
    tenantId: "tenant-1",
    storefrontId: "storefront-1",
    salesChannelId: "channel-1",
    cacheFamily: null,
    abusePolicyClass: "public_search",
    domainPhase: null,
    ...overrides,
  };
}

test("operational event accepts only bounded low-cardinality diagnostic dimensions", () => {
  assert.deepEqual(parseStorefrontOperationalEventV1(event()), event());

  const domain = event({
    eventName: "storefront.domain.lifecycle",
    outcome: "stale",
    reason: "certificate_expiring",
    cacheFamily: null,
    abusePolicyClass: null,
    domainPhase: "attention",
  });
  assert.deepEqual(parseStorefrontOperationalEventV1(domain), domain);

  const cache = event({
    eventName: "storefront.cache.decision",
    outcome: "bypass",
    reason: "private_route",
    cacheFamily: "product",
    abusePolicyClass: null,
  });
  assert.deepEqual(parseStorefrontOperationalEventV1(cache), cache);
});

test("operational envelope rejects customer, hostname, provider, abuse and storage secrets", () => {
  const forbidden = [
    ["customerId", "018f0000-0000-4000-8000-000000000999"],
    ["requestHostname", "private-customer.example.com"],
    ["abuseKey", "edge_secret_key_material"],
    ["providerHostnameId", "provider-secret"],
    ["providerReference", "provider-reference-secret"],
    ["paymentIntentId", "pi_secret"],
    ["objectKey", "r2/private/customer/document.pdf"],
    ["metadata", { anything: "free-form" }],
  ];

  for (const [key, value] of forbidden) {
    assert.throws(
      () => parseStorefrontOperationalEventV1(event({ [key]: value })),
      new RegExp(`unsupported fields: ${key}`, "u"),
    );
  }
});

test("serialized event cannot leak rejected sensitive values", () => {
  const serialized = serializeStorefrontOperationalEventV1(event());
  for (const forbidden of [
    "203.0.113.10",
    "buyer@example.com",
    "provider-secret",
    "payment-intent-secret",
    "r2/private",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("reason and identifiers are bounded safe tokens rather than free-form log messages", () => {
  assert.throws(
    () => parseStorefrontOperationalEventV1(event({ reason: "provider failed: secret token=abc" })),
    /reason is invalid/u,
  );
  assert.throws(
    () => parseStorefrontOperationalEventV1(event({ requestId: "request id with spaces" })),
    /requestId must be a bounded safe token/u,
  );
  assert.throws(
    () => parseStorefrontOperationalEventV1(event({ tenantId: "tenant/customer@example.com" })),
    /tenantId must be a bounded safe token/u,
  );
});

test("event taxonomy rejects arbitrary event names and high-cardinality dimensions", () => {
  assert.throws(
    () => parseStorefrontOperationalEventV1(event({ eventName: "storefront.anything.user_input" })),
    /event name is unsupported/u,
  );
  assert.throws(
    () => parseStorefrontOperationalEventV1(event({ cacheFamily: "resource:linen-shirt" })),
    /cacheFamily is unsupported/u,
  );
  assert.throws(
    () => parseStorefrontOperationalEventV1(event({ abusePolicyClass: "customer-018f" })),
    /abusePolicyClass is unsupported/u,
  );
});
