import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createStorefrontWorker,
} from "../../build/apps/storefront-web/src/index.js";
import {
  parseStorefrontBootstrapV1,
} from "../../build/packages/storefront-contracts/src/index.js";
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

const categoryPage = parseStorefrontPublicCategoryPageV1(categoryPayload);
const collectionPage = parseStorefrontPublicCollectionPageV1(collectionPayload);
const searchPage = parseStorefrontPublicSearchPageV1(searchPayload);
const bootstrap = parseStorefrontBootstrapV1({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "theme:1",
  layoutRevision: "layout:1",
  capabilities: ["catalog.read"],
});
const environment = {
  STOREFRONT_STAGE: "production",
  STOREFRONT_API_BASE_URL: "https://api.example.com",
  STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
  STOREFRONT_BUILD_ID: "build-discovery-1",
};

function discoveryResolver(overrides = {}) {
  return {
    async resolveCatalog() { return null; },
    async resolveProduct() { return null; },
    async resolveCategory() { return categoryPage; },
    async resolveCollection() { return collectionPage; },
    async resolveSearch() { return searchPage; },
    ...overrides,
  };
}

function discoveryWorker(resolver = discoveryResolver()) {
  return createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    catalogResolverFactory: () => resolver,
  });
}

test("public discovery contracts reuse exact public product documents", () => {
  assert.equal(categoryPage.category.breadcrumbs.at(-1)?.slug, "shirts");
  assert.equal(categoryPage.items[0].summary.price.minor, "2599");
  assert.equal(collectionPage.collection.version, "2");
  assert.equal(collectionPage.items[0].variants[0].quantity.amount, "7");
  assert.equal(searchPage.facets.categories[0].count, 1);
  assert.equal(searchPage.facets.availability[0].value, "available");
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

test("buyer worker renders category collection and search without scope identifiers", async () => {
  const worker = discoveryWorker();
  const category = await worker.fetch(
    new Request("https://shop.example.com/categories/shirts"),
    environment,
  );
  const categoryHtml = await category.text();
  assert.equal(category.status, 200);
  assert.match(categoryHtml, /Published category/u);
  assert.match(categoryHtml, /Shirts/u);
  assert.match(categoryHtml, /£25\.99/u);
  assert.doesNotMatch(categoryHtml, /tenant-1/u);

  const collection = await worker.fetch(
    new Request("https://shop.example.com/collections/summer-edit"),
    environment,
  );
  assert.equal(collection.status, 200);
  assert.match(await collection.text(), /Summer Edit/u);

  const search = await worker.fetch(
    new Request("https://shop.example.com/search?q=linen%20shirt"),
    environment,
  );
  const searchHtml = await search.text();
  assert.equal(search.status, 200);
  assert.match(searchHtml, /Results for “linen shirt”/u);
  assert.match(searchHtml, /Categories/u);
  assert.match(searchHtml, /Limited availability|Available/u);
  assert.match(searchHtml, /action="\/search"/u);
});

test("buyer discovery routes preserve HEAD, bounded not-found and scope mismatch behavior", async () => {
  const worker = discoveryWorker();
  const head = await worker.fetch(
    new Request("https://shop.example.com/categories/shirts", { method: "HEAD" }),
    environment,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const missingCollectionWorker = discoveryWorker(
    discoveryResolver({ async resolveCollection() { return null; } }),
  );
  const missing = await missingCollectionWorker.fetch(
    new Request("https://shop.example.com/collections/missing"),
    environment,
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "COLLECTION_NOT_FOUND");

  const mismatch = parseStorefrontPublicCategoryPageV1({
    ...categoryPayload,
    context: { ...context, tenantId: "tenant-2" },
  });
  const mismatchWorker = discoveryWorker(
    discoveryResolver({ async resolveCategory() { return mismatch; } }),
  );
  const denied = await mismatchWorker.fetch(
    new Request("https://shop.example.com/categories/shirts"),
    environment,
  );
  assert.equal(denied.status, 404);
  assert.doesNotMatch(await denied.text(), /tenant-2/u);

  const invalidSearch = await worker.fetch(
    new Request("https://shop.example.com/search?q=x"),
    environment,
  );
  assert.equal(invalidSearch.status, 404);
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

test("storefront manifest registers exact discovery migration checksums", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../database/modules/storefront/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const expectedFiles = [
    "STF-0011-public-category-collection-resolution.sql",
    "STF-0012-public-search-resolution.sql",
    "STF-0013-public-search-filters.sql",
  ];
  const expectedIds = ["STF-0011", "STF-0012", "STF-0013"];
const registered = expectedIds.map((id) =>
  manifest.migrations.find((migration) => migration.id === id)
);
assert.ok(registered.every(Boolean));
assert.deepEqual(
  registered.map((migration) => migration.id),
  expectedIds,
);
  assert.deepEqual(
    registered.map((migration) => migration.file),
    expectedFiles,
  );
  for (const migration of registered) {
    const sql = await readFile(
      new URL(
        `../../database/modules/storefront/migrations/${migration.file}`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.equal(
      migration.sha256,
      createHash("sha256").update(sql).digest("hex"),
      `${migration.id} checksum must match its SQL source`,
    );
  }
});
