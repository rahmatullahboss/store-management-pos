import assert from "node:assert/strict";
import test from "node:test";

import { deriveStorefrontCheckoutRecoveryV1 } from "../../build/packages/storefront-client/src/checkout-recovery.js";

function quote(overrides = {}) {
  return {
    state: "ready",
    quote: { expiresAt: "2026-08-01T19:00:00.000Z" },
    ...overrides,
  };
}

function capabilities(overrides = {}) {
  return {
    state: "ready",
    quoteExpiresAt: "2026-08-01T19:00:00.000Z",
    changedReasons: [],
    ...overrides,
  };
}

const now = { now: () => "2026-08-01T18:00:00.000Z" };

test("checkout recovery allows submit only when quote and capabilities are ready", () => {
  const recovery = deriveStorefrontCheckoutRecoveryV1({
    quote: quote(),
    capabilities: capabilities(),
    ...now,
  });

  assert.equal(recovery.canSubmit, true);
  assert.deepEqual(recovery.items, []);
  assert.ok(Object.isFrozen(recovery));
  assert.ok(Object.isFrozen(recovery.items));
});

test("checkout recovery reports corrupted cart storage as a blocking cart review", () => {
  const recovery = deriveStorefrontCheckoutRecoveryV1({
    cartRecovered: true,
    quote: quote(),
    capabilities: capabilities(),
    ...now,
  });

  assert.equal(recovery.canSubmit, false);
  assert.deepEqual(recovery.items, [
    { reason: "cart_recovered", action: "review_cart", blocking: true },
  ]);
});

test("checkout recovery makes expired quote refresh explicit", () => {
  const recovery = deriveStorefrontCheckoutRecoveryV1({
    quote: quote({ quote: { expiresAt: "2026-08-01T17:59:59.000Z" } }),
    capabilities: capabilities(),
    ...now,
  });

  assert.equal(recovery.canSubmit, false);
  assert.equal(recovery.items[0].reason, "quote_expired");
  assert.equal(recovery.items[0].action, "refresh_quote");
});

test("checkout recovery maps changed quote and unavailable quote to safe review actions", () => {
  const changed = deriveStorefrontCheckoutRecoveryV1({
    quote: quote({ state: "changed" }),
    capabilities: capabilities(),
    ...now,
  });
  const unavailable = deriveStorefrontCheckoutRecoveryV1({
    quote: quote({ state: "unavailable" }),
    capabilities: capabilities(),
    ...now,
  });

  assert.equal(changed.items[0].reason, "quote_changed");
  assert.equal(changed.items[0].action, "review_cart");
  assert.equal(unavailable.items[0].reason, "quote_unavailable");
  assert.equal(unavailable.items[0].action, "review_cart");
});

test("checkout recovery maps owning-module capability changes without inventing fallback choices", () => {
  const recovery = deriveStorefrontCheckoutRecoveryV1({
    quote: quote(),
    capabilities: capabilities({
      state: "changed",
      changedReasons: [
        "price_tax",
        "inventory",
        "country_policy",
        "shipping",
        "payment",
      ],
    }),
    ...now,
  });

  assert.equal(recovery.canSubmit, false);
  assert.deepEqual(
    recovery.items.map(({ reason, action }) => ({ reason, action })),
    [
      { reason: "price_tax_changed", action: "refresh_quote" },
      { reason: "inventory_changed", action: "review_cart" },
      { reason: "country_policy_changed", action: "review_destination" },
      { reason: "shipping_changed", action: "select_shipping" },
      { reason: "payment_changed", action: "select_payment" },
    ],
  );
});

test("checkout recovery reports unavailable checkout once and deduplicates quote expiry", () => {
  const recovery = deriveStorefrontCheckoutRecoveryV1({
    quote: quote({ quote: { expiresAt: "2026-08-01T17:59:59.000Z" } }),
    capabilities: capabilities({
      state: "unavailable",
      quoteExpiresAt: "2026-08-01T17:59:59.000Z",
      changedReasons: ["quote"],
    }),
    ...now,
  });

  assert.deepEqual(
    recovery.items.map((item) => item.reason),
    ["quote_expired", "checkout_unavailable", "quote_changed"],
  );
});

test("checkout recovery rejects an invalid validation clock", () => {
  assert.throws(
    () =>
      deriveStorefrontCheckoutRecoveryV1({
        quote: quote(),
        capabilities: capabilities(),
        now: () => "not-a-date",
      }),
    /recovery clock is invalid/u,
  );
});
