import assert from "node:assert/strict";
import test from "node:test";

import { listStorefrontCustomerOrdersV1 } from "../../build/modules/storefront/src/customer-account.js";

const customerId = "018f0000-0000-4000-8000-000000000401";
const opaqueCursor = "modc:v2:page_00017.sig-abc_123";

const context = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});

const requestContext = Object.freeze({
  requestId: "request-pagination-1",
  traceId: "trace-pagination-1",
  tenantId: context.tenantId,
  actorId: "buyer-session-1",
  legalEntityId: "entity-1",
  storeId: "store-1",
  locale: context.locale,
  timeZone: "Europe/London",
  businessDate: "2026-08-02",
  region: "GB",
  permissions: new Set(["customer.profile.read", "sales.order.read"]),
});

const principal = Object.freeze({
  principalVersion: "storefront-account-principal.v1",
  source: "authenticated-session",
  customerId,
  requestContext,
});

function request(cursor = null) {
  return Object.freeze({
    contractVersion: "storefront-order-history-request.v1",
    cursor,
    limit: 20,
  });
}

test("customer order boundary forwards and projects an opaque canonical cursor without interpreting it", async () => {
  let observed;
  const page = await listStorefrontCustomerOrdersV1(
    {
      async listForCustomer(input) {
        observed = input;
        return { records: [], nextCursor: opaqueCursor };
      },
      async getForCustomer() {
        throw new Error("not used");
      },
    },
    { principal, context, request: request(opaqueCursor) },
  );

  assert.equal(observed.requestContext, requestContext);
  assert.equal(observed.customerId, customerId);
  assert.equal(observed.storefrontId, context.storefrontId);
  assert.equal(observed.salesChannelId, context.salesChannelId);
  assert.equal(observed.cursor, opaqueCursor);
  assert.equal(observed.limit, 20);
  assert.equal(page.nextCursor, opaqueCursor);
  assert.deepEqual(page.items, []);
});

test("customer order boundary rejects unsafe owning-module cursor output", async () => {
  await assert.rejects(
    listStorefrontCustomerOrdersV1(
      {
        async listForCustomer() {
          return { records: [], nextCursor: "unsafe/provider/cursor" };
        },
        async getForCustomer() {
          throw new Error("not used");
        },
      },
      { principal, context, request: request() },
    ),
    /bounded URL-safe opaque token/u,
  );
});
