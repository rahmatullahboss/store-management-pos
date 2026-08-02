import { StorefrontContractError } from "./index.js";
import {
  parseStorefrontPublicCatalogPageV1,
  type StorefrontPublicProductV1,
} from "./public-catalog.js";
import type { StorefrontHostContextV1 } from "./index.js";

export interface StorefrontPublicBreadcrumbV1 {
  readonly categoryId: string;
  readonly slug: string;
  readonly title: string;
}

export interface StorefrontPublicCategorySummaryV1 {
  readonly categoryId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly parentCategoryId: string | null;
  readonly parentSlug: string | null;
  readonly breadcrumbs: readonly StorefrontPublicBreadcrumbV1[];
  readonly children: readonly StorefrontPublicBreadcrumbV1[];
}

export interface StorefrontPublicCategoryPageV1 {
  readonly contractVersion: "storefront-public-category.v1";
  readonly context: StorefrontHostContextV1;
  readonly category: StorefrontPublicCategorySummaryV1;
  readonly items: readonly StorefrontPublicProductV1[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface StorefrontPublicCollectionSummaryV1 {
  readonly collectionId: string;
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly version: string;
}

export interface StorefrontPublicCollectionPageV1 {
  readonly contractVersion: "storefront-public-collection.v1";
  readonly context: StorefrontHostContextV1;
  readonly collection: StorefrontPublicCollectionSummaryV1;
  readonly items: readonly StorefrontPublicProductV1[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export type StorefrontPublicAvailabilityFacetValueV1 =
  | "available"
  | "limited"
  | "unavailable"
  | "preorder"
  | "unknown";

export interface StorefrontPublicCategoryFacetV1 {
  readonly categoryId: string;
  readonly slug: string;
  readonly title: string;
  readonly count: number;
}

export interface StorefrontPublicAvailabilityFacetV1 {
  readonly value: StorefrontPublicAvailabilityFacetValueV1;
  readonly count: number;
}

export interface StorefrontPublicSearchPageV1 {
  readonly contractVersion: "storefront-public-search.v1";
  readonly context: StorefrontHostContextV1;
  readonly query: string;
  readonly items: readonly StorefrontPublicProductV1[];
  readonly facets: {
    readonly categories: readonly StorefrontPublicCategoryFacetV1[];
    readonly availability: readonly StorefrontPublicAvailabilityFacetV1[];
  };
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const AVAILABILITY = [
  "available",
  "limited",
  "unavailable",
  "preorder",
  "unknown",
] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, label, maximum);
}

function uuid(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function slug(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 180).toLowerCase();
  if (
    !SLUG_PATTERN.test(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function token(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 200);
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new StorefrontContractError(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function integerString(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw new StorefrontContractError(`${label} must be an integer string.`);
  }
  return normalized;
}

function breadcrumb(value: unknown, label: string): StorefrontPublicBreadcrumbV1 {
  const source = asRecord(value, label);
  return Object.freeze({
    categoryId: uuid(source.categoryId, `${label}.categoryId`),
    slug: slug(source.slug, `${label}.slug`),
    title: boundedText(source.title, `${label}.title`, 240),
  });
}

function breadcrumbList(
  value: unknown,
  label: string,
  maximum: number,
): readonly StorefrontPublicBreadcrumbV1[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  const parsed = value.map((entry, index) =>
    breadcrumb(entry, `${label}[${index}]`),
  );
  const ids = new Set(parsed.map((entry) => entry.categoryId));
  if (ids.size !== parsed.length) {
    throw new StorefrontContractError(`${label} contains duplicate categories.`);
  }
  return Object.freeze(parsed);
}

function parseCatalogEnvelope(
  source: Record<string, unknown>,
): ReturnType<typeof parseStorefrontPublicCatalogPageV1> {
  return parseStorefrontPublicCatalogPageV1({
    contractVersion: "storefront-public-catalog.v1",
    context: source.context,
    items: source.items,
    nextCursor: source.nextCursor,
    hasMore: source.hasMore,
  });
}

export function parseStorefrontPublicCategoryPageV1(
  value: unknown,
): StorefrontPublicCategoryPageV1 {
  const source = asRecord(value, "categoryPage");
  if (source.contractVersion !== "storefront-public-category.v1") {
    throw new StorefrontContractError("Unsupported public category contract.");
  }
  const catalog = parseCatalogEnvelope(source);
  const categorySource = asRecord(source.category, "categoryPage.category");
  const categoryId = uuid(
    categorySource.categoryId,
    "categoryPage.category.categoryId",
  );
  const breadcrumbs = breadcrumbList(
    categorySource.breadcrumbs,
    "categoryPage.category.breadcrumbs",
    16,
  );
  if (
    breadcrumbs.length === 0 ||
    breadcrumbs.at(-1)?.categoryId !== categoryId
  ) {
    throw new StorefrontContractError(
      "Category breadcrumbs must terminate at the current category.",
    );
  }
  const parentCategoryId = categorySource.parentCategoryId === null ||
      categorySource.parentCategoryId === undefined
    ? null
    : uuid(
        categorySource.parentCategoryId,
        "categoryPage.category.parentCategoryId",
      );
  const parentSlug = categorySource.parentSlug === null ||
      categorySource.parentSlug === undefined
    ? null
    : slug(categorySource.parentSlug, "categoryPage.category.parentSlug");
  if ((parentCategoryId === null) !== (parentSlug === null)) {
    throw new StorefrontContractError(
      "Category parent ID and slug must be provided together.",
    );
  }
  return Object.freeze({
    contractVersion: "storefront-public-category.v1",
    context: catalog.context,
    category: Object.freeze({
      categoryId,
      slug: slug(categorySource.slug, "categoryPage.category.slug"),
      title: boundedText(categorySource.title, "categoryPage.category.title", 240),
      description: optionalText(
        categorySource.description,
        "categoryPage.category.description",
        4_000,
      ),
      parentCategoryId,
      parentSlug,
      breadcrumbs,
      children: breadcrumbList(
        categorySource.children,
        "categoryPage.category.children",
        100,
      ),
    }),
    items: catalog.items,
    nextCursor: catalog.nextCursor,
    hasMore: catalog.hasMore,
  });
}

export function parseStorefrontPublicCollectionPageV1(
  value: unknown,
): StorefrontPublicCollectionPageV1 {
  const source = asRecord(value, "collectionPage");
  if (source.contractVersion !== "storefront-public-collection.v1") {
    throw new StorefrontContractError("Unsupported public collection contract.");
  }
  const catalog = parseCatalogEnvelope(source);
  const collection = asRecord(source.collection, "collectionPage.collection");
  return Object.freeze({
    contractVersion: "storefront-public-collection.v1",
    context: catalog.context,
    collection: Object.freeze({
      collectionId: uuid(
        collection.collectionId,
        "collectionPage.collection.collectionId",
      ),
      code: token(collection.code, "collectionPage.collection.code"),
      slug: slug(collection.slug, "collectionPage.collection.slug"),
      title: boundedText(
        collection.title,
        "collectionPage.collection.title",
        240,
      ),
      description: optionalText(
        collection.description,
        "collectionPage.collection.description",
        4_000,
      ),
      version: integerString(
        collection.version,
        "collectionPage.collection.version",
      ),
    }),
    items: catalog.items,
    nextCursor: catalog.nextCursor,
    hasMore: catalog.hasMore,
  });
}

export function parseStorefrontPublicSearchPageV1(
  value: unknown,
): StorefrontPublicSearchPageV1 {
  const source = asRecord(value, "searchPage");
  if (source.contractVersion !== "storefront-public-search.v1") {
    throw new StorefrontContractError("Unsupported public search contract.");
  }
  const catalog = parseCatalogEnvelope(source);
  const query = boundedText(source.query, "searchPage.query", 120);
  if (query.length < 2) {
    throw new StorefrontContractError(
      "Public search query must contain at least two characters.",
    );
  }
  const facets = asRecord(source.facets, "searchPage.facets");
  if (!Array.isArray(facets.categories) || facets.categories.length > 100) {
    throw new StorefrontContractError("Search category facets are invalid.");
  }
  if (
    !Array.isArray(facets.availability) ||
    facets.availability.length > AVAILABILITY.length
  ) {
    throw new StorefrontContractError("Search availability facets are invalid.");
  }
  const categories = facets.categories.map((entry, index) => {
    const category = asRecord(
      entry,
      `searchPage.facets.categories[${index}]`,
    );
    return Object.freeze({
      categoryId: uuid(
        category.categoryId,
        `searchPage.facets.categories[${index}].categoryId`,
      ),
      slug: slug(
        category.slug,
        `searchPage.facets.categories[${index}].slug`,
      ),
      title: boundedText(
        category.title,
        `searchPage.facets.categories[${index}].title`,
        240,
      ),
      count: nonNegativeInteger(
        category.count,
        `searchPage.facets.categories[${index}].count`,
      ),
    });
  });
  const availability = facets.availability.map((entry, index) => {
    const facet = asRecord(
      entry,
      `searchPage.facets.availability[${index}]`,
    );
    if (
      typeof facet.value !== "string" ||
      !AVAILABILITY.includes(
        facet.value as StorefrontPublicAvailabilityFacetValueV1,
      )
    ) {
      throw new StorefrontContractError(
        `searchPage.facets.availability[${index}].value is unsupported.`,
      );
    }
    return Object.freeze({
      value: facet.value as StorefrontPublicAvailabilityFacetValueV1,
      count: nonNegativeInteger(
        facet.count,
        `searchPage.facets.availability[${index}].count`,
      ),
    });
  });
  return Object.freeze({
    contractVersion: "storefront-public-search.v1",
    context: catalog.context,
    query,
    items: catalog.items,
    facets: Object.freeze({
      categories: Object.freeze(categories),
      availability: Object.freeze(availability),
    }),
    nextCursor: catalog.nextCursor,
    hasMore: catalog.hasMore,
  });
}
