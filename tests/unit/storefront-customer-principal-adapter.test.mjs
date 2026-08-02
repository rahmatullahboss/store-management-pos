import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontAuthenticatedCustomerPrincipalResolver } from "../../build/modules/storefront/src/customer-principal-adapter.js";

const customerId = "018f0000-0000-4000-8000-000000000401";
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
  requestId: "request-1",
  traceId: "trace-1",
  tenantId: context.tenantId,
  actorId: "buyer-1",
  legalEntityId: "entity-1",
  storeId: "store-1",
  locale: context.locale,
  timeZone: "Europe/London",
  businessDate: "2026-08-01",
  region: "GB",
  permissions: new Set(["sales.quote.create", "customer.profile.read"]),
});

function customer(overrides = {}) {
  return {
    id: customerId,
    tenantId: context.tenantId,
    legalEntityId: requestContext.legalEntityId,
    kind: "person",
    displayName: "Canonical Buyer",
    contacts: [],
    addresses: [],
    tags: [],
    groups: [],
    taxRegistrations: [],
    consentHistory: [],
    historicalCustomerIds: [],
    status: "active",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    createdBy: requestContext.actorId,
    updatedBy: requestContext.actorId,
    version: 1n,
    ...overrides,
  };
}

test("authenticated principal resolver returns the active canonical MOD-C customer", async () => {
  let observedContext;
  let observedCustomerId;
  const resolver = createStorefrontAuthenticatedCustomerPrincipalResolver(
    {
      async get(ctx, id) {
        observedContext = ctx;
        observedCustomerId = id;
        return customer();
      },
    },
    { requestContext },
  );

  const result = await resolver.resolve({
    context,
    requestedCustomerId: customerId,
  });

  assert.equal(observedContext, requestContext);
  assert.equal(observedCustomerId, customerId);
  assert.equal(result.requestContext, requestContext);
  assert.deepEqual(result.customer, {
    customerId,
    displayNameSnapshot: "Canonical Buyer",
  });
});

test("authenticated principal resolver does not synthesize a guest customer", async () => {
  let calls = 0;
  const resolver = createStorefrontAuthenticatedCustomerPrincipalResolver(
    {
      async get() {
        calls += 1;
        return customer();
      },
    },
    { requestContext },
  );

  assert.equal(
    await resolver.resolve({ context, requestedCustomerId: null }),
    null,
  );
  assert.equal(calls, 0);
});

test("authenticated principal resolver requires existing sales and customer permissions", async () => {
  const unprivileged = {
    ...requestContext,
    permissions: new Set(["customer.profile.read"]),
  };
  const resolver = createStorefrontAuthenticatedCustomerPrincipalResolver(
    { async get() { throw new Error("unexpected"); } },
    { requestContext: unprivileged },
  );

  await assert.rejects(
    resolver.resolve({ context, requestedCustomerId: customerId }),
    /lacks canonical checkout permissions/u,
  );
  assert.equal(unprivileged.permissions.has("sales.quote.create"), false);
});

test("authenticated principal resolver fails closed on tenant locale legal-entity and customer scope mismatch", async () => {
  const wrongTenant = {
    ...requestContext,
    tenantId: "tenant-2",
  };
  await assert.rejects(
    createStorefrontAuthenticatedCustomerPrincipalResolver(
      { async get() { throw new Error("unexpected"); } },
      { requestContext: wrongTenant },
    ).resolve({ context, requestedCustomerId: customerId }),
    /does not match checkout scope/u,
  );

  await assert.rejects(
    createStorefrontAuthenticatedCustomerPrincipalResolver(
      { async get() { return customer({ status: "merged", mergedIntoId: "customer-2" }); } },
      { requestContext },
    ).resolve({ context, requestedCustomerId: customerId }),
    /invalid canonical customer/u,
  );

  await assert.rejects(
    createStorefrontAuthenticatedCustomerPrincipalResolver(
      { async get() { return customer({ legalEntityId: "entity-2" }); } },
      { requestContext },
    ).resolve({ context, requestedCustomerId: customerId }),
    /legal-entity scope mismatch/u,
  );
});
