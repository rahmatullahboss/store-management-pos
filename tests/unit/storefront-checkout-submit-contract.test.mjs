import assert from "node:assert/strict";
import test from "node:test";

import { parseStorefrontCheckoutSubmissionIntentV1 } from "../../build/packages/storefront-contracts/src/checkout-submit.js";

const quoteId = "018f0000-0000-4000-8000-000000000401";

function intent(overrides = {}) {
  return {
    contractVersion: "storefront-checkout-submission-intent.v1",
    quoteId,
    quoteRevision: "4",
    cartRevision: "9",
    idempotencyKey: "checkout-submit:001",
    destination: {
      countryCode: "bd",
      regionCode: "dhaka",
      postalCode: "1205",
      city: "Dhaka",
    },
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

test("checkout submission intent carries buyer choices and authority revisions only", () => {
  const parsed = parseStorefrontCheckoutSubmissionIntentV1(intent());

  assert.equal(parsed.quoteRevision, "4");
  assert.equal(parsed.cartRevision, "9");
  assert.equal(parsed.destination.countryCode, "BD");
  assert.equal(parsed.destination.regionCode, "DHAKA");
  assert.equal(parsed.shippingOptionId, "shipping:delivery:1");
  assert.equal(parsed.paymentCapabilityId, "payment:card:1");
  assert.equal(parsed.paymentMethodReference, "pm_checkout_opaque_123");
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.destination));
});

test("checkout submission intent rejects browser commercial and infrastructure authority", () => {
  for (const forbidden of [
    { total: { currency: "GBP", minor: "100", scale: 2 } },
    { tax: { currency: "GBP", minor: "20", scale: 2 } },
    { paymentAmount: { currency: "GBP", minor: "100", scale: 2 } },
    { providerAccountId: "provider-account-1" },
    { warehouseId: "018f0000-0000-4000-8000-000000000402" },
  ]) {
    assert.throws(
      () => parseStorefrontCheckoutSubmissionIntentV1({ ...intent(), ...forbidden }),
      /unsupported fields/u,
    );
  }
});

test("checkout submission intent requires stable idempotency and revision evidence", () => {
  assert.throws(
    () => parseStorefrontCheckoutSubmissionIntentV1(intent({ idempotencyKey: "short" })),
    /idempotencyKey is invalid/u,
  );
  assert.throws(
    () => parseStorefrontCheckoutSubmissionIntentV1(intent({ quoteRevision: "4.5" })),
    /non-negative integer string/u,
  );
  assert.throws(
    () => parseStorefrontCheckoutSubmissionIntentV1(intent({ shippingRevision: "" })),
    /shippingRevision is invalid/u,
  );
});

test("checkout submission intent does not invent destination or payment method fallback", () => {
  const parsed = parseStorefrontCheckoutSubmissionIntentV1(
    intent({ destination: null, paymentMethodReference: null }),
  );

  assert.equal(parsed.destination, null);
  assert.equal(parsed.paymentMethodReference, null);
});
