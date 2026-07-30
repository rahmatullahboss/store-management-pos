import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { enrichStorefrontProductStructuredData } from "../../build/apps/storefront-web/src/product-structured-response.js";
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

function bindings(detail = productDetail()) {
  return {
    STOREFRONT_STAGE: "production",
    STOREFRONT_API_BASE_URL: "https://api.example.com",
    STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
    STOREFRONT_BUILD_ID: "structured-data-test",
    STOREFRONT_API: {
      async fetch(input) {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/v1/storefront/products/linen-shirt");
        assert.equal(url.searchParams.get("hostname"), "shop.example.com");
        return Response.json(detail);
      },
    },
  };
}

test("product response binds the exact JSON-LD payload to a SHA-256 CSP source", async () => {
  const detail = productDetail();
  const serialized = serializeStorefrontProductStructuredData(detail);
  const expectedHash = createHash("sha256").update(serialized).digest("base64");
  const request = new Request("https://shop.example.com/products/linen-shirt");
  const original = await storefrontShellResponse(request, bootstrap, {
    buildId: "structured-data-test",
    product: detail,
  });
  const originalEtag = original.headers.get("etag");
  const response = await enrichStorefrontProductStructuredData(
    request,
    bindings(detail),
    original,
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
  assert.equal(response.headers.get("x-storefront-structured-data"), "product.v1");
  assert.notEqual(response.headers.get("etag"), originalEtag);
  assert.match(html, /<meta name="robots" content="index,follow">/u);
  assert.doesNotMatch(html, /<\/script><script>alert/u);
});

test("product HEAD response receives the same structured-data CSP without a body", async () => {
  const detail = productDetail();
  const request = new Request(
    "https://shop.example.com/products/linen-shirt",
    { method: "HEAD" },
  );
  const original = await storefrontShellResponse(request, bootstrap, {
    buildId: "structured-data-test",
    product: detail,
    headOnly: true,
  });
  const response = await enrichStorefrontProductStructuredData(
    request,
    bindings(detail),
    original,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /script-src 'sha256-/u,
  );
});

test("non-product pages and product API failures retain the original secure response", async () => {
  const homepageRequest = new Request("https://shop.example.com/");
  const homepage = await storefrontShellResponse(homepageRequest, bootstrap, {
    buildId: "structured-data-test",
  });
  const unchangedHomepage = await enrichStorefrontProductStructuredData(
    homepageRequest,
    bindings(),
    homepage,
  );
  const homepageHtml = await unchangedHomepage.text();
  assert.match(
    unchangedHomepage.headers.get("content-security-policy") ?? "",
    /script-src 'none'/u,
  );
  assert.doesNotMatch(homepageHtml, /application\/ld\+json/u);

  const detail = productDetail();
  const productRequest = new Request(
    "https://shop.example.com/products/linen-shirt",
  );
  const productResponse = await storefrontShellResponse(
    productRequest,
    bootstrap,
    { buildId: "structured-data-test", product: detail },
  );
  const failed = await enrichStorefrontProductStructuredData(
    productRequest,
    {
      ...bindings(detail),
      STOREFRONT_API: {
        async fetch() {
          return Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 });
        },
      },
    },
    productResponse,
  );
  const failedHtml = await failed.text();
  assert.match(
    failed.headers.get("content-security-policy") ?? "",
    /script-src 'none'/u,
  );
  assert.doesNotMatch(failedHtml, /application\/ld\+json/u);
  assert.match(failedHtml, /<meta name="robots" content="noindex,follow">/u);
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
