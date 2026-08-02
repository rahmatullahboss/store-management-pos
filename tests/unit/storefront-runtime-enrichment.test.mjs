import assert from "node:assert/strict";
import test from "node:test";

import { enrichStorefrontProductMedia } from "../../build/apps/storefront-web/src/product-media-response.js";
import { bindStorefrontPublicCacheGeneration } from "../../build/apps/storefront-web/src/public-cache-response.js";

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

const mediaPayload = {
  contractVersion: "storefront-public-media.v1",
  context,
  productId: "018f0000-0000-4000-8000-000000000001",
  slug: "linen-shirt",
  revision: "0123456789abcdef0123456789abcdef",
  items: [{
    mediaId: "018f0000-0000-4000-8000-000000000101",
    variantId: null,
    src: "/media/linen-front.webp",
    alt: "Linen shirt front",
    sortOrder: 0,
    createdAt: "2026-07-30T10:00:00.000Z",
  }],
};

const cachePayload = {
  contractVersion: "storefront-public-cache-generations.v1",
  context,
  generations: {
    bootstrap: "1",
    content: "2",
    catalog: "3",
    product: "4",
    category: "5",
    collection: "6",
    search: "7",
    sitemap: "8",
    media: "9",
  },
};

function htmlResponse() {
  return new Response(
    '<!doctype html><main><div class="product-media product-media-large" aria-hidden="true"><span>L</span></div><h1>Linen Shirt</h1></main>',
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=60",
        ETag: 'W/"shell"',
      },
    },
  );
}

test("product detail response receives safe responsive media and media-scoped ETag", async () => {
  let observed = "";
  const enriched = await enrichStorefrontProductMedia(
    new Request("https://shop.example.com/products/linen-shirt"),
    {
      STOREFRONT_API_BASE_URL: "https://api.example.com",
      STOREFRONT_API: {
        async fetch(input) {
          observed = String(input);
          return Response.json(mediaPayload);
        },
      },
    },
    htmlResponse(),
  );
  const html = await enriched.text();
  assert.equal(
    observed,
    "https://api.example.com/v1/storefront/products/linen-shirt/media?hostname=shop.example.com",
  );
  assert.match(html, /<img /u);
  assert.match(html, /alt="Linen shirt front"/u);
  assert.match(html, /cdn-cgi\/image\/onerror=redirect,width=960/u);
  assert.match(html, /srcset="[^"]*width=320/u);
  assert.match(html, /fetchpriority="high"/u);
  assert.equal(enriched.headers.get("x-storefront-media-state"), "resolved");
  assert.notEqual(enriched.headers.get("etag"), 'W/"shell"');
  assert.doesNotMatch(html, /tenant-1/u);
});

test("media unavailability keeps the accessible product placeholder", async () => {
  const original = htmlResponse();
  const enriched = await enrichStorefrontProductMedia(
    new Request("https://shop.example.com/products/linen-shirt"),
    {
      STOREFRONT_API_BASE_URL: "https://api.example.com",
      STOREFRONT_API: {
        async fetch() {
          throw new Error("media unavailable");
        },
      },
    },
    original,
  );
  const html = await enriched.text();
  assert.match(html, /aria-hidden="true"/u);
  assert.doesNotMatch(html, /<img /u);
  assert.equal(enriched.headers.get("x-storefront-media-state"), "fallback");
});

test("exact cache generation binds public response ETag to family and resource", async () => {
  let observed = "";
  const response = await bindStorefrontPublicCacheGeneration(
    new Request(
      "https://shop.example.com/search?availability=available&q=linen",
    ),
    {
      STOREFRONT_API_BASE_URL: "https://api.example.com",
      STOREFRONT_BUILD_ID: "build-17",
      STOREFRONT_API: {
        async fetch(input) {
          observed = String(input);
          return Response.json(cachePayload);
        },
      },
    },
    new Response("search", {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60",
        ETag: 'W/"search-shell"',
      },
    }),
  );
  assert.equal(
    observed,
    "https://api.example.com/v1/storefront/cache-generations?hostname=shop.example.com",
  );
  assert.equal(response.headers.get("x-storefront-cache-state"), "generation-bound");
  assert.equal(response.headers.get("x-storefront-cache-family"), "search");
  assert.notEqual(response.headers.get("etag"), 'W/"search-shell"');
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=60/u);
});

test("cache generation failure removes ETag and forces shared-cache bypass", async () => {
  const response = await bindStorefrontPublicCacheGeneration(
    new Request("https://shop.example.com/products/linen-shirt"),
    {
      STOREFRONT_API_BASE_URL: "https://api.example.com",
      STOREFRONT_BUILD_ID: "build-17",
      STOREFRONT_API: {
        async fetch() {
          throw new Error("generation unavailable");
        },
      },
    },
    new Response("product", {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=120",
        ETag: 'W/"product-shell"',
      },
    }),
  );
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("x-storefront-cache-state"), "bypass");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
});

test("private and unsupported paths are never assigned public cache families", async () => {
  let calls = 0;
  const original = new Response("account", { status: 200 });
  const response = await bindStorefrontPublicCacheGeneration(
    new Request("https://shop.example.com/account"),
    {
      STOREFRONT_API_BASE_URL: "https://api.example.com",
      STOREFRONT_BUILD_ID: "build-17",
      STOREFRONT_API: {
        async fetch() {
          calls += 1;
          return Response.json(cachePayload);
        },
      },
    },
    original,
  );
  assert.equal(calls, 0);
  assert.equal(await response.text(), "account");
});
