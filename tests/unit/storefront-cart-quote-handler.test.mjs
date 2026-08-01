import assert from "node:assert/strict";
import test from "node:test";

import { handleStorefrontCartQuoteRequest } from "../../build/apps/api/src/modules/storefront/cart-quote-handler.js";

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
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});
const bootstrap = Object.freeze({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "theme:1",
  layoutRevision: "layout:1",
  capabilities: Object.freeze([]),
});
const money = (minor) => ({ currency: "GBP", minor, scale: 2 });

function payload() {
  return {
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: "5",
    idempotencyKey: "cart:quote:handler:12345",
    lines: [
      {
        productId,
        variantId,
        quantity: { amount: "1", unit: "EA", scale: 0 },
      },
    ],
    couponCodes: [],
    destinationCountryCode: "GB",
    customerId: null,
    shippingOptionId: null,
  };
}

function envelope() {
  return {
    contractVersion: "storefront-cart-quote-envelope.v1",
    context,
    cartRevision: "5",
    state: "ready",
    quote: {
      contractVersion: "storefront-cart-quote.v1",
      quoteId,
      quoteRevision: "1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lines: [
        {
          lineId,
          productId,
          variantId,
          quantity: "1",
          unitPrice: money("5000"),
          subtotal: money("5000"),
          discount: money("0"),
          tax: money("1000"),
          total: money("6000"),
        },
      ],
      subtotal: money("5000"),
      discount: money("0"),
      shipping: money("0"),
      tax: money("1000"),
      total: money("6000"),
    },
    authority: {
      priceListRevision: context.priceListRevision,
      publicationGeneration: context.publicationGeneration,
      calculationIds: ["calc:1"],
      inventoryVersions: [{ variantId, version: "7" }],
    },
    changedLineIds: [],
    unavailableLineIds: [],
  };
}

function request(body = payload(), overrides = {}) {
  return new Request(
    "https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": body.idempotencyKey ?? "cart:quote:handler:12345",
        ...(overrides.headers ?? {}),
      },
      body: JSON.stringify(body),
    },
  );
}

function repository(value = bootstrap) {
  return {
    async resolveBootstrap(hostname) {
      assert.equal(hostname, "shop.example.com");
      return value;
    },
  };
}

test("unregistered cart quote handler returns no-store exact authority response", async () => {
  let authorityCalls = 0;
  const response = await handleStorefrontCartQuoteRequest(
    repository(),
    {
      async quote(input) {
        authorityCalls += 1;
        assert.equal(input.request.idempotencyKey, payload().idempotencyKey);
        return envelope();
      },
    },
    request(),
    new URL("https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-cache, no-store, must-revalidate");
  assert.equal(authorityCalls, 1);
  assert.equal((await response.json()).quote.quoteId, quoteId);
});

test("cart quote handler rejects wrong method without touching repository or authority", async () => {
  let calls = 0;
  const response = await handleStorefrontCartQuoteRequest(
    { async resolveBootstrap() { calls += 1; return bootstrap; } },
    { async quote() { calls += 1; return envelope(); } },
    new Request("https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com"),
    new URL("https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com"),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal(calls, 0);
});

test("cart quote handler requires JSON and matching idempotency header before authority", async () => {
  let calls = 0;
  const authority = { async quote() { calls += 1; return envelope(); } };
  const wrongContentType = new Request(
    "https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com",
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Idempotency-Key": payload().idempotencyKey,
      },
      body: JSON.stringify(payload()),
    },
  );
  const first = await handleStorefrontCartQuoteRequest(
    repository(),
    authority,
    wrongContentType,
    new URL(wrongContentType.url),
  );
  assert.equal(first.status, 400);

  const second = await handleStorefrontCartQuoteRequest(
    repository(),
    authority,
    request(payload(), { headers: { "Idempotency-Key": "different-key-12345" } }),
    new URL("https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com"),
  );
  assert.equal(second.status, 409);
  assert.equal(calls, 0);
});

test("cart quote handler enforces bounded body size and unknown storefront behavior", async () => {
  let calls = 0;
  const tooLarge = new Request(
    "https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(65 * 1024),
        "Idempotency-Key": payload().idempotencyKey,
      },
      body: JSON.stringify(payload()),
    },
  );
  const oversized = await handleStorefrontCartQuoteRequest(
    repository(),
    { async quote() { calls += 1; return envelope(); } },
    tooLarge,
    new URL(tooLarge.url),
  );
  assert.equal(oversized.status, 400);
  assert.equal(calls, 0);

  const missing = await handleStorefrontCartQuoteRequest(
    repository(null),
    { async quote() { calls += 1; return envelope(); } },
    request(),
    new URL("https://api.example.com/v1/storefront/cart/quote?hostname=shop.example.com"),
  );
  assert.equal(missing.status, 404);
  assert.equal(calls, 0);
});
