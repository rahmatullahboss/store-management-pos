import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  type StorefrontHostContextV1,
} from "./index.js";

export const STOREFRONT_PUBLIC_CACHE_FAMILIES_V1 = [
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

export type StorefrontPublicCacheFamilyV1 =
  (typeof STOREFRONT_PUBLIC_CACHE_FAMILIES_V1)[number];

export type StorefrontPublicCacheGenerationsV1 = Readonly<
  Record<StorefrontPublicCacheFamilyV1, string>
>;

export interface StorefrontPublicCacheGenerationBundleV1 {
  readonly contractVersion: "storefront-public-cache-generations.v1";
  readonly context: StorefrontHostContextV1;
  readonly generations: StorefrontPublicCacheGenerationsV1;
}

const POSITIVE_INTEGER = /^[1-9][0-9]{0,18}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function parseStorefrontPublicCacheGenerationBundleV1(
  value: unknown,
): StorefrontPublicCacheGenerationBundleV1 {
  const source = record(value, "cache generation bundle");
  if (source.contractVersion !== "storefront-public-cache-generations.v1") {
    throw new StorefrontContractError("Unsupported storefront cache generation contract.");
  }
  const context = parseStorefrontHostContextV1(source.context);
  const rawGenerations = record(source.generations, "cache generations");
  const keys = Object.keys(rawGenerations).sort();
  const expected = [...STOREFRONT_PUBLIC_CACHE_FAMILIES_V1].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new StorefrontContractError("Cache generation families are incomplete or unsupported.");
  }

  const generations = Object.fromEntries(
    STOREFRONT_PUBLIC_CACHE_FAMILIES_V1.map((family) => {
      const generation = rawGenerations[family];
      if (typeof generation !== "string" || !POSITIVE_INTEGER.test(generation)) {
        throw new StorefrontContractError(`Cache generation ${family} is invalid.`);
      }
      return [family, generation];
    }),
  ) as Record<StorefrontPublicCacheFamilyV1, string>;

  return Object.freeze({
    contractVersion: "storefront-public-cache-generations.v1",
    context,
    generations: Object.freeze(generations),
  });
}
