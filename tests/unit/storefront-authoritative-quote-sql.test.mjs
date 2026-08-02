import assert from "node:assert/strict";
import test from "node:test";

import { SqlStorefrontPublishedCartItemPort } from "../../build/modules/storefront/src/authoritative-quote-sql.js";

const context = Object.freeze({
  tenantId: "018f0000-0000-4000-8000-000000000001",
  storefrontId: "018f0000-0000-4000-8000-000000000002",
  salesChannelId: "018f0000-0000-4000-8000-000000000003",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});
const productId = "018f0000-0000-4000-8000-000000000101";
const variantId = "018f0000-0000-4000-8000-000000000201";

function database(rows) {
  return {
    calls: [],
    async httpQuery(sql, params) {
      this.calls.push({ sql, params });
      return structuredClone(rows);
    },
  };
}

test("published cart item resolver uses host-scoped publication composition and exact UUID pair", async () => {
  const db = database([
    {
      productId,
      variantId,
      sku: "SKU-1",
      displayName: "Canonical Product",
    },
  ]);
  const port = new SqlStorefrontPublishedCartItemPort(db);

  const item = await port.resolve({ context, productId, variantId });

  assert.deepEqual(item, {
    itemId: productId,
    variantId,
    sku: "SKU-1",
    displayNameSnapshot: "Canonical Product",
  });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /storefront\.compose_public_product_documents/u);
  assert.match(db.calls[0].sql, /document\.product_id = \$6::uuid/u);
  assert.match(db.calls[0].sql, /variant\.value ->> 'variantId' = \$7::text/u);
  assert.deepEqual(db.calls[0].params, [
    context.tenantId,
    context.storefrontId,
    context.salesChannelId,
    context.locale,
    context.currency,
    productId,
    variantId,
  ]);
});

test("published cart item resolver returns null when publication projection does not contain the pair", async () => {
  const db = database([]);
  const port = new SqlStorefrontPublishedCartItemPort(db);

  assert.equal(await port.resolve({ context, productId, variantId }), null);
});

test("published cart item resolver fails closed on duplicate or mismatched projection rows", async () => {
  const duplicate = database([
    { productId, variantId, sku: null, displayName: null },
    { productId, variantId, sku: null, displayName: null },
  ]);
  await assert.rejects(
    new SqlStorefrontPublishedCartItemPort(duplicate).resolve({
      context,
      productId,
      variantId,
    }),
    /duplicate rows/u,
  );

  const mismatch = database([
    {
      productId,
      variantId: "018f0000-0000-4000-8000-000000000999",
      sku: null,
      displayName: null,
    },
  ]);
  await assert.rejects(
    new SqlStorefrontPublishedCartItemPort(mismatch).resolve({
      context,
      productId,
      variantId,
    }),
    /mismatched identity/u,
  );
});
