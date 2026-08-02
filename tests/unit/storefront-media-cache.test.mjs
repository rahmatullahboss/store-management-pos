import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorefrontProductImageSrcSet,
  buildStorefrontProductImageUrl,
  normalizeStorefrontMediaSource,
} from "../../build/apps/storefront-web/src/product-media.js";
import {
  classifyStorefrontPublicCacheFamily,
  createStorefrontCacheFamilyKey,
  resolveStorefrontCacheGeneration,
} from "../../build/apps/storefront-web/src/cache-family.js";

const context = {
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v1",
  publicationGeneration: "publication:9",
};

test("responsive storefront media helper accepts only safe relative or HTTPS sources", () => {
  assert.equal(normalizeStorefrontMediaSource(" /media/product.webp "), "/media/product.webp");
  assert.equal(
    normalizeStorefrontMediaSource("https://cdn.example.com/product.webp?version=1"),
    "https://cdn.example.com/product.webp?version=1",
  );
  for (const unsafe of [
    "http://cdn.example.com/product.webp",
    "https://user:secret@cdn.example.com/product.webp",
    "https://cdn.example.com/product.webp#fragment",
    "//cdn.example.com/product.webp",
    "javascript:alert(1)",
    "/media\\product.webp",
  ]) {
    assert.equal(normalizeStorefrontMediaSource(unsafe), "");
  }
});

test("responsive storefront media transformation is allowlisted and gracefully falls back", () => {
  const relative = buildStorefrontProductImageUrl(
    "/media/product.webp",
    { width: 480, quality: 80, format: "webp", fit: "contain" },
  );
  assert.equal(
    relative,
    "/cdn-cgi/image/onerror=redirect,width=480,quality=80,format=webp,fit=contain/media/product.webp",
  );

  const allowed = buildStorefrontProductImageUrl(
    "https://cdn.example.com/media/product.webp?version=1",
    { width: 640 },
    { allowedHosts: ["cdn.example.com"] },
  );
  assert.match(allowed, /^https:\/\/cdn\.example\.com\/cdn-cgi\/image\//u);
  assert.match(allowed, /\/media\/product\.webp\?version=1$/u);

  const foreign = buildStorefrontProductImageUrl(
    "https://foreign.example.net/media/product.webp",
    { width: 640 },
    { allowedHosts: ["cdn.example.com"] },
  );
  assert.equal(foreign, "https://foreign.example.net/media/product.webp");
  assert.equal(buildStorefrontProductImageUrl("/media/icon.svg"), "/media/icon.svg");
});

test("responsive storefront srcset is deterministic, bounded and omits non-resizable media", () => {
  const srcset = buildStorefrontProductImageSrcSet(
    "/media/product.webp",
    [960, 320, 640, 320],
    { quality: 78 },
  );
  assert.match(srcset, /width=320/u);
  assert.match(srcset, /width=640/u);
  assert.match(srcset, /width=960/u);
  assert.equal(srcset.split(", ").length, 3);
  assert.equal(buildStorefrontProductImageSrcSet("/media/icon.svg"), "");
  assert.throws(
    () => buildStorefrontProductImageSrcSet("/media/product.webp", [32]),
    /widths are invalid/u,
  );
});

test("cache family classification and keys isolate every storefront authority dimension", () => {
  assert.equal(classifyStorefrontPublicCacheFamily("/products"), "catalog");
  assert.equal(classifyStorefrontPublicCacheFamily("/products/linen-shirt"), "product");
  assert.equal(classifyStorefrontPublicCacheFamily("/categories/shirts"), "category");
  assert.equal(classifyStorefrontPublicCacheFamily("/collections/summer"), "collection");
  assert.equal(classifyStorefrontPublicCacheFamily("/search"), "search");
  assert.equal(classifyStorefrontPublicCacheFamily("/sitemap.xml"), "sitemap");
  assert.equal(classifyStorefrontPublicCacheFamily("/media/products/linen-shirt"), "media");
  assert.equal(classifyStorefrontPublicCacheFamily("/account"), null);

  const base = createStorefrontCacheFamilyKey({
    context,
    buildId: "build-1",
    family: "product",
    generation: "17",
    resource: "linen-shirt",
  });
  const changed = [
    createStorefrontCacheFamilyKey({
      context: { ...context, requestHostname: "alias.example.com" },
      buildId: "build-1",
      family: "product",
      generation: "17",
      resource: "linen-shirt",
    }),
    createStorefrontCacheFamilyKey({
      context: { ...context, locale: "ar-SA" },
      buildId: "build-1",
      family: "product",
      generation: "17",
      resource: "linen-shirt",
    }),
    createStorefrontCacheFamilyKey({
      context,
      buildId: "build-2",
      family: "product",
      generation: "17",
      resource: "linen-shirt",
    }),
    createStorefrontCacheFamilyKey({
      context,
      buildId: "build-1",
      family: "media",
      generation: "17",
      resource: "linen-shirt",
    }),
    createStorefrontCacheFamilyKey({
      context,
      buildId: "build-1",
      family: "product",
      generation: "18",
      resource: "linen-shirt",
    }),
  ];
  for (const key of changed) assert.notEqual(key, base);
  assert.throws(
    () => createStorefrontCacheFamilyKey({ context, buildId: "build-1", family: "product", generation: "bad generation" }),
    /generation is invalid/u,
  );
});

test("cache generation lookup fails closed on missing, malformed and timeout states", async () => {
  assert.deepEqual(
    await resolveStorefrontCacheGeneration({
      family: "catalog",
      provider: { async get() { return "42"; } },
    }),
    { status: "available", generation: "42" },
  );
  assert.equal(
    (await resolveStorefrontCacheGeneration({
      family: "catalog",
      provider: { async get() { return null; } },
    })).status,
    "unavailable",
  );
  assert.equal(
    (await resolveStorefrontCacheGeneration({
      family: "catalog",
      provider: { async get() { return "bad generation"; } },
    })).status,
    "unavailable",
  );
  const timed = await resolveStorefrontCacheGeneration({
    family: "catalog",
    timeoutMs: 25,
    provider: { async get() { return await new Promise(() => {}); } },
  });
  assert.equal(timed.status, "unavailable");
  assert.match(timed.reason, /timed out/u);
});
