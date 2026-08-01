import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStorefrontAbusePolicyV1,
  createStorefrontAbuseControlRequestV1,
  enforceStorefrontAbuseDecisionV1,
  parseStorefrontAbuseControlDecisionV1,
  parseStorefrontAbuseKeyV1,
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
const sessionKey = Object.freeze({
  keyVersion: "storefront-abuse-key.v1",
  source: "authenticated_session",
  opaqueKey: "session_K2mP8vR4xT7qN5zW",
});

function decision(overrides = {}) {
  return {
    decisionVersion: "storefront-abuse-control-decision.v1",
    state: "allow",
    reason: "within_limit",
    policyRevision: "storefront-abuse:v1",
    retryAfterSeconds: null,
    ...overrides,
  };
}

test("route classification separates public, private, checkout and admin policies", () => {
  const cases = [
    [{ method: "GET", pathname: "/products/linen-shirt", authenticated: false }, "public_read"],
    [{ method: "GET", pathname: "/search", authenticated: false }, "public_search"],
    [{ method: "GET", pathname: "/media/catalog/item.webp", authenticated: false }, "public_media"],
    [{ method: "GET", pathname: "/account/orders", authenticated: true }, "private_read"],
    [{ method: "GET", pathname: "/account/orders", authenticated: false }, null],
    [{ method: "POST", pathname: "/v1/storefront/cart/quote", authenticated: false }, "checkout_quote"],
    [{ method: "POST", pathname: "/v1/storefront/checkout/capabilities", authenticated: false }, "checkout_quote"],
    [{ method: "POST", pathname: "/v1/storefront/checkout/submit", authenticated: true }, "checkout_submit"],
    [{ method: "POST", pathname: "/v1/storefront/storefronts", authenticated: true }, "admin_mutation"],
    [{ method: "GET", pathname: "/health", authenticated: false }, null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(classifyStorefrontAbusePolicyV1(input), expected, JSON.stringify(input));
  }
});

test("abuse keys require trusted opaque tokens and reject raw network identity fields", () => {
  assert.deepEqual(parseStorefrontAbuseKeyV1(edgeKey), edgeKey);
  assert.deepEqual(parseStorefrontAbuseKeyV1(sessionKey), sessionKey);

  assert.throws(
    () => parseStorefrontAbuseKeyV1({ ...edgeKey, opaqueKey: "203.0.113.10" }),
    /opaque base64url-like token/u,
  );
  assert.throws(
    () => parseStorefrontAbuseKeyV1({ ...edgeKey, rawIp: "203.0.113.10" }),
    /unsupported fields: rawIp/u,
  );
  assert.throws(
    () => parseStorefrontAbuseKeyV1({ ...edgeKey, source: "x_forwarded_for" }),
    /source is unsupported/u,
  );
});

test("spoofed client forwarding headers cannot select the abuse key", () => {
  const request = new Request("https://shop.example.com/search?q=linen", {
    headers: {
      "X-Forwarded-For": "198.51.100.77",
      "CF-Connecting-IP": "198.51.100.78",
      "True-Client-IP": "198.51.100.79",
    },
  });
  const result = createStorefrontAbuseControlRequestV1({
    request,
    context,
    authenticated: false,
    abuseKey: edgeKey,
  });

  assert.equal(result.policyClass, "public_search");
  assert.equal(result.abuseKey.opaqueKey, edgeKey.opaqueKey);
  assert.equal(JSON.stringify(result).includes("198.51.100"), false);
  assert.equal(result.unavailableMode, "fail_open_observe");
});

test("authenticated requests require session-derived opaque keys and anonymous requests require edge keys", () => {
  const privateRequest = new Request("https://shop.example.com/account/orders");
  const privateResult = createStorefrontAbuseControlRequestV1({
    request: privateRequest,
    context,
    authenticated: true,
    abuseKey: sessionKey,
  });
  assert.equal(privateResult.policyClass, "private_read");
  assert.equal(privateResult.unavailableMode, "fail_open_observe");

  assert.throws(
    () => createStorefrontAbuseControlRequestV1({
      request: privateRequest,
      context,
      authenticated: true,
      abuseKey: edgeKey,
    }),
    /authenticated-session key/u,
  );

  const publicRequest = new Request("https://shop.example.com/products/linen-shirt");
  assert.throws(
    () => createStorefrontAbuseControlRequestV1({
      request: publicRequest,
      context,
      authenticated: false,
      abuseKey: sessionKey,
    }),
    /trusted-edge key/u,
  );
});

test("checkout and admin policies fail closed when distributed abuse control is unavailable", async () => {
  for (const url of [
    "https://shop.example.com/v1/storefront/cart/quote",
    "https://shop.example.com/v1/storefront/checkout/submit",
    "https://shop.example.com/v1/storefront/storefronts",
  ]) {
    const authenticated = url.endsWith("checkout/submit") || url.endsWith("storefronts");
    const request = createStorefrontAbuseControlRequestV1({
      request: new Request(url, { method: "POST" }),
      context,
      authenticated,
      abuseKey: authenticated ? sessionKey : edgeKey,
    });
    assert.equal(request.unavailableMode, "fail_closed");
    const response = enforceStorefrontAbuseDecisionV1({
      request,
      decision: decision({
        state: "unavailable",
        reason: "provider_unavailable",
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: { code: "STOREFRONT_ABUSE_CONTROL_UNAVAILABLE" },
    });
  }
});

test("public read/search unavailable decisions fail open without fabricating a limit result", () => {
  for (const pathname of ["/products/linen-shirt", "/search"]) {
    const request = createStorefrontAbuseControlRequestV1({
      request: new Request(`https://shop.example.com${pathname}`),
      context,
      authenticated: false,
      abuseKey: edgeKey,
    });
    assert.equal(request.unavailableMode, "fail_open_observe");
    assert.equal(
      enforceStorefrontAbuseDecisionV1({
        request,
        decision: decision({ state: "unavailable", reason: "provider_unavailable" }),
      }),
      null,
    );
  }
});

test("denied decisions return bounded 429 semantics without internal policy detail", async () => {
  const request = createStorefrontAbuseControlRequestV1({
    request: new Request("https://shop.example.com/search?q=linen"),
    context,
    authenticated: false,
    abuseKey: edgeKey,
  });
  const response = enforceStorefrontAbuseDecisionV1({
    request,
    decision: decision({
      state: "deny",
      reason: "rate_limited",
      policyRevision: "provider-secret-policy-revision-17",
      retryAfterSeconds: 45,
    }),
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "45");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const payload = await response.text();
  assert.equal(payload.includes("provider-secret-policy-revision-17"), false);
  assert.deepEqual(JSON.parse(payload), {
    error: { code: "STOREFRONT_RATE_LIMITED" },
  });
});

test("decision parser rejects inconsistent and unbounded provider output", () => {
  assert.deepEqual(parseStorefrontAbuseControlDecisionV1(decision()), decision());
  assert.throws(
    () => parseStorefrontAbuseControlDecisionV1(decision({ state: "deny", reason: "within_limit" })),
    /Denied abuse-control decisions/u,
  );
  assert.throws(
    () => parseStorefrontAbuseControlDecisionV1(decision({
      state: "deny",
      reason: "rate_limited",
      retryAfterSeconds: 86_401,
    })),
    /between 1 and 86400/u,
  );
  assert.throws(
    () => parseStorefrontAbuseControlDecisionV1({ ...decision(), rawKey: "secret" }),
    /unsupported fields: rawKey/u,
  );
});
