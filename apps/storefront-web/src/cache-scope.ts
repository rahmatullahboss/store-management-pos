import {
  normalizeStorefrontHostname,
  type StorefrontHostContextV1,
} from "../../../packages/storefront-contracts/src/index.js";

const CACHE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export class StorefrontCacheScopeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StorefrontCacheScopeError";
  }
}

function cacheToken(value: string, label: string): string {
  const normalized = value.trim();
  if (!CACHE_TOKEN.test(normalized)) {
    throw new StorefrontCacheScopeError(`${label} is not cache-key safe.`);
  }
  return normalized;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createStorefrontPublicCacheScope(
  context: StorefrontHostContextV1,
  buildId: string,
): string {
  const requestHostname = normalizeStorefrontHostname(context.requestHostname);
  const canonicalHostname = normalizeStorefrontHostname(
    context.canonicalHostname,
  );

  return [
    "storefront-cache.v1",
    cacheToken(context.tenantId, "tenantId"),
    cacheToken(context.storefrontId, "storefrontId"),
    cacheToken(context.salesChannelId, "salesChannelId"),
    requestHostname,
    canonicalHostname,
    cacheToken(context.locale, "locale"),
    cacheToken(context.currency, "currency"),
    cacheToken(context.priceListRevision, "priceListRevision"),
    cacheToken(context.publicationGeneration, "publicationGeneration"),
    cacheToken(buildId, "buildId"),
  ]
    .map(segment)
    .join(":");
}
