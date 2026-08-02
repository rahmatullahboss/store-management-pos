import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorefrontCheckoutCapabilityEnvelopeV1,
  parseStorefrontCheckoutCapabilityRequestV1,
} from "../../build/packages/storefront-contracts/src/checkout-capabilities.js";

const quoteId = "018f0000-0000-4000-8000-000000000301";

const context = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "bn-BD",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});

function money(minor, currency = "GBP", scale = 2) {
  return { currency, minor, scale };
}

function request(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-capability-request.v1",
    quoteId,
    quoteRevision: "3",
    cartRevision: "7",
    destination: {
      countryCode: "bd",
      regionCode: "dhaka",
      postalCode: "1205",
      city: "Dhaka",
    },
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

test("checkout capability request keeps only buyer destination and choice intent", () => {
  const parsed = parseStorefrontCheckoutCapabilityRequestV1(request());

  assert.equal(parsed.quoteRevision, "3");
  assert.equal(parsed.cartRevision, "7");
  assert.equal(parsed.destination.countryCode, "BD");
  assert.equal(parsed.destination.regionCode, "DHAKA");
  assert.equal(parsed.shippingOptionId, "shipping:pickup:1");
  assert.equal(parsed.paymentCapabilityId, "payment:card:1");
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.destination));
});

test("checkout capability request rejects browser commercial authority", () => {
  assert.throws(
    () =>
      parseStorefrontCheckoutCapabilityRequestV1({
        ...request(),
        shippingAmount: money("1"),
      }),
    /unsupported fields/u,
  );

  assert.throws(
    () =>
      parseStorefrontCheckoutCapabilityRequestV1({
        ...request(),
        total: money("100"),
        tax: money("20"),
      }),
    /unsupported fields/u,
  );
});

test("checkout capability request allows no destination or selections without inventing fallbacks", () => {
  const parsed = parseStorefrontCheckoutCapabilityRequestV1(
    request({
      destination: null,
      shippingOptionId: null,
      paymentCapabilityId: null,
    }),
  );

  assert.equal(parsed.destination, null);
  assert.equal(parsed.shippingOptionId, null);
  assert.equal(parsed.paymentCapabilityId, null);
});

test("checkout capability envelope accepts exact canonical shipping and payment evidence", () => {
  const parsed = parseStorefrontCheckoutCapabilityEnvelopeV1(envelope());

  assert.equal(parsed.state, "ready");
  assert.equal(parsed.shippingOptions[0].amount.minor, "0");
  assert.equal(parsed.paymentCapabilities[0].requiresAction, true);
  assert.equal(parsed.authority.shippingRevision, "shipping:v4");
  assert.deepEqual(parsed.changedReasons, []);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.shippingOptions));
});

test("checkout capability envelope rejects shipping currency or scale mismatch", () => {
  const wrongCurrency = envelope();
  wrongCurrency.shippingOptions[0].amount = money("0", "USD");
  assert.throws(
    () => parseStorefrontCheckoutCapabilityEnvelopeV1(wrongCurrency),
    /currency must match storefront context/u,
  );

  const mixedScale = envelope({
    shippingOptions: [
      envelope().shippingOptions[0],
      {
        ...envelope().shippingOptions[0],
        optionId: "shipping:delivery:2",
        amount: money("500", "GBP", 3),
      },
    ],
  });
  assert.throws(
    () => parseStorefrontCheckoutCapabilityEnvelopeV1(mixedScale),
    /scale must match other checkout amounts/u,
  );
});

test("checkout capability envelope requires explicit recovery reasons", () => {
  assert.throws(
    () =>
      parseStorefrontCheckoutCapabilityEnvelopeV1(
        envelope({ state: "changed", changedReasons: [] }),
      ),
    /require a reason/u,
  );

  assert.throws(
    () =>
      parseStorefrontCheckoutCapabilityEnvelopeV1(
        envelope({ state: "ready", changedReasons: ["shipping"] }),
      ),
    /cannot contain changed reasons/u,
  );

  const changed = parseStorefrontCheckoutCapabilityEnvelopeV1(
    envelope({ state: "changed", changedReasons: ["shipping", "payment"] }),
  );
  assert.deepEqual(changed.changedReasons, ["shipping", "payment"]);
});

test("checkout capability envelope rejects duplicate canonical options", () => {
  const duplicateShipping = envelope();
  duplicateShipping.shippingOptions = [
    duplicateShipping.shippingOptions[0],
    structuredClone(duplicateShipping.shippingOptions[0]),
  ];
  assert.throws(
    () => parseStorefrontCheckoutCapabilityEnvelopeV1(duplicateShipping),
    /unique identifiers/u,
  );

  const duplicatePayment = envelope();
  duplicatePayment.paymentCapabilities = [
    duplicatePayment.paymentCapabilities[0],
    structuredClone(duplicatePayment.paymentCapabilities[0]),
  ];
  assert.throws(
    () => parseStorefrontCheckoutCapabilityEnvelopeV1(duplicatePayment),
    /unique identifiers/u,
  );
});
