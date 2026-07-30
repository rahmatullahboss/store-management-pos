import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handlePublicStorefrontRequest } from "../../build/apps/api/src/modules/storefront/public-handler.js";
import { createStorefrontWorker } from "../../build/apps/storefront-web/src/index.js";
import { createStorefrontClient } from "../../build/packages/storefront-client/src/index.js";
import {
  parseStorefrontPublicCatalogPageV1,
  parseStorefrontPublicProductDetailV1,
} from "../../build/packages/storefront-contracts/src/public-catalog.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";

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
    compareAtPrice: { currency: "GBP", minor: "3099", scale: 2 },
    media: null,
    badge: "New",
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
      compareAtPrice: { currency: "GBP", minor: "3099", scale: 2 },
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

const catalogPayload = {
  contractVersion: "storefront-public-catalog.v1",
  context,
  items: [product],
  nextCursor: null,
  hasMore: false,
};

const detailPayload = {
  contractVersion: "storefront-public-product.v1",
  context,
  product,
};

const catalog = parseStorefrontPublicCatalogPageV1(catalogPayload);
const detail = parseStorefrontPublicProductDetailV1(detailPayload);
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
  STOREFRONT_BUILD_ID: "build-catalog-1",
};

function databaseRow(overrides = {}) {
  return [{
    ...context,
    productDocuments: [product],
    nextCursor: null,
    hasMore: false,
    productDocument: product,
    ...overrides,
  }];
}

test("public catalog contract preserves exact money and bounded availability", () => {
  assert.equal(catalog.items[0].summary.price.minor, "2599");
  assert.equal(catalog.items[0].variants[0].quantity.amount, "7");
  assert.equal(detail.product.summary.compareAtPrice.minor, "3099");

  assert.throws(
    () => parseStorefrontPublicCatalogPageV1({
      ...catalogPayload,
      items: [{
        ...product,
        variants: [{
          ...product.variants[0],
          price: { currency: "USD", minor: "2599", scale: 2 },
          compareAtPrice: { currency: "USD", minor: "3099", scale: 2 },
        }],
      }],
    }),
    /currency must match storefront context/u,
  );
  assert.throws(
    () => parseStorefrontPublicProductDetailV1({
      ...detailPayload,
      product: {
        ...product,
        variants: [{
          ...product.variants[0],
          availability: "unavailable",
          quantity: { ...product.variants[0].quantity, amount: "1" },
        }],
      },
    }),
    /cannot expose positive available quantity/u,
  );
  assert.throws(
    () => parseStorefrontPublicCatalogPageV1({
      ...catalogPayload,
      items: Array.from({ length: 49 }, () => product),
    }),
    /catalog items are invalid/u,
  );
});

test("typed client normalizes listing cursor, limit and product slug", async () => {
  const observed = [];
  const client = createStorefrontClient({
    baseUrl: "https://api.example.com",
    transport: {
      async fetch(input) {
        const url = String(input);
        observed.push(url);
        return Response.json(url.includes("/catalog") ? catalogPayload : detailPayload);
      },
    },
  });

  const cursor = "018F0000-0000-4000-8000-000000000010";
  await client.getCatalog("SHOP.EXAMPLE.COM.", { limit: 12, cursor });
  await client.getProduct("SHOP.EXAMPLE.COM.", " Linen-Shirt ");

  assert.equal(
    observed[0],
    "https://api.example.com/v1/storefront/catalog?hostname=shop.example.com&limit=12&cursor=018f0000-0000-4000-8000-000000000010",
  );
  assert.equal(
    observed[1],
    "https://api.example.com/v1/storefront/products/linen-shirt?hostname=shop.example.com",
  );
  await assert.rejects(
    () => client.getCatalog("shop.example.com", { limit: 49 }),
    /catalog limit/u,
  );
});

test("public API exposes bounded listing and detail without authentication", async () => {
  const queries = [];
  const database = {
    async httpQuery(sql, values) {
      queries.push({ sql, values });
      return databaseRow();
    },
  };

  const listingRequest = new Request(
    "https://api.example.com/v1/storefront/catalog?hostname=shop.example.com&limit=1",
  );
  const listing = await handlePublicStorefrontRequest(
    listingRequest,
    new URL(listingRequest.url),
    database,
  );
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).items[0].summary.slug, "linen-shirt");
  assert.deepEqual(queries[0].values, ["shop.example.com", 1, null]);
  assert.match(queries[0].sql, /resolve_public_catalog/u);

  const detailRequest = new Request(
    "https://api.example.com/v1/storefront/products/linen-shirt?hostname=shop.example.com",
  );
  const productResponse = await handlePublicStorefrontRequest(
    detailRequest,
    new URL(detailRequest.url),
    database,
  );
  assert.equal(productResponse.status, 200);
  assert.equal((await productResponse.json()).product.code, "LINEN-SHIRT");
  assert.deepEqual(queries[1].values, ["shop.example.com", "linen-shirt"]);
  assert.match(queries[1].sql, /resolve_public_product/u);
});

test("buyer worker renders catalog and product detail with exact operational state", async () => {
  const worker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    catalogResolverFactory: () => ({
      async resolveCatalog() { return catalog; },
      async resolveProduct() { return detail; },
    }),
  });

  const listing = await worker.fetch(
    new Request("https://shop.example.com/products"),
    environment,
  );
  const listingHtml = await listing.text();
  assert.equal(listing.status, 200);
  assert.match(listingHtml, /Published catalog/u);
  assert.match(listingHtml, /Linen Shirt/u);
  assert.match(listingHtml, /£25\.99/u);
  assert.match(listingHtml, /Tax calculated at checkout/u);
  assert.doesNotMatch(listingHtml, /tenant-1/u);

  const productResponse = await worker.fetch(
    new Request("https://shop.example.com/products/linen-shirt"),
    environment,
  );
  const productHtml = await productResponse.text();
  assert.equal(productResponse.status, 200);
  assert.match(productHtml, /A breathable linen shirt/u);
  assert.match(productHtml, /7 EA available/u);
  assert.match(productHtml, /Promotions and tax are calculated and revalidated at checkout/u);
});

test("buyer worker fails closed on catalog scope mismatch and returns product 404", async () => {
  const mismatched = parseStorefrontPublicCatalogPageV1({
    ...catalogPayload,
    context: { ...context, tenantId: "tenant-2" },
  });
  const mismatchWorker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    catalogResolverFactory: () => ({
      async resolveCatalog() { return mismatched; },
      async resolveProduct() { return detail; },
    }),
  });
  const mismatch = await mismatchWorker.fetch(
    new Request("https://shop.example.com/products"),
    environment,
  );
  assert.equal(mismatch.status, 404);
  assert.doesNotMatch(await mismatch.text(), /tenant-2/u);

  const missingWorker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    catalogResolverFactory: () => ({
      async resolveCatalog() { return catalog; },
      async resolveProduct() { return null; },
    }),
  });
  const missing = await missingWorker.fetch(
    new Request("https://shop.example.com/products/missing"),
    environment,
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "PRODUCT_NOT_FOUND");
});

test("STF-0009 and STF-0010 compose public catalog authority read-only", async () => {
  const compositionSql = await readFile(
    new URL(
      "../../database/modules/storefront/migrations/STF-0009-public-catalog-resolution.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const endpointSql = await readFile(
    new URL(
      "../../database/modules/storefront/migrations/STF-0010-public-catalog-endpoints.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(compositionSql, /JOIN catalog\.products p/u);
  assert.match(compositionSql, /JOIN pricing\.price_lists pl/u);
  assert.match(compositionSql, /FROM inventory\.stock_balances sb/u);
  assert.match(compositionSql, /FROM inventory\.stock_reservation_lines line/u);
  assert.match(compositionSql, /pp\.publication_state = 'published'/u);
  assert.match(compositionSql, /COALESCE\(vp\.publication_state, 'published'\) = 'published'/u);
  assert.doesNotMatch(compositionSql, /INSERT INTO (?:catalog|pricing|inventory)\./u);
  assert.doesNotMatch(compositionSql, /UPDATE (?:catalog|pricing|inventory)\./u);
  assert.match(endpointSql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_catalog/u);
  assert.match(endpointSql, /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_catalog/u);
  assert.match(endpointSql, /ORDER BY page\.product_id DESC/u);
});
