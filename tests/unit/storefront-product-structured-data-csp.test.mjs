import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { storefrontShellResponse } from "../../build/apps/storefront-web/src/render.js";
import { serializeStorefrontProductStructuredData } from "../../build/apps/storefront-web/src/seo.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import { parseStorefrontPublicProductDetailV1 } from "../../build/packages/storefront-contracts/src/public-catalog.js";

const context = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  storefrontId: "10000000-0000-4000-8000-000000000100",
  salesChannelId: "10000000-0000-4000-8000-000000000110",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v1",
  publicationGeneration: "publication:14",
};

const bootstrap = parseStorefrontBootstrapV1({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "theme:1",
  layoutRevision: "layout:1",
  capabilities: ["catalog.read"],
});

function productDetail(availability = "limited") {
  return parseStorefrontPublicProductDetailV1({
    contractVersion: "storefront-public-product.v1",
    context,
    product: {
      summary: {
        contractVersion: "storefront-product-card.v1",
        productId: "20000000-0000-4000-8000-000000000001",
        variantId: "20000000-0000-4000-8000-000000000011",
        slug: "linen-shirt",
        name: "Linen </script><script>alert(1)</script> Shirt",
        publicationState: "published",
        availability,
        pricePrefix: "none",
        price: { currency: "GBP", minor: "12345", scale: 2 },
        compareAtPrice: null,
        media: {
          src: "/media/linen-shirt.webp",
          alt: "Linen shirt",
          width: 1200,
          height: 1500,
        },
        badge: null,
      },
      code: "LINEN-SHIRT",
      description: "Breathable linen shirt.",
      kind: "stock",
      pricingNotice: "tax_calculated_at_checkout",
      variants: [
        {
          variantId: "20000000-0000-4000-8000-000000000011",
          sku: "LINEN-NATURAL-M",
          title: "Natural / M",
          unitCode: "EA",
          availability,
          price: { currency: "GBP", minor: "12345", scale: 2 },
          compareAtPrice: null,
          quantity: availability === "unknown"
            ? null
            : {
                amount: "3",
                unit: "EA",
                scale: 0,
                asOf: "2026-07-30T10:00:00.000Z",
                version: "7",
              },
        },
      ],
    },
  });
}

test("product detail binds the exact JSON-LD payload to a SHA-256 CSP source", async () => {
  const detail = productDetail();
  const serialized = serializeStorefrontProductStructuredData(detail);
  const expectedHash = createHash("sha256").update(serialized).digest("base64");
  const response = await storefrontShellResponse(
    new Request("https://shop.example.com/products/linen-shirt"),
    bootstrap,
    { buildId: "structured-data-test", product: detail },
  );
  const html = await response.text();
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u);
  assert.ok(match);
  assert.equal(match[1], serialized);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    new RegExp(`script-src 'sha256-${expectedHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`, "u"),
  );
  assert.doesNotMatch(
    response.headers.get("content-security-policy") ?? "",
    /script-src 'none'/u,
  );
  assert.match(html, /<meta name="robots" content="index,follow">/u);
  assert.doesNotMatch(html, /<\/script><script>alert/u);
});

test("non-product pages retain script-src none and do not emit structured data", async () => {
  const response = await storefrontShellResponse(
    new Request("https://shop.example.com/"),
    bootstrap,
    { buildId: "structured-data-test" },
  );
  const html = await response.text();
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /script-src 'none'/u,
  );
  assert.doesNotMatch(html, /application\/ld\+json/u);
  assert.match(html, /<meta name="robots" content="index,follow">/u);
});

test("unknown availability is omitted instead of becoming a stock claim", () => {
  const serialized = serializeStorefrontProductStructuredData(
    productDetail("unknown"),
  );
  const payload = JSON.parse(serialized);
  assert.equal(payload.offers.price, "123.45");
  assert.equal(payload.offers.priceCurrency, "GBP");
  assert.equal("availability" in payload.offers, false);
});
