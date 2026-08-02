import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontCartQuoteRequest } from "../../build/packages/storefront-client/src/cart-quote.js";

const productId = "018f0000-0000-4000-8000-000000000511";
const variantId = "018f0000-0000-4000-8000-000000000512";

function draft(overrides = {}) {
  return {
    contractVersion: "storefront-cart-draft.v1",
    revision: "6",
    lines: [
      {
        productId,
        variantId,
        quantity: { amount: "2", unit: "EA", scale: 0 },
      },
    ],
    couponCodes: ["SAVE10"],
    destinationCountryCode: "BD",
    updatedAt: "2026-08-01T18:00:00.000Z",
    ...overrides,
  };
}

test("cart draft projects directly into strict quote buyer intent", () => {
  const request = createStorefrontCartQuoteRequest(draft(), {
    idempotencyKey: "quote-request:001",
    customerId: "018f0000-0000-4000-8000-000000000513",
  });

  assert.equal(request.cartRevision, "6");
  assert.equal(request.lines[0].productId, productId);
  assert.equal(request.lines[0].quantity.amount, "2");
  assert.deepEqual(request.couponCodes, ["SAVE10"]);
  assert.equal(request.destinationCountryCode, "BD");
  assert.equal(request.customerId, "018f0000-0000-4000-8000-000000000513");
  assert.equal(request.shippingOptionId, null);
});

test("cart draft projection refuses an empty cart before authority calls", () => {
  assert.throws(
    () =>
      createStorefrontCartQuoteRequest(draft({ lines: [] }), {
        idempotencyKey: "quote-request:001",
      }),
    /between 1 and 100 entries/u,
  );
});

test("cart draft projection cannot promote local commercial fields", () => {
  assert.throws(
    () =>
      createStorefrontCartQuoteRequest(
        {
          ...draft(),
          total: { currency: "BDT", minor: "100", scale: 2 },
        },
        { idempotencyKey: "quote-request:001" },
      ),
    /unsupported fields/u,
  );
});
