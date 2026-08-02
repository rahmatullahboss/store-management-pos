import assert from "node:assert/strict";
import test from "node:test";

import { parseStorefrontCartQuoteEnvelopeV1 } from "../../build/packages/storefront-contracts/src/cart-checkout.js";

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

const money = (minor) => ({ currency: "GBP", minor, scale: 2 });

function envelope(version) {
  return {
    contractVersion: "storefront-cart-quote-envelope.v1",
    context,
    cartRevision: "7",
    state: "ready",
    quote: {
      contractVersion: "storefront-cart-quote.v1",
      quoteId,
      quoteRevision: "2",
      expiresAt: "2026-08-01T18:00:00.000Z",
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
      inventoryVersions: [{ variantId, version }],
    },
    changedLineIds: [],
    unavailableLineIds: [],
  };
}

test("cart quote contract preserves an opaque multi-warehouse inventory evidence token", () => {
  const composite = "wh-a:17,wh-b:9,reservations:31";
  const parsed = parseStorefrontCartQuoteEnvelopeV1(envelope(composite));
  assert.equal(parsed.authority.inventoryVersions[0].version, composite);
});

test("cart quote contract rejects unsafe inventory evidence tokens", () => {
  assert.throws(
    () => parseStorefrontCartQuoteEnvelopeV1(envelope("warehouse=17?next=<script>")),
    /opaque evidence token/u,
  );
});
