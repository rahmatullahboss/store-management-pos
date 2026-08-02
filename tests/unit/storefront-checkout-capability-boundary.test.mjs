import assert from "node:assert/strict";
import test from "node:test";

import { resolveStorefrontCheckoutCapabilities } from "../../build/modules/storefront/src/checkout-capabilities.js";

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
  capabilities: Object.freeze(["catalog.read"]),
});

function money(minor) {
  return { currency: "GBP", minor, scale: 2 };
}

function requestPayload(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-capability-request.v1",
    quoteId,
    quoteRevision: "3",
    cartRevision: "7",
    destination: { countryCode: "GB", regionCode: null, postalCode: null, city: null },
    shippingOptionId: "shipping:pickup:1",
    paymentCapabilityId: "payment:card:1",
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-capability-envelope.v1",
    context,
    quoteId,
    quoteRevision: "3",
    quoteExpiresAt: "2026-08-01T18:00:00.000Z",
    state: "ready",
    shippingOptions: [
      {
        optionId: "shipping:pickup:1",
        method: "pickup",
        label: "Collect from store",
        amount: money("0"),
        expiresAt: "2026-08-01T17:30:00.000Z",
        version: "shipping:v4",
      },
    ],
    paymentCapabilities: [
      {
        capabilityId: "payment:card:1",
        providerCapability: "provider:card",
        kind: "card",
        label: "Card",
        requiresAction: true,
        expiresAt: "2026-08-01T17:30:00.000Z",
        version: "payment:v8",
      },
    ],
    authority: {
      quoteAuthorityToken: "quote:authority:abc123",
      countryPolicyRevision: "country-policy:v2",
      shippingRevision: "shipping:v4",
      paymentRevision: "payment:v8",
    },
    changedReasons: [],
    ...overrides,
  };
}

function repository(value = bootstrap) {
  return {
    observedHostname: null,
    async resolveBootstrap(hostname) {
      this.observedHostname = hostname;
      return value;
    },
  };
}

test("checkout capability boundary resolves host context and forwards parsed buyer choices", async () => {
  const repo = repository();
  let observed;
  const result = await resolveStorefrontCheckoutCapabilities(
    repo,
    {
      async resolve(input) {
        observed = input;
        return envelope();
      },
    },
    "SHOP.EXAMPLE.COM.",
    requestPayload(),
    { now: () => "2026-08-01T17:00:00.000Z" },
  );

  assert.equal(repo.observedHostname, "shop.example.com");
  assert.deepEqual(observed.context, context);
  assert.equal(observed.request.destination.countryCode, "GB");
  assert.equal("shippingAmount" in observed.request, false);
  assert.equal(result.quoteId, quoteId);
});

test("checkout capability boundary does not call authority for an unavailable storefront", async () => {
  let calls = 0;
  const result = await resolveStorefrontCheckoutCapabilities(
    repository(null),
    {
      async resolve() {
        calls += 1;
        return envelope();
      },
    },
    "shop.example.com",
    requestPayload(),
  );

  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("checkout capability boundary fails closed on host or quote scope mismatch", async () => {
  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      {
        async resolve() {
          return envelope({ context: { ...context, storefrontId: "storefront-2" } });
        },
      },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /mismatched storefront context/u,
  );

  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      { async resolve() { return envelope({ quoteRevision: "2" }); } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /stale quote revision/u,
  );
});

test("ready checkout capability boundary rejects omitted selected choices", async () => {
  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      { async resolve() { return envelope({ shippingOptions: [] }); } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /omitted the selected shipping option/u,
  );

  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      { async resolve() { return envelope({ paymentCapabilities: [] }); } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /omitted the selected payment capability/u,
  );
});

test("changed capability state may remove stale choices but must remain explicit", async () => {
  const result = await resolveStorefrontCheckoutCapabilities(
    repository(),
    {
      async resolve() {
        return envelope({
          state: "changed",
          shippingOptions: [],
          paymentCapabilities: [],
          changedReasons: ["shipping", "payment"],
        });
      },
    },
    "shop.example.com",
    requestPayload(),
    { now: () => "2026-08-01T17:00:00.000Z" },
  );

  assert.equal(result.state, "changed");
  assert.deepEqual(result.changedReasons, ["shipping", "payment"]);
});

test("ready capability state rejects expired quote, shipping or payment evidence", async () => {
  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      { async resolve() { return envelope({ quoteExpiresAt: "2026-08-01T16:59:59.000Z" }); } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /expired quote/u,
  );

  const expiredShipping = envelope();
  expiredShipping.shippingOptions[0].expiresAt = "2026-08-01T16:59:59.000Z";
  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      { async resolve() { return expiredShipping; } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /expired shipping option/u,
  );

  const expiredPayment = envelope();
  expiredPayment.paymentCapabilities[0].expiresAt = "2026-08-01T16:59:59.000Z";
  await assert.rejects(
    resolveStorefrontCheckoutCapabilities(
      repository(),
      { async resolve() { return expiredPayment; } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /expired payment capability/u,
  );
});
