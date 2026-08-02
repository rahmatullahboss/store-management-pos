import assert from "node:assert/strict";
import test from "node:test";

import {
  createStorefrontDistributedAbuseProviderRequestV1,
  mapStorefrontDistributedAbuseProviderResultV1,
  parseStorefrontDistributedAbuseProviderResultV1,
} from "../../build/modules/storefront/src/abuse-control-provider-bridge.js";
import {
  createStorefrontAbuseControlRequestV1,
} from "../../build/modules/storefront/src/abuse-control.js";

const context = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v7",
  publicationGeneration: "publication:19",
});

const edgeKey = Object.freeze({
  keyVersion: "storefront-abuse-key.v1",
  source: "trusted_edge",
  opaqueKey: "edge_9M7g2pQ4kT8xV6nR",
});

function providerResult(overrides = {}) {
  return {
    resultVersion: "storefront-distributed-abuse-provider-result.v1",
    source: "trusted-distributed-provider",
    state: "allow",
    reason: "within_limit",
    policyRevision: "distributed-abuse:v3",
    retryAfterSeconds: null,
    ...overrides,
  };
}

test("provider request contains only trusted normalized scope and opaque key material", () => {
  const request = new Request("https://shop.example.com/search?q=linen", {
    headers: {
      "X-Forwarded-For": "198.51.100.77",
      "CF-Connecting-IP": "198.51.100.78",
      "True-Client-IP": "198.51.100.79",
    },
  });
  const abuseRequest = createStorefrontAbuseControlRequestV1({
    request,
    context,
    authenticated: false,
    abuseKey: edgeKey,
  });
  const providerRequest = createStorefrontDistributedAbuseProviderRequestV1(abuseRequest);

  assert.deepEqual(providerRequest, {
    requestVersion: "storefront-distributed-abuse-provider-request.v1",
    source: "trusted-storefront-runtime",
    policyClass: "public_search",
    unavailableMode: "fail_open_observe",
    tenantId: "tenant-1",
    storefrontId: "storefront-1",
    requestHostname: "shop.example.com",
    identityClass: "anonymous",
    keySource: "trusted_edge",
    opaqueKey: edgeKey.opaqueKey,
  });
  const serialized = JSON.stringify(providerRequest);
  assert.equal(serialized.includes("198.51.100"), false);
  assert.equal(serialized.includes("X-Forwarded-For"), false);
  assert.equal(serialized.includes("CF-Connecting-IP"), false);
});

test("provider request revalidates authenticated versus anonymous key source", () => {
  assert.throws(
    () => createStorefrontDistributedAbuseProviderRequestV1({
      requestVersion: "storefront-abuse-control-request.v1",
      policyClass: "private_read",
      unavailableMode: "fail_open_observe",
      tenantId: "tenant-1",
      storefrontId: "storefront-1",
      requestHostname: "shop.example.com",
      authenticated: true,
      abuseKey: edgeKey,
    }),
    /authenticated-session key/u,
  );
});

test("trusted distributed provider result maps to the existing strict abuse decision", () => {
  assert.deepEqual(parseStorefrontDistributedAbuseProviderResultV1(providerResult()), providerResult());
  assert.deepEqual(mapStorefrontDistributedAbuseProviderResultV1(providerResult({
    state: "deny",
    reason: "rate_limited",
    retryAfterSeconds: 30,
  })), {
    decisionVersion: "storefront-abuse-control-decision.v1",
    state: "deny",
    reason: "rate_limited",
    policyRevision: "distributed-abuse:v3",
    retryAfterSeconds: 30,
  });
});

test("provider result rejects untrusted sources and provider-internal leakage", () => {
  assert.throws(
    () => parseStorefrontDistributedAbuseProviderResultV1(providerResult({ source: "browser" })),
    /source is not trusted/u,
  );

  for (const [key, value] of [
    ["rawIp", "203.0.113.10"],
    ["providerRuleId", "rule-secret-17"],
    ["providerToken", "token-secret"],
    ["rawFingerprint", "fingerprint-secret"],
    ["metadata", { freeform: true }],
  ]) {
    assert.throws(
      () => parseStorefrontDistributedAbuseProviderResultV1({
        ...providerResult(),
        [key]: value,
      }),
      new RegExp(`unsupported fields: ${key}`, "u"),
    );
  }
});

test("provider result preserves strict state/reason/retry semantics", () => {
  assert.throws(
    () => parseStorefrontDistributedAbuseProviderResultV1(providerResult({
      state: "allow",
      reason: "rate_limited",
    })),
    /Allowed abuse-control decisions/u,
  );
  assert.throws(
    () => parseStorefrontDistributedAbuseProviderResultV1(providerResult({
      state: "deny",
      reason: "rate_limited",
      retryAfterSeconds: 86_401,
    })),
    /between 1 and 86400/u,
  );
});
