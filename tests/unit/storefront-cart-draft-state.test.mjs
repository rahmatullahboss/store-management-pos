import assert from "node:assert/strict";
import test from "node:test";

import { parseStorefrontCartDraftV1 } from "../../build/packages/storefront-contracts/src/cart-draft.js";
import { createStorefrontCartDraftStore } from "../../build/packages/storefront-client/src/cart-state.js";

const productId = "018f0000-0000-4000-8000-000000000501";
const variantId = "018f0000-0000-4000-8000-000000000502";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function line(amount = "1") {
  return {
    productId,
    variantId,
    quantity: { amount, unit: "ea", scale: 0 },
  };
}

const clock = { now: () => "2026-08-01T18:00:00.000Z" };

test("cart draft contract stores buyer intent only and rejects commercial authority", () => {
  const parsed = parseStorefrontCartDraftV1({
    contractVersion: "storefront-cart-draft.v1",
    revision: "0",
    lines: [line()],
    couponCodes: ["save10"],
    destinationCountryCode: "bd",
    updatedAt: "2026-08-01T18:00:00.000Z",
  });

  assert.equal(parsed.lines[0].quantity.unit, "EA");
  assert.deepEqual(parsed.couponCodes, ["SAVE10"]);
  assert.equal(parsed.destinationCountryCode, "BD");

  for (const forbidden of [
    { total: { currency: "BDT", minor: "100", scale: 2 } },
    { tax: { currency: "BDT", minor: "15", scale: 2 } },
    { stock: "10" },
    { shippingAmount: { currency: "BDT", minor: "50", scale: 2 } },
    { paymentCapabilityId: "payment:card" },
  ]) {
    assert.throws(
      () => parseStorefrontCartDraftV1({
        contractVersion: "storefront-cart-draft.v1",
        revision: "0",
        lines: [],
        couponCodes: [],
        destinationCountryCode: null,
        updatedAt: "2026-08-01T18:00:00.000Z",
        ...forbidden,
      }),
      /unsupported fields/u,
    );
  }
});

test("cart draft store increments revision for buyer-intent changes", () => {
  const storage = memoryStorage();
  const store = createStorefrontCartDraftStore(storage, "storefront-1", clock);

  assert.equal(store.load().draft.revision, "0");
  const withLine = store.upsertLine(line("2"));
  assert.equal(withLine.revision, "1");
  assert.equal(withLine.lines[0].quantity.amount, "2");

  const withCoupon = store.setCouponCodes(["save10"]);
  assert.equal(withCoupon.revision, "2");
  assert.deepEqual(withCoupon.couponCodes, ["SAVE10"]);

  const withCountry = store.setDestinationCountryCode("bd");
  assert.equal(withCountry.revision, "3");
  assert.equal(withCountry.destinationCountryCode, "BD");

  const updatedLine = store.upsertLine(line("3"));
  assert.equal(updatedLine.revision, "4");
  assert.equal(updatedLine.lines.length, 1);
  assert.equal(updatedLine.lines[0].quantity.amount, "3");

  const removed = store.removeLine(productId, variantId);
  assert.equal(removed.revision, "5");
  assert.deepEqual(removed.lines, []);
});

test("cart draft store persists a host-independent storefront-scoped draft", () => {
  const storage = memoryStorage();
  const first = createStorefrontCartDraftStore(storage, "storefront-1", clock);
  first.upsertLine(line());

  const second = createStorefrontCartDraftStore(storage, "storefront-1", clock);
  const loaded = second.load();
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.draft.revision, "1");
  assert.equal(loaded.draft.lines[0].variantId, variantId);
  assert.equal(storage.values.size, 1);
});

test("cart draft store recovers corrupted or oversized browser storage without trusting it", () => {
  const storage = memoryStorage();
  const store = createStorefrontCartDraftStore(storage, "storefront-1", clock);
  const key = "ozzyl:storefront-cart:v1:storefront-1";

  storage.setItem(key, "{bad-json");
  const corrupted = store.load();
  assert.equal(corrupted.recovered, true);
  assert.equal(corrupted.draft.revision, "0");
  assert.equal(storage.getItem(key), null);

  storage.setItem(key, "x".repeat(70 * 1024));
  const oversized = store.load();
  assert.equal(oversized.recovered, true);
  assert.equal(oversized.draft.revision, "0");
  assert.equal(storage.getItem(key), null);
});

test("cart draft store keeps a missing-line removal idempotent", () => {
  const storage = memoryStorage();
  const store = createStorefrontCartDraftStore(storage, "storefront-1", clock);
  const initial = store.upsertLine(line());

  const unchanged = store.removeLine(
    "018f0000-0000-4000-8000-000000000503",
    "018f0000-0000-4000-8000-000000000504",
  );

  assert.equal(unchanged.revision, initial.revision);
  assert.equal(unchanged.lines.length, 1);
});
