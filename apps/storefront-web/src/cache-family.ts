import type { StorefrontHostContextV1 } from "../../../packages/storefront-contracts/src/index.js";
import { createStorefrontPublicCacheScope } from "./cache-scope.js";

export const STOREFRONT_PUBLIC_CACHE_FAMILIES = [
  "bootstrap",
  "content",
  "catalog",
  "product",
  "category",
  "collection",
  "search",
  "sitemap",
  "media",
] as const;

export type StorefrontPublicCacheFamily =
  (typeof STOREFRONT_PUBLIC_CACHE_FAMILIES)[number];

export interface StorefrontCacheGenerationProvider {
  get(family: StorefrontPublicCacheFamily): Promise<string | null>;
}

export type StorefrontCacheGenerationResolution =
  | { readonly status: "available"; readonly generation: string }
  | { readonly status: "unavailable"; readonly reason: string };

const GENERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const RESOURCE = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,399}$/u;

function encode(value: string): string {
  return encodeURIComponent(value);
}

function resourceToken(value: string | undefined): string {
  if (value === undefined) return "all";
  const normalized = value.trim();
  if (!RESOURCE.test(normalized) || normalized.includes("..") || normalized.includes("//")) {
    throw new TypeError("Storefront cache resource key is invalid.");
  }
  return normalized;
}

export function classifyStorefrontPublicCacheFamily(
  pathname: string,
): StorefrontPublicCacheFamily | null {
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return "sitemap";
  if (pathname === "/" || pathname.startsWith("/pages/")) return "content";
  if (pathname === "/products" || pathname === "/products/") return "catalog";
  if (/^\/products\/[^/]+$/u.test(pathname)) return "product";
  if (/^\/categories\/[^/]+$/u.test(pathname)) return "category";
  if (/^\/collections\/[^/]+$/u.test(pathname)) return "collection";
  if (pathname === "/search") return "search";
  if (/^\/media\/products\/[^/]+/u.test(pathname)) return "media";
  return null;
}

export function createStorefrontCacheFamilyKey(input: {
  readonly context: StorefrontHostContextV1;
  readonly buildId: string;
  readonly family: StorefrontPublicCacheFamily;
  readonly generation: string;
  readonly resource?: string;
}): string {
  const generation = input.generation.trim();
  if (!GENERATION.test(generation)) {
    throw new TypeError("Storefront cache generation is invalid.");
  }
  return [
    createStorefrontPublicCacheScope(input.context, input.buildId),
    encode(input.family),
    encode(generation),
    encode(resourceToken(input.resource)),
  ].join(":");
}

export async function resolveStorefrontCacheGeneration(input: {
  readonly provider: StorefrontCacheGenerationProvider;
  readonly family: StorefrontPublicCacheFamily;
  readonly timeoutMs?: number;
}): Promise<StorefrontCacheGenerationResolution> {
  const timeoutMs = input.timeoutMs ?? 250;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 2_000) {
    throw new RangeError("Storefront cache-generation timeout is invalid.");
  }

  try {
    const generation = await Promise.race([
      input.provider.get(input.family),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("cache generation lookup timed out")), timeoutMs);
      }),
    ]);
    if (typeof generation !== "string" || !GENERATION.test(generation.trim())) {
      return Object.freeze({
        status: "unavailable",
        reason: "cache generation is missing or malformed",
      });
    }
    return Object.freeze({ status: "available", generation: generation.trim() });
  } catch (error: unknown) {
    return Object.freeze({
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
