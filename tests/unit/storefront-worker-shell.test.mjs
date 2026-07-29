import test from "node:test";
import assert from "node:assert/strict";
import {
  createStorefrontHostResolver,
  createStorefrontWorker,
  storefrontShellResponse,
} from "../../build/apps/storefront-web/src/index.js";
import { StorefrontClientError } from "../../build/packages/storefront-client/src/index.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";

const environment = {
  STOREFRONT_STAGE: "production",
  STOREFRONT_API_BASE_URL: "https://api.example.com",
  STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
  STOREFRONT_BUILD_ID: "build-1",
};

const bootstrap = parseStorefrontBootstrapV1({
  contractVersion: "storefront-bootstrap.v1",
  context: {
    tenantId: "tenant-1",
    storefrontId: "storefront-1",
    salesChannelId: "channel-1",
    requestHostname: "shop.example.com",
    canonicalHostname: "shop.example.com",
    locale: "en-GB",
    currency: "GBP",
    priceListRevision: "price-1",
    publicationGeneration: "publication-1",
  },
  themeRevision: "theme-1",
  layoutRevision: "layout-1",
  capabilities: ["catalog.read"],
});

function workerFor(resolver) {
  return createStorefrontWorker({ resolverFactory: () => resolver });
}

test("worker health is independent from tenant resolution", async () => {
  const worker = createStorefrontWorker({
    resolverFactory: () => {
      throw new Error("resolver must not run");
    },
  });
  const response = await worker.fetch(
    new Request("https://invalid.example/__health"),
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    service: "storefront-web",
    status: "ok",
    contractVersion: "storefront-runtime.v1",
  });
});

test("worker exposes only GET and HEAD", async () => {
  const worker = workerFor({ async resolve() { return bootstrap; } });
  const response = await worker.fetch(
    new Request("https://shop.example.com/", { method: "POST" }),
    environment,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unknown hosts fail closed without cacheable content", async () => {
  const worker = workerFor({ async resolve() { return null; } });
  const response = await worker.fetch(
    new Request("https://missing.example.com/products"),
    environment,
  );
  assert.equal(response.status, 404);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("canonical redirect preserves path and query", async () => {
  const aliasBootstrap = parseStorefrontBootstrapV1({
    ...bootstrap,
    context: {
      ...bootstrap.context,
      requestHostname: "alias.example.com",
      canonicalHostname: "shop.example.com",
    },
  });
  const worker = workerFor({ async resolve() { return aliasBootstrap; } });
  const response = await worker.fetch(
    new Request("https://alias.example.com/products/item?q=one"),
    environment,
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://shop.example.com/products/item?q=one",
  );
});

test("worker renders an accessible secure shell without leaking tenant ids", async () => {
  const worker = workerFor({ async resolve() { return bootstrap; } });
  const response = await worker.fetch(
    new Request("https://shop.example.com/"),
    environment,
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-language"), "en-GB");
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'none'/);
  assert.match(response.headers.get("etag") ?? "", /^W\/"[0-9a-f]{32}"$/);
  assert.match(html, /<header>/);
  assert.match(html, /<main id="main-content"/);
  assert.match(html, /<nav class="nav" aria-label="Primary navigation">/);
  assert.match(html, /<form class="search"[^>]*role="search">/);
  assert.match(html, /<footer>/);
  assert.doesNotMatch(html, /tenant-1/);
  assert.doesNotMatch(html, /scalius/i);
});

test("tenant and commercial revisions produce different response validators", async () => {
  const request = new Request("https://shop.example.com/");
  const first = await storefrontShellResponse(request, bootstrap, {
    buildId: "build-1",
  });
  const second = await storefrontShellResponse(
    request,
    parseStorefrontBootstrapV1({
      ...bootstrap,
      context: {
        ...bootstrap.context,
        tenantId: "tenant-2",
      },
    }),
    { buildId: "build-1" },
  );
  const third = await storefrontShellResponse(
    request,
    parseStorefrontBootstrapV1({
      ...bootstrap,
      context: {
        ...bootstrap.context,
        priceListRevision: "price-2",
      },
    }),
    { buildId: "build-1" },
  );
  assert.notEqual(first.headers.get("etag"), second.headers.get("etag"));
  assert.notEqual(first.headers.get("etag"), third.headers.get("etag"));
});

test("HEAD returns storefront headers without a document body", async () => {
  const worker = workerFor({ async resolve() { return bootstrap; } });
  const response = await worker.fetch(
    new Request("https://shop.example.com/", { method: "HEAD" }),
    environment,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.match(response.headers.get("etag") ?? "", /^W\//);
});

test("host resolver maps only an authoritative 404 to not found", async () => {
  const resolver = createStorefrontHostResolver({
    async getBootstrap() {
      throw new StorefrontClientError("not found", 404);
    },
  });
  assert.equal(await resolver.resolve("shop.example.com"), null);

  const failing = createStorefrontHostResolver({
    async getBootstrap() {
      throw new StorefrontClientError("upstream outage", 503);
    },
  });
  await assert.rejects(() => failing.resolve("shop.example.com"), /upstream outage/);
});

test("default worker prefers a service binding transport", async () => {
  let observedUrl = "";
  const worker = createStorefrontWorker();
  const response = await worker.fetch(
    new Request("https://shop.example.com/"),
    {
      ...environment,
      STOREFRONT_API: {
        async fetch(input) {
          observedUrl = String(input);
          return Response.json(bootstrap);
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(
    observedUrl,
    "https://api.example.com/v1/storefront/bootstrap?hostname=shop.example.com",
  );
});

test("invalid runtime configuration returns a safe 503", async () => {
  const worker = workerFor({ async resolve() { return bootstrap; } });
  const response = await worker.fetch(
    new Request("https://shop.example.com/"),
    {
      ...environment,
      STOREFRONT_API_BASE_URL: "http://api.example.com",
    },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.doesNotMatch(await response.text(), /api\.example\.com/);
});
