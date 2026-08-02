import assert from "node:assert/strict";
import test from "node:test";

import { hashStorefrontCheckoutSubmissionIntent } from "../../build/modules/storefront/src/checkout-idempotency.js";

const quoteId = "018f0000-0000-4000-8000-000000000401";

function intent(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-submission-intent.v1",
    quoteId,
    quoteRevision: "4",
    cartRevision: "9",
    idempotencyKey: "checkout-submit:001",
    destination: {
      countryCode: "GB",
      regionCode: null,
      postalCode: "SW1A 1AA",
      city: "London",
    },
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

test("checkout request hash is deterministic for the same parsed intent", async () => {
  const left = intent();
  const right = {
    paymentMethodReference: left.paymentMethodReference,
    paymentRevision: left.paymentRevision,
    paymentCapabilityVersion: left.paymentCapabilityVersion,
    paymentCapabilityId: left.paymentCapabilityId,
    shippingRevision: left.shippingRevision,
    shippingOptionVersion: left.shippingOptionVersion,
    shippingOptionId: left.shippingOptionId,
    countryPolicyRevision: left.countryPolicyRevision,
    quoteAuthorityToken: left.quoteAuthorityToken,
    destination: {
      city: "London",
      postalCode: "SW1A 1AA",
      regionCode: null,
      countryCode: "gb",
    },
    idempotencyKey: left.idempotencyKey,
    cartRevision: left.cartRevision,
    quoteRevision: left.quoteRevision,
    quoteId: left.quoteId,
    contractVersion: left.contractVersion,
  };

  const [leftHash, rightHash] = await Promise.all([
    hashStorefrontCheckoutSubmissionIntent(left),
    hashStorefrontCheckoutSubmissionIntent(right),
  ]);

  assert.match(leftHash, /^[0-9a-f]{64}$/u);
  assert.equal(leftHash, rightHash);
});

test("checkout request hash changes when authoritative buyer selection evidence changes", async () => {
  const baseline = await hashStorefrontCheckoutSubmissionIntent(intent());
  const changedShipping = await hashStorefrontCheckoutSubmissionIntent(
    intent({ shippingOptionVersion: "shipping-option:v8" }),
  );
  const changedPayment = await hashStorefrontCheckoutSubmissionIntent(
    intent({ paymentCapabilityVersion: "payment-capability:v6" }),
  );
  const changedQuoteAuthority = await hashStorefrontCheckoutSubmissionIntent(
    intent({ quoteAuthorityToken: "quote:authority:v5" }),
  );

  assert.notEqual(baseline, changedShipping);
  assert.notEqual(baseline, changedPayment);
  assert.notEqual(baseline, changedQuoteAuthority);
});

test("checkout request hash rejects unsupported authority injection before hashing", async () => {
  await assert.rejects(
    hashStorefrontCheckoutSubmissionIntent({
      ...intent(),
      amount: { currency: "GBP", minor: "100", scale: 2 },
    }),
    /unsupported fields/u,
  );
});
