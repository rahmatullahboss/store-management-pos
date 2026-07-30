import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handlePublicStorefrontRequest } from "../../build/apps/api/src/modules/storefront/public-handler.js";
import { createStorefrontWorker } from "../../build/apps/storefront-web/src/index.js";
import { requestStorefrontPublicSearch } from "../../build/packages/storefront-client/src/public-search.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import { parseStorefrontPublicSearchPageV1 } from "../../build/packages/storefront-contracts/src/public-discovery.js";

const cursor = "018f0000-0000-4000-8000-000000000099";
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
const searchPage = parseStorefrontPublicSearchPageV1(searchPayload);
const selectedSearchPage = Object.freeze({
  ...searchPage,
  selectedCategory: "shirts",
  selectedAvailability: "available",
});
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
  STOREFRONT_BUILD_ID: "build-search-filter-1",
};

test("filtered public search client forwards filters and preserves selected state", async () => {
  let observedUrl = "";
  const result = await requestStorefrontPublicSearch(
    {
      baseUrl: "https://api.example.com",
      transport: {
        async fetch(input) {
          observedUrl = String(input);
          return Response.json(searchPayload);
        },
      },
    },
    "SHOP.EXAMPLE.COM.",
    " linen shirt ",
    {
      category: "shirts",
      availability: "available",
      limit: 12,
      cursor,
    },
  );

  assert.equal(
    observedUrl,
    `https://api.example.com/v1/storefront/search?hostname=shop.example.com&q=linen+shirt&category=shirts&availability=available&limit=12&cursor=${cursor}`,
  );
  assert.equal(result.selectedCategory, "shirts");
  assert.equal(result.selectedAvailability, "available");
  assert.equal(result.items[0].summary.price.minor, "2599");
});

test("public API applies category and availability through the six-argument resolver", async () => {
  let observedSql = "";
  let observedValues = [];
  const database = {
    async httpQuery(sql, values) {
      observedSql = sql;
      observedValues = values;
      return [
        {
          tenantId: context.tenantId,
          storefrontId: context.storefrontId,
          salesChannelId: context.salesChannelId,
          requestHostname: context.requestHostname,
          canonicalHostname: context.canonicalHostname,
          locale: context.locale,
          currency: context.currency,
          priceListRevision: context.priceListRevision,
          publicationGeneration: context.publicationGeneration,
          normalizedQuery: searchPayload.query,
          productDocuments: searchPayload.items,
          facetsDocument: searchPayload.facets,
          nextCursor: null,
          hasMore: false,
        },
      ];
    },
  };
  const request = new Request(
    `https://api.example.com/v1/storefront/search?hostname=shop.example.com&q=linen%20shirt&category=shirts&availability=available&limit=12&cursor=${cursor}`,
  );
  const response = await handlePublicStorefrontRequest(
    request,
    new URL(request.url),
    database,
  );

  assert.equal(response.status, 200);
  assert.match(observedSql, /resolve_public_search\(\$1, \$2, \$3, \$4, \$5, \$6\)/u);
  assert.deepEqual(observedValues, [
    "shop.example.com",
    "linen shirt",
    "shirts",
    "available",
    12,
    cursor,
  ]);
  assert.equal((await response.json()).items[0].summary.productId, product.summary.productId);
});

test("buyer search forwards filters and renders active facets, clear action and hidden state", async () => {
  let observedOptions;
  const worker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    catalogResolverFactory: () => ({
      async resolveCatalog() { return null; },
      async resolveProduct() { return null; },
      async resolveCategory() { return null; },
      async resolveCollection() { return null; },
      async resolveSearch(_hostname, _query, options) {
        observedOptions = options;
        return selectedSearchPage;
      },
    }),
  });
  const response = await worker.fetch(
    new Request(
      "https://shop.example.com/search?q=linen%20shirt&category=shirts&availability=available",
    ),
    environment,
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(observedOptions.category, "shirts");
  assert.equal(observedOptions.availability, "available");
  assert.match(html, /aria-current="true"/u);
  assert.match(html, />Clear filters</u);
  assert.match(html, /name="category" value="shirts"/u);
  assert.match(html, /name="availability" value="available"/u);
  assert.match(html, /\/search\?q=linen\+shirt/u);
  assert.doesNotMatch(html, /tenant-1/u);
});

test("buyer search rejects unsupported filters before calling the resolver", async () => {
  let calls = 0;
  const worker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    catalogResolverFactory: () => ({
      async resolveCatalog() { return null; },
      async resolveProduct() { return null; },
      async resolveCategory() { return null; },
      async resolveCollection() { return null; },
      async resolveSearch() {
        calls += 1;
        return selectedSearchPage;
      },
    }),
  });
  const response = await worker.fetch(
    new Request(
      "https://shop.example.com/search?q=linen%20shirt&availability=everything",
    ),
    environment,
  );
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test("STF-0013 is checksum-registered and keeps filtered search runtime-only", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../database/modules/storefront/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const migration = manifest.migrations.find(({ id }) => id === "STF-0013");
assert.ok(migration);
assert.equal(migration.file, "STF-0013-public-search-filters.sql");
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
  );
  assert.match(
    sql,
    /resolve_public_search\(text,text,text,text,integer,uuid\)/u,
  );
  assert.match(sql, /publication\.public_slug = filters\.category_slug/u);
  assert.match(sql, /summary,availability.*filters\.availability/su);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION storefront\.resolve_public_search\(text,text,text,text,integer,uuid\) FROM PUBLIC/u,
  );
  assert.doesNotMatch(
    sql,
    /(?:INSERT INTO|UPDATE|DELETE FROM) (?:catalog|pricing|inventory)\./u,
  );
});
