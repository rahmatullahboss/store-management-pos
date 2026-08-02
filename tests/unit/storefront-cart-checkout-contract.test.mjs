import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorefrontCartQuoteEnvelopeV1,
  parseStorefrontCartQuoteRequestV1,
} from "../../build/packages/storefront-contracts/src/cart-checkout.js";

const productId = "018f0000-0000-4000-8000-000000000001";
const variantId = "018f0000-0000-4000-8000-000000000101";
const lineId = "018f0000-0000-4000-8000-000000000201";
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

function quoteRequest(overrides = {}) {
  return {
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: "7",
    idempotencyKey: "cart:quote:abc12345",
    lines: [
      {
        productId,
        variantId,
        quantity: { amount: "2", unit: "ea", scale: 0 },
      },
    ],
    couponCodes: ["summer-10"],
    destinationCountryCode: "bd",
    customerId: null,
    shippingOptionId: "pickup-1",
    ...overrides,
  };
}

function quoteEnvelope(overrides = {}) {
  return {
    contractVersion: "storefront-cart-quote-envelope.v1",
    context,
    cartRevision: "7",
    state: "ready",
    quote: {
      contractVersion: "storefront-cart-quote.v1",
      quoteId,
      quoteRevision: "3",
      expiresAt: "2026-08-01T16:00:00.000Z",
      lines: [
        {
          lineId,
          productId,
          variantId,
          quantity: "2",
          unitPrice: money("5000"),
          subtotal: money("10000"),
          discount: money("1000"),
          tax: money("1800"),
          total: money("10800"),
        },
      ],
      subtotal: money("10000"),
      discount: money("1000"),
      shipping: money("500"),
      tax: money("1800"),
      total: money("11300"),
    },
    authority: {
      priceListRevision: context.priceListRevision,
      publicationGeneration: context.publicationGeneration,
      calculationIds: ["calc:line:1"],
      inventoryVersions: [{ variantId, version: "7" }],
    },
    changedLineIds: [],
    unavailableLineIds: [],
    ...overrides,
  };
}

test("cart quote request keeps only buyer intent and exact quantity", () => {
  const parsed = parseStorefrontCartQuoteRequestV1(quoteRequest());

  assert.equal(parsed.cartRevision, "7");
  assert.equal(parsed.lines[0].quantity.amount, "2");
  assert.equal(parsed.lines[0].quantity.unit, "EA");
  assert.deepEqual(parsed.couponCodes, ["SUMMER-10"]);
  assert.equal(parsed.destinationCountryCode, "BD");
  assert.equal(parsed.shippingOptionId, "pickup-1");
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.lines));
  assert.ok(Object.isFrozen(parsed.lines[0]));
});

test("cart quote request rejects browser-supplied commercial authority", () => {
  const payload = quoteRequest();
  payload.lines[0] = {
    ...payload.lines[0],
    unitPrice: money("1"),
    tax: money("0"),
    availability: "available",
  };

  assert.throws(
    () => parseStorefrontCartQuoteRequestV1(payload),
    /unsupported fields/u,
  );

  assert.throws(
    () =>
      parseStorefrontCartQuoteRequestV1({
        ...quoteRequest(),
        total: money("1"),
      }),
    /unsupported fields/u,
  );
});

test("cart quote request rejects non-exact, zero and duplicate quantities", () => {
  assert.throws(
    () =>
      parseStorefrontCartQuoteRequestV1(
        quoteRequest({
          lines: [
            { productId, variantId, quantity: { amount: 2, unit: "EA", scale: 0 } },
          ],
        }),
      ),
    /must be a string/u,
  );

  assert.throws(
    () =>
      parseStorefrontCartQuoteRequestV1(
        quoteRequest({
          lines: [
            { productId, variantId, quantity: { amount: "0", unit: "EA", scale: 0 } },
          ],
        }),
      ),
    /positive exact integer string/u,
  );

  const duplicate = quoteRequest();
  duplicate.lines = [duplicate.lines[0], structuredClone(duplicate.lines[0])];
  assert.throws(
    () => parseStorefrontCartQuoteRequestV1(duplicate),
    /duplicate product variants/u,
  );
});

test("cart quote envelope accepts exact server authority evidence", () => {
  const parsed = parseStorefrontCartQuoteEnvelopeV1(quoteEnvelope());

  assert.equal(parsed.state, "ready");
  assert.equal(parsed.context.currency, "GBP");
  assert.equal(parsed.quote.quoteRevision, "3");
  assert.equal(parsed.quote.total.minor, "11300");
  assert.deepEqual(parsed.authority.calculationIds, ["calc:line:1"]);
  assert.deepEqual(parsed.authority.inventoryVersions, [
    { variantId, version: "7" },
  ]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.quote.lines));
});

test("cart quote envelope rejects currency and authority scope mismatch", () => {
  const wrongCurrency = quoteEnvelope();
  wrongCurrency.quote.lines[0].tax = money("1800", "USD");
  assert.throws(
    () => parseStorefrontCartQuoteEnvelopeV1(wrongCurrency),
    /currency must match storefront context/u,
  );

  const stalePriceRevision = quoteEnvelope({
    authority: {
      ...quoteEnvelope().authority,
      priceListRevision: "price-list:1:v2",
    },
  });
  assert.throws(
    () => parseStorefrontCartQuoteEnvelopeV1(stalePriceRevision),
    /authority revisions must match/u,
  );
});

test("cart quote envelope requires recovery state markers to match quoted lines", () => {
  assert.throws(
    () =>
      parseStorefrontCartQuoteEnvelopeV1(
        quoteEnvelope({ state: "changed", changedLineIds: [] }),
      ),
    /state does not match/u,
  );

  assert.throws(
    () =>
      parseStorefrontCartQuoteEnvelopeV1(
        quoteEnvelope({ state: "ready", unavailableLineIds: [lineId] }),
      ),
    /state does not match/u,
  );

  const unknownLineId = "018f0000-0000-4000-8000-000000000999";
  assert.throws(
    () =>
      parseStorefrontCartQuoteEnvelopeV1(
        quoteEnvelope({ state: "changed", changedLineIds: [unknownLineId] }),
      ),
    /unique quoted lines/u,
  );
});

test("cart quote envelope requires one inventory and calculation authority record per line", () => {
  const missingCalculation = quoteEnvelope();
  missingCalculation.authority.calculationIds = [];
  assert.throws(
    () => parseStorefrontCartQuoteEnvelopeV1(missingCalculation),
    /one entry per quoted line/u,
  );

  const wrongVariant = quoteEnvelope();
  wrongVariant.authority.inventoryVersions = [
    {
      variantId: "018f0000-0000-4000-8000-000000000777",
      version: "7",
    },
  ];
  assert.throws(
    () => parseStorefrontCartQuoteEnvelopeV1(wrongVariant),
    /match quoted variants exactly/u,
  );
});
