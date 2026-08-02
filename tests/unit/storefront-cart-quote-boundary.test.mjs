import assert from "node:assert/strict";
import test from "node:test";

import { resolveStorefrontCartQuote } from "../../build/modules/storefront/src/cart-checkout.js";

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
  themeRevision: "theme:3",
  layoutRevision: "layout:4",
  capabilities: Object.freeze(["catalog.read"]),
});

function requestPayload(overrides = {}) {
  return {
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: "5",
    idempotencyKey: "cart:quote:boundary:12345",
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
    ...overrides,
  };
}

function money(minor) {
  return { currency: "GBP", minor, scale: 2 };
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

function repository(value = bootstrap) {
  return {
    observedHostname: null,
    async resolveBootstrap(hostname) {
      this.observedHostname = hostname;
      return value;
    },
  };
}

test("cart quote boundary resolves host context then passes only parsed buyer intent to authority", async () => {
  const repo = repository();
  let observed;
  const result = await resolveStorefrontCartQuote(
    repo,
    {
      async quote(input) {
        observed = input;
        return envelope();
      },
    },
    "SHOP.EXAMPLE.COM.",
    requestPayload(),
    { now: () => "2026-08-01T17:00:00.000Z" },
  );

  assert.equal(repo.observedHostname, "shop.example.com");
  assert.deepEqual(observed.context, context);
  assert.equal(observed.request.lines[0].quantity.amount, "2");
  assert.equal("price" in observed.request.lines[0], false);
  assert.equal(result.quote.quoteId, quoteId);
});

test("cart quote boundary does not call authority for an unavailable storefront", async () => {
  let calls = 0;
  const result = await resolveStorefrontCartQuote(
    repository(null),
    {
      async quote() {
        calls += 1;
        return envelope();
      },
    },
    "shop.example.com",
    requestPayload(),
  );

  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("cart quote boundary fails closed on host scope mismatch", async () => {
  const mismatched = envelope({
    context: { ...context, storefrontId: "storefront-2" },
    authority: {
      ...envelope().authority,
      priceListRevision: context.priceListRevision,
      publicationGeneration: context.publicationGeneration,
    },
  });

  await assert.rejects(
    resolveStorefrontCartQuote(
      repository(),
      { async quote() { return mismatched; } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /mismatched storefront context/u,
  );
});

test("cart quote boundary rejects stale revisions, expired quotes and changed identity", async () => {
  await assert.rejects(
    resolveStorefrontCartQuote(
      repository(),
      { async quote() { return envelope({ cartRevision: "4" }); } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /stale cart revision/u,
  );

  const expired = envelope();
  expired.quote.expiresAt = "2026-08-01T16:59:59.000Z";
  await assert.rejects(
    resolveStorefrontCartQuote(
      repository(),
      { async quote() { return expired; } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /expired quote/u,
  );

  const changedIdentity = envelope();
  changedIdentity.quote.lines[0].productId =
    "018f0000-0000-4000-8000-000000000777";
  await assert.rejects(
    resolveStorefrontCartQuote(
      repository(),
      { async quote() { return changedIdentity; } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /mismatched cart identity or quantity/u,
  );
});

test("cart quote boundary rejects zero canonical quote revisions", async () => {
  const invalidRevision = envelope();
  invalidRevision.quote.quoteRevision = "0";
  await assert.rejects(
    resolveStorefrontCartQuote(
      repository(),
      { async quote() { return invalidRevision; } },
      "shop.example.com",
      requestPayload(),
      { now: () => "2026-08-01T17:00:00.000Z" },
    ),
    /invalid quote revision/u,
  );
});
