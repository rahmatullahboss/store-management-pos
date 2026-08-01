import assert from "node:assert/strict";
import test from "node:test";

import { requestStorefrontCheckoutCapabilities } from "../../build/packages/storefront-client/src/checkout-capabilities.js";

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

function envelope(overrides = {}) {
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
    ...overrides,
  };
}

test("checkout capability client joins base path safely and sends only parsed buyer intent", async () => {
  let observedUrl;
  let observedInit;
  const result = await requestStorefrontCheckoutCapabilities(
    {
      baseUrl: "https://api.example.com/root/",
      transport: {
        async fetch(input, init) {
          observedUrl = input.toString();
          observedInit = init;
          return new Response(JSON.stringify(envelope()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
    "SHOP.EXAMPLE.COM.",
    payload(),
  );

  assert.equal(
    observedUrl,
    "https://api.example.com/root/v1/storefront/checkout/capabilities?hostname=shop.example.com",
  );
  assert.equal(observedInit.method, "POST");
  assert.equal(observedInit.cache, "no-store");
  assert.equal(JSON.parse(observedInit.body).quoteId, quoteId);
  assert.equal(result.quoteRevision, "3");
});

test("checkout capability client preserves HTTP failure status", async () => {
  await assert.rejects(
    requestStorefrontCheckoutCapabilities(
      {
        baseUrl: "https://api.example.com",
        transport: { async fetch() { return new Response("{}", { status: 409 }); } },
      },
      "shop.example.com",
      payload(),
    ),
    (error) => error.status === 409,
  );
});

test("checkout capability client rejects authority scope mismatch", async () => {
  await assert.rejects(
    requestStorefrontCheckoutCapabilities(
      {
        baseUrl: "https://api.example.com",
        transport: {
          async fetch() {
            return new Response(
              JSON.stringify(envelope({ quoteRevision: "4" })),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          },
        },
      },
      "shop.example.com",
      payload(),
    ),
    /scope mismatch/u,
  );
});

test("checkout capability client rejects unsafe base URLs", async () => {
  await assert.rejects(
    requestStorefrontCheckoutCapabilities(
      { baseUrl: "http://api.example.com" },
      "shop.example.com",
      payload(),
    ),
    /safe HTTPS/u,
  );
});
