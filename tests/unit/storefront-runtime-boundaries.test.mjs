import test from "node:test";
import assert from "node:assert/strict";
import {
  StorefrontEnvironmentError,
  createStorefrontPublicCacheScope,
  parseStorefrontRuntimeEnvironment,
} from "../../build/apps/storefront-web/src/index.js";
import { parseStorefrontHostContextV1 } from "../../build/packages/storefront-contracts/src/index.js";

const context = parseStorefrontHostContextV1({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "www.example.com",
  locale: "en-PK",
  currency: "PKR",
  priceListRevision: "price-1",
  publicationGeneration: "publication-1",
});

test("runtime environment accepts production HTTPS and normalized platform domain", () => {
  assert.deepEqual(
    parseStorefrontRuntimeEnvironment({
      STOREFRONT_STAGE: "production",
      STOREFRONT_API_BASE_URL: "https://api.example.com/",
      STOREFRONT_PLATFORM_BASE_DOMAIN: "Shops.Example.COM.",
      STOREFRONT_BUILD_ID: "build-2026.07.30",
    }),
    {
      stage: "production",
      apiBaseUrl: "https://api.example.com",
      platformBaseDomain: "shops.example.com",
      buildId: "build-2026.07.30",
    },
  );
});

test("runtime environment rejects insecure production and credential URLs", () => {
  assert.throws(
    () =>
      parseStorefrontRuntimeEnvironment({
        STOREFRONT_STAGE: "production",
        STOREFRONT_API_BASE_URL: "http://api.example.com",
        STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
        STOREFRONT_BUILD_ID: "build-1",
      }),
    StorefrontEnvironmentError,
  );
  assert.throws(() =>
    parseStorefrontRuntimeEnvironment({
      STOREFRONT_STAGE: "staging",
      STOREFRONT_API_BASE_URL: "https://user:secret@api.example.com",
      STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
      STOREFRONT_BUILD_ID: "build-1",
    }),
  );
});

test("development permits local HTTP only", () => {
  const environment = parseStorefrontRuntimeEnvironment({
    STOREFRONT_STAGE: "development",
    STOREFRONT_API_BASE_URL: "http://localhost:8787",
    STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.test",
    STOREFRONT_BUILD_ID: "local-1",
  });
  assert.equal(environment.apiBaseUrl, "http://localhost:8787");
});

test("public cache scope changes for tenant, host and commercial revisions", () => {
  const base = createStorefrontPublicCacheScope(context, "build-1");
  const otherTenant = createStorefrontPublicCacheScope(
    { ...context, tenantId: "tenant-2" },
    "build-1",
  );
  const otherHost = createStorefrontPublicCacheScope(
    { ...context, requestHostname: "alternate.example.com" },
    "build-1",
  );
  const otherPrice = createStorefrontPublicCacheScope(
    { ...context, priceListRevision: "price-2" },
    "build-1",
  );
  const otherPublication = createStorefrontPublicCacheScope(
    { ...context, publicationGeneration: "publication-2" },
    "build-1",
  );

  assert.notEqual(base, otherTenant);
  assert.notEqual(base, otherHost);
  assert.notEqual(base, otherPrice);
  assert.notEqual(base, otherPublication);
});
