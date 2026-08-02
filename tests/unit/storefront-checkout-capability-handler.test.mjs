import assert from "node:assert/strict";
import test from "node:test";

import { handleStorefrontCheckoutCapabilityRequest } from "../../build/apps/api/src/modules/storefront/checkout-capability-handler.js";

const quoteId = "018f0000-0000-4000-8000-000000000301";
const context = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});
const bootstrap = Object.freeze({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "theme:3",
  layoutRevision: "layout:4",
  capabilities: Object.freeze([]),
});

function payload(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-capability-request.v1",
    quoteId,
    quoteRevision: "3",
    cartRevision: "7",
    destination: null,
    shippingOptionId: null,
    paymentCapabilityId: null,
    ...overrides,
  };
}

function envelope() {
  return {
    contractVersion: "storefront-checkout-capability-envelope.v1",
    context,
    quoteId,
    quoteRevision: "3",
    quoteExpiresAt: "2030-08-01T18:00:00.000Z",
    state: "ready",
    shippingOptions: [],
    paymentCapabilities: [],
    authority: {
      quoteAuthorityToken: "quote:authority:1",
      countryPolicyRevision: "country-policy:1",
      shippingRevision: "shipping:1",
      paymentRevision: "payment:1",
    },
    changedReasons: [],
  };
}

function request(body = payload(), method = "POST") {
  return new Request("https://api.example.com/v1/storefront/checkout/capabilities?hostname=shop.example.com", {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function repository(value = bootstrap) {
  return { async resolveBootstrap() { return value; } };
}

test("checkout capability handler returns no-store canonical envelope", async () => {
  const req = request();
  const response = await handleStorefrontCheckoutCapabilityRequest(
    repository(),
    { async resolve() { return envelope(); } },
    req,
    new URL(req.url),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/u);
  assert.equal((await response.json()).quoteId, quoteId);
});

test("checkout capability handler rejects unsupported methods", async () => {
  const req = request(undefined, "GET");
  const response = await handleStorefrontCheckoutCapabilityRequest(
    repository(),
    { async resolve() { return envelope(); } },
    req,
    new URL(req.url),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("checkout capability handler rejects browser commercial fields before authority", async () => {
  let calls = 0;
  const req = request({ ...payload(), shippingAmount: { currency: "GBP", minor: "1", scale: 2 } });
  const response = await handleStorefrontCheckoutCapabilityRequest(
    repository(),
    { async resolve() { calls += 1; return envelope(); } },
    req,
    new URL(req.url),
  );

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error.code, "INVALID_CHECKOUT_CAPABILITY_REQUEST");
});

test("checkout capability handler returns 404 without calling authority for unknown host", async () => {
  let calls = 0;
  const req = request();
  const response = await handleStorefrontCheckoutCapabilityRequest(
    repository(null),
    { async resolve() { calls += 1; return envelope(); } },
    req,
    new URL(req.url),
  );

  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});
