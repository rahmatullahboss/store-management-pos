import assert from "node:assert/strict";
import test from "node:test";

import { requestStorefrontCartQuote } from "../../build/packages/storefront-client/src/cart-checkout.js";

const productId = "018f0000-0000-4000-8000-000000000001";
const variantId = "018f0000-0000-4000-8000-000000000101";
const lineId = "018f0000-0000-4000-8000-000000000201";
const quoteId = "018f0000-0000-4000-8000-000000000301";

const context = {
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
};

function money(minor) {
  return { currency: "GBP", minor, scale: 2 };
}

function requestPayload() {
  return {
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: "5",
    idempotencyKey: "cart:quote:client:12345",
    lines: [
      {
        productId,
        variantId,
        quantity: { amount: "2", unit: "EA", scale: 0 },
      },
    ],
    couponCodes: [],
    destinationCountryCode: "GB",
    customerId: null,
    shippingOptionId: "pickup-1",
  };
}

function envelope(overrides = {}) {
  return {
    contractVersion: "storefront-cart-quote-envelope.v1",
    context,
    cartRevision: "5",
    state: "ready",
    quote: {
      contractVersion: "storefront-cart-quote.v1",
      quoteId,
      quoteRevision: "1",
      expiresAt: "2026-08-01T18:00:00.000Z",
      lines: [
        {
          lineId,
          productId,
          variantId,
          quantity: "2",
          unitPrice: money("5000"),
          subtotal: money("10000"),
          discount: money("0"),
          tax: money("2000"),
          total: money("12000"),
        },
      ],
      subtotal: money("10000"),
      discount: money("0"),
      shipping: money("500"),
      tax: money("2000"),
      total: money("12500"),
    },
    authority: {
      priceListRevision: context.priceListRevision,
      publicationGeneration: context.publicationGeneration,
      calculationIds: ["calc:price-tax:1"],
      inventoryVersions: [{ variantId, version: "9" }],
    },
    changedLineIds: [],
    unavailableLineIds: [],
    ...overrides,
  };
}

test("cart quote client sends normalized POST with idempotency and no double slash", async () => {
  let observed;
  const response = await requestStorefrontCartQuote(
    {
      baseUrl: "https://api.example.com/root/",
      transport: {
        async fetch(input, init) {
          observed = { url: String(input), init };
          return Response.json(envelope());
        },
      },
    },
    "SHOP.EXAMPLE.COM.",
    requestPayload(),
  );

  assert.equal(
    observed.url,
    "https://api.example.com/root/v1/storefront/cart/quote?hostname=shop.example.com",
  );
  assert.equal(observed.init.method, "POST");
  assert.equal(
    observed.init.headers["Idempotency-Key"],
    "cart:quote:client:12345",
  );
  assert.equal(observed.init.cache, "no-store");
  assert.deepEqual(JSON.parse(observed.init.body), requestPayload());
  assert.equal(response.quote.total.minor, "12500");
});

test("cart quote client rejects browser authority before transport", async () => {
  let calls = 0;
  const payload = requestPayload();
  payload.lines[0] = { ...payload.lines[0], price: money("1") };

  await assert.rejects(
    requestStorefrontCartQuote(
      {
        baseUrl: "https://api.example.com",
        transport: {
          async fetch() {
            calls += 1;
            return Response.json(envelope());
          },
        },
      },
      "shop.example.com",
      payload,
    ),
    /unsupported fields/u,
  );
  assert.equal(calls, 0);
});

test("cart quote client rejects response scope mismatch", async () => {
  await assert.rejects(
    requestStorefrontCartQuote(
      {
        baseUrl: "https://api.example.com",
        transport: {
          async fetch() {
            return Response.json(
              envelope({
                context: {
                  ...context,
                  requestHostname: "other.example.com",
                },
              }),
            );
          },
        },
      },
      "shop.example.com",
      requestPayload(),
    ),
    /scope mismatch/u,
  );
});

test("cart quote client preserves server conflict status", async () => {
  await assert.rejects(
    async () =>
      requestStorefrontCartQuote(
        {
          baseUrl: "https://api.example.com",
          transport: {
            async fetch() {
              return Response.json(
                { error: { code: "QUOTE_STALE" } },
                { status: 409 },
              );
            },
          },
        },
        "shop.example.com",
        requestPayload(),
      ),
    (error) => error?.status === 409,
  );
});
