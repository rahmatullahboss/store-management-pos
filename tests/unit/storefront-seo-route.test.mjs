import assert from "node:assert/strict";
import test from "node:test";
import { handleStorefrontSeoRoute } from "../../build/apps/storefront-web/src/seo-route.js";

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

function bootstrap(overrides = {}) {
  return {
    contractVersion: "storefront-bootstrap.v1",
    context: { ...context, ...overrides },
    themeRevision: "theme:1",
    layoutRevision: "layout:1",
    capabilities: ["catalog.read", "content.read"],
  };
}

function seo(overrides = {}) {
  return {
    contractVersion: "storefront-public-seo.v1",
    context: { ...context, ...(overrides.context ?? {}) },
    indexable: true,
    sitemapPath: "/sitemap.xml",
    disallow: ["/account", "/checkout"],
    entries: [
      {
        kind: "home",
        path: "/",
        lastModified: "2026-07-30T10:00:00.000Z",
        changeFrequency: "daily",
      },
      {
        kind: "product",
        path: "/products/linen-shirt",
        lastModified: "2026-07-30T09:00:00.000Z",
        changeFrequency: "weekly",
      },
    ],
    ...overrides,
  };
}

function bindings({ bootstrapPayload = bootstrap(), seoPayload = seo(), status = 200 } = {}) {
  return {
    STOREFRONT_STAGE: "production",
    STOREFRONT_API_BASE_URL: "https://api.example.com",
    STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
    STOREFRONT_BUILD_ID: "seo-route-test",
    STOREFRONT_API: {
      async fetch(input) {
        const url = new URL(String(input));
        if (status !== 200) {
          return Response.json({ error: { code: "MISSING" } }, { status });
        }
        if (url.pathname === "/v1/storefront/bootstrap") {
          return Response.json(bootstrapPayload);
        }
        if (url.pathname === "/v1/storefront/seo") {
          return Response.json(seoPayload);
        }
        return new Response(null, { status: 404 });
      },
    },
  };
}

test("SEO route returns null for ordinary storefront paths", async () => {
  const response = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/products"),
    bindings(),
  );
  assert.equal(response, null);
});

test("robots and sitemap routes reconcile scope and render safe public responses", async () => {
  const robots = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/robots.txt"),
    bindings(),
  );
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type") ?? "", /^text\/plain/u);
  assert.match(robots.headers.get("cache-control") ?? "", /s-maxage=300/u);
  assert.match(robots.headers.get("etag") ?? "", /^W\//u);
  const robotsBody = await robots.text();
  assert.match(robotsBody, /Sitemap: https:\/\/shop\.example\.com\/sitemap\.xml/u);
  assert.doesNotMatch(robotsBody, /10000000-/u);

  const sitemap = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/sitemap.xml"),
    bindings(),
  );
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type") ?? "", /^application\/xml/u);
  assert.match(sitemap.headers.get("cache-control") ?? "", /s-maxage=900/u);
  const sitemapBody = await sitemap.text();
  assert.match(sitemapBody, /<loc>https:\/\/shop\.example\.com\/products\/linen-shirt<\/loc>/u);
  assert.doesNotMatch(sitemapBody, /tenantId|storefrontId|10000000-/u);
});

test("SEO routes support HEAD and deny mutation methods", async () => {
  const head = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/sitemap.xml", { method: "HEAD" }),
    bindings(),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("content-type") ?? "", /^application\/xml/u);

  const post = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/robots.txt", { method: "POST" }),
    bindings(),
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

test("SEO routes redirect to canonical host before fetching discovery output", async () => {
  let calls = 0;
  const configured = bindings({
    bootstrapPayload: bootstrap({ canonicalHostname: "canonical.example.com" }),
  });
  const transport = configured.STOREFRONT_API;
  configured.STOREFRONT_API = {
    async fetch(input, init) {
      calls += 1;
      return transport.fetch(input, init);
    },
  };
  const response = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/robots.txt?ignored=true"),
    configured,
  );
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://canonical.example.com/robots.txt");
  assert.equal(calls, 1);
});

test("SEO routes fail closed for unavailable or mismatched public context", async () => {
  const missing = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/robots.txt"),
    bindings({ status: 404 }),
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "STOREFRONT_UNAVAILABLE");

  const mismatch = await handleStorefrontSeoRoute(
    new Request("https://shop.example.com/sitemap.xml"),
    bindings({ seoPayload: seo({ context: { tenantId: "20000000-0000-4000-8000-000000000001" } }) }),
  );
  assert.equal(mismatch.status, 503);
  const payload = await mismatch.json();
  assert.equal(payload.error.code, "STOREFRONT_TEMPORARILY_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(payload), /20000000-/u);
});
