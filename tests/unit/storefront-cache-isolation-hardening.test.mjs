import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStorefrontPublicCacheFamily,
  createStorefrontCacheFamilyKey,
} from "../../build/apps/storefront-web/src/cache-family.js";
import { createStorefrontPublicCacheScope } from "../../build/apps/storefront-web/src/cache-scope.js";

const baseContext = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v7",
  publicationGeneration: "publication:19",
});

function familyKey(context = baseContext, overrides = {}) {
  return createStorefrontCacheFamilyKey({
    context,
    buildId: "build-20260801",
    family: "product",
    generation: "43",
    resource: "linen-shirt",
    ...overrides,
  });
}

test("public cache key changes for every tenant, host and commercial authority dimension", () => {
  const base = familyKey();
  const mutations = [
    ["tenantId", "tenant-2"],
    ["storefrontId", "storefront-2"],
    ["salesChannelId", "channel-2"],
    ["requestHostname", "alias.example.com"],
    ["canonicalHostname", "canonical.example.net"],
    ["locale", "ar-SA"],
    ["currency", "SAR"],
    ["priceListRevision", "price-list:1:v8"],
    ["publicationGeneration", "publication:20"],
  ];

  for (const [field, value] of mutations) {
    const key = familyKey({ ...baseContext, [field]: value });
    assert.notEqual(key, base, field);
  }

  for (const overrides of [
    { buildId: "build-20260802" },
    { family: "media" },
    { generation: "44" },
    { resource: "linen-shirt-blue" },
  ]) {
    assert.notEqual(familyKey(baseContext, overrides), base, JSON.stringify(overrides));
  }
});

test("two tenants and two hostnames cannot cross-read an otherwise identical cache resource", () => {
  const contexts = [
    { ...baseContext, tenantId: "tenant-a", requestHostname: "a.example.com", canonicalHostname: "a.example.com" },
    { ...baseContext, tenantId: "tenant-a", requestHostname: "alias-a.example.com", canonicalHostname: "a.example.com" },
    { ...baseContext, tenantId: "tenant-b", requestHostname: "a.example.com", canonicalHostname: "a.example.com" },
    { ...baseContext, tenantId: "tenant-b", requestHostname: "b.example.com", canonicalHostname: "b.example.com" },
  ];
  const keys = contexts.map((context) => familyKey(context));
  assert.equal(new Set(keys).size, keys.length);
});

test("encoded cache segments prevent delimiter reshaping from producing a collision", () => {
  const left = createStorefrontPublicCacheScope(
    {
      ...baseContext,
      tenantId: "tenant:one",
      storefrontId: "storefront",
    },
    "build-1",
  );
  const right = createStorefrontPublicCacheScope(
    {
      ...baseContext,
      tenantId: "tenant",
      storefrontId: "one:storefront",
    },
    "build-1",
  );

  assert.notEqual(left, right);
  assert.match(left, /tenant%3Aone/u);
  assert.match(right, /one%3Astorefront/u);
});

test("private and mutation-oriented buyer routes never receive a public cache family", () => {
  for (const pathname of [
    "/account",
    "/account/orders",
    "/account/orders/018f0000-0000-4000-8000-000000000001",
    "/cart",
    "/checkout",
    "/checkout/payment",
    "/api/private",
    "/evidence/order-tracking",
    "/evidence/checkout-recovery",
  ]) {
    assert.equal(classifyStorefrontPublicCacheFamily(pathname), null, pathname);
  }
});

test("unsafe cache tokens and path-like resources fail closed instead of being normalized into another key", () => {
  assert.throws(
    () => familyKey({ ...baseContext, tenantId: " tenant with spaces " }),
    /tenantId is not cache-key safe/u,
  );
  for (const resource of ["../secret", "products//secret", "linen shirt", ""] ) {
    assert.throws(
      () => familyKey(baseContext, { resource }),
      /cache resource key is invalid/u,
      resource,
    );
  }
});
