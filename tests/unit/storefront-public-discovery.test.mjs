import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseStorefrontPublicCategoryPageV1,
  parseStorefrontPublicCollectionPageV1,
  parseStorefrontPublicSearchPageV1,
} from "../../build/packages/storefront-contracts/src/public-discovery.js";

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

const product = {
  summary: {
    contractVersion: "storefront-product-card.v1",
    productId: "018f0000-0000-4000-8000-000000000001",
    variantId: "018f0000-0000-4000-8000-000000000002",
    slug: "linen-shirt",
    name: "Linen Shirt",
    publicationState: "published",
    availability: "available",
    pricePrefix: "none",
    price: { currency: "GBP", minor: "2599", scale: 2 },
    compareAtPrice: null,
    media: null,
    badge: null,
  },
  code: "LINEN-SHIRT",
  description: "A breathable linen shirt.",
  kind: "stock",
  pricingNotice: "tax_calculated_at_checkout",
  variants: [
    {
      variantId: "018f0000-0000-4000-8000-000000000002",
      sku: "LINEN-NATURAL-M",
      title: "Natural / Medium",
      unitCode: "EA",
      availability: "available",
      price: { currency: "GBP", minor: "2599", scale: 2 },
      compareAtPrice: null,
      quantity: {
        amount: "7",
        unit: "EA",
        scale: 0,
        asOf: "2026-07-30T00:00:00.000Z",
        version: "4",
      },
    },
  ],
};

const rootCategory = {
  categoryId: "018f0000-0000-4000-8000-000000000010",
  slug: "clothing",
  title: "Clothing",
};

const categoryPayload = {
  contractVersion: "storefront-public-category.v1",
  context,
  category: {
    categoryId: "018f0000-0000-4000-8000-000000000011",
    slug: "shirts",
    title: "Shirts",
    description: "Published shirts.",
    parentCategoryId: rootCategory.categoryId,
    parentSlug: rootCategory.slug,
    breadcrumbs: [
      rootCategory,
      {
        categoryId: "018f0000-0000-4000-8000-000000000011",
        slug: "shirts",
        title: "Shirts",
      },
    ],
    children: [],
  },
  items: [product],
  nextCursor: null,
  hasMore: false,
};

const collectionPayload = {
  contractVersion: "storefront-public-collection.v1",
  context,
  collection: {
    collectionId: "018f0000-0000-4000-8000-000000000020",
    code: "summer-edit",
    slug: "summer-edit",
    title: "Summer Edit",
    description: "Seasonal published products.",
    version: "2",
  },
  items: [product],
  nextCursor: null,
  hasMore: false,
};

const searchPayload = {
  contractVersion: "storefront-public-search.v1",
  context,
  query: "linen shirt",
  items: [product],
  facets: {
    categories: [
      {
        categoryId: "018f0000-0000-4000-8000-000000000011",
        slug: "shirts",
        title: "Shirts",
        count: 1,
      },
    ],
    availability: [{ value: "available", count: 1 }],
  },
  nextCursor: null,
  hasMore: false,
};

test("public discovery contracts reuse exact public product documents", () => {
  const category = parseStorefrontPublicCategoryPageV1(categoryPayload);
  const collection = parseStorefrontPublicCollectionPageV1(collectionPayload);
  const search = parseStorefrontPublicSearchPageV1(searchPayload);

  assert.equal(category.category.breadcrumbs.at(-1)?.slug, "shirts");
  assert.equal(category.items[0].summary.price.minor, "2599");
  assert.equal(collection.collection.version, "2");
  assert.equal(collection.items[0].variants[0].quantity.amount, "7");
  assert.equal(search.facets.categories[0].count, 1);
  assert.equal(search.facets.availability[0].value, "available");
});

test("public discovery contracts fail closed on malformed hierarchy, query and cursor state", () => {
  assert.throws(
    () => parseStorefrontPublicCategoryPageV1({
      ...categoryPayload,
      category: { ...categoryPayload.category, breadcrumbs: [] },
    }),
    /breadcrumbs must terminate/u,
  );
  assert.throws(
    () => parseStorefrontPublicSearchPageV1({ ...searchPayload, query: "x" }),
    /at least two characters/u,
  );
  assert.throws(
    () => parseStorefrontPublicCollectionPageV1({
      ...collectionPayload,
      hasMore: true,
      nextCursor: null,
    }),
    /cursor and hasMore state are inconsistent/u,
  );
  assert.throws(
    () => parseStorefrontPublicSearchPageV1({
      ...searchPayload,
      items: Array.from({ length: 49 }, () => product),
    }),
    /catalog items are invalid/u,
  );
  assert.throws(
    () => parseStorefrontPublicSearchPageV1({
      ...searchPayload,
      facets: {
        ...searchPayload.facets,
        categories: Array.from({ length: 101 }, (_, index) => ({
          categoryId: `018f0000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          slug: `category-${index}`,
          title: `Category ${index}`,
          count: 0,
        })),
      },
    }),
    /category facets are invalid/u,
  );
});

test("public discovery migrations are read-only, literal-search bounded and runtime scoped", async () => {
  const categoryCollectionSql = await readFile(
    new URL(
      "../../database/modules/storefront/migrations/STF-0011-public-category-collection-resolution.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const searchSql = await readFile(
    new URL(
      "../../database/modules/storefront/migrations/STF-0012-public-search-resolution.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(categoryCollectionSql, /JOIN catalog\.categories category/u);
  assert.match(categoryCollectionSql, /JOIN catalog\.product_categories assignment/u);
  assert.match(categoryCollectionSql, /compose_public_product_documents/u);
  assert.match(categoryCollectionSql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_category/u);
  assert.match(categoryCollectionSql, /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_collection/u);
  assert.doesNotMatch(categoryCollectionSql, /(?:INSERT INTO|UPDATE|DELETE FROM) (?:catalog|pricing|inventory)\./u);

  assert.match(searchSql, /strpos\(/u);
  assert.doesNotMatch(searchSql, /LIKE\s+'%'/u);
  assert.match(searchSql, /LIMIT 20/u);
  assert.match(searchSql, /publication\.publication_state = 'published'/u);
  assert.match(searchSql, /category\.status = 'active'/u);
  assert.match(searchSql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_search/u);
  assert.doesNotMatch(searchSql, /(?:INSERT INTO|UPDATE|DELETE FROM) (?:catalog|pricing|inventory)\./u);
});

test("storefront manifest registers discovery migrations in deterministic order", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../database/modules/storefront/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const ids = manifest.migrations.map((migration) => migration.id);
  assert.deepEqual(ids.slice(-2), ["STF-0011", "STF-0012"]);
});
