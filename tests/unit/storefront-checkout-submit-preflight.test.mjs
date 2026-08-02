import assert from "node:assert/strict";
import test from "node:test";

import { preflightStorefrontCheckoutSubmission } from "../../build/modules/storefront/src/checkout-submit.js";

const quoteId = "018f0000-0000-4000-8000-000000000401";
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

function money(minor) {
  return { currency: "GBP", minor, scale: 2 };
}

function intent(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-submission-intent.v1",
    quoteId,
    quoteRevision: "4",
    cartRevision: "9",
    idempotencyKey: "checkout-submit:001",
    destination: { countryCode: "GB", regionCode: null, postalCode: null, city: null },
    quoteAuthorityToken: "quote:authority:v4",
    countryPolicyRevision: "country-policy:v3",
    shippingOptionId: "shipping:delivery:1",
    shippingOptionVersion: "shipping-option:v7",
    shippingRevision: "shipping:v11",
    paymentCapabilityId: "payment:card:1",
    paymentCapabilityVersion: "payment-capability:v5",
    paymentRevision: "payment:v9",
    paymentMethodReference: "pm_checkout_opaque_123",
    ...overrides,
  };
}

function capabilities(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-capability-envelope.v1",
    context,
    quoteId,
    quoteRevision: "4",
    quoteExpiresAt: "2026-08-01T19:00:00.000Z",
    state: "ready",
    shippingOptions: [
      {
        optionId: "shipping:delivery:1",
        method: "local_delivery",
        label: "Local delivery",
        amount: money("500"),
        expiresAt: "2026-08-01T18:30:00.000Z",
        version: "shipping-option:v7",
      },
    ],
    paymentCapabilities: [
      {
        capabilityId: "payment:card:1",
        providerCapability: "provider:card",
        kind: "card",
        label: "Card",
        requiresAction: true,
        expiresAt: "2026-08-01T18:30:00.000Z",
        version: "payment-capability:v5",
      },
    ],
    authority: {
      quoteAuthorityToken: "quote:authority:v4",
      countryPolicyRevision: "country-policy:v3",
      shippingRevision: "shipping:v11",
      paymentRevision: "payment:v9",
    },
    changedReasons: [],
    ...overrides,
  };
}

const now = { now: () => "2026-08-01T18:00:00.000Z" };

test("checkout submission preflight returns only current canonical selections", () => {
  const result = preflightStorefrontCheckoutSubmission(intent(), capabilities(), now);

  assert.equal(result.intent.quoteId, quoteId);
  assert.equal(result.intent.quoteAuthorityToken, "quote:authority:v4");
  assert.equal(result.shippingOption.optionId, "shipping:delivery:1");
  assert.equal(result.shippingOption.amount.minor, "500");
  assert.equal(result.paymentCapability.capabilityId, "payment:card:1");
  assert.ok(Object.isFrozen(result));
});

test("checkout submission preflight rejects changed or unavailable capability state", () => {
  assert.throws(
    () =>
      preflightStorefrontCheckoutSubmission(
        intent(),
        capabilities({ state: "changed", changedReasons: ["shipping"] }),
        now,
      ),
    /require revalidation/u,
  );
  assert.throws(
    () =>
      preflightStorefrontCheckoutSubmission(
        intent(),
        capabilities({ state: "unavailable", changedReasons: ["payment"] }),
        now,
      ),
    /require revalidation/u,
  );
});

test("checkout submission preflight rejects stale quote and authority revisions", () => {
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ quoteRevision: "3" }), capabilities(), now),
    /quote revision is stale/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ quoteAuthorityToken: "quote:authority:v3" }), capabilities(), now),
    /Quote authority token changed/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ countryPolicyRevision: "country-policy:v2" }), capabilities(), now),
    /Country policy revision changed/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ shippingRevision: "shipping:v10" }), capabilities(), now),
    /Shipping authority revision changed/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ paymentRevision: "payment:v8" }), capabilities(), now),
    /Payment authority revision changed/u,
  );
});

test("checkout submission preflight rejects removed or version-changed selections", () => {
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ shippingOptionId: "shipping:pickup:missing" }), capabilities(), now),
    /shipping option is no longer eligible/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ shippingOptionVersion: "shipping-option:v6" }), capabilities(), now),
    /shipping option version changed/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ paymentCapabilityId: "payment:wallet:missing" }), capabilities(), now),
    /payment capability is no longer eligible/u,
  );
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent({ paymentCapabilityVersion: "payment-capability:v4" }), capabilities(), now),
    /payment capability version changed/u,
  );
});

test("checkout submission preflight rejects expired quote or selected capability", () => {
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent(), capabilities({ quoteExpiresAt: "2026-08-01T17:59:59.000Z" }), now),
    /quote expired/u,
  );

  const expiredShipping = capabilities();
  expiredShipping.shippingOptions[0].expiresAt = "2026-08-01T17:59:59.000Z";
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent(), expiredShipping, now),
    /shipping option expired/u,
  );

  const expiredPayment = capabilities();
  expiredPayment.paymentCapabilities[0].expiresAt = "2026-08-01T17:59:59.000Z";
  assert.throws(
    () => preflightStorefrontCheckoutSubmission(intent(), expiredPayment, now),
    /payment capability expired/u,
  );
});
