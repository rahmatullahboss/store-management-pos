import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleStorefrontCustomerAccountRequest } from "../../build/apps/api/src/modules/storefront/customer-account-handler.js";

const hostname = "shop.example.com";
const customerId = "018f0000-0000-4000-8000-000000000401";
const orderId = "018f0000-0000-4000-8000-000000000403";

const context = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: hostname,
  canonicalHostname: hostname,
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});
const bootstrap = Object.freeze({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "3",
  layoutRevision: "5",
  capabilities: [],
});
const requestContext = Object.freeze({
  requestId: "request-1",
  traceId: "trace-1",
  tenantId: context.tenantId,
  actorId: "buyer-session-1",
  legalEntityId: "entity-1",
  storeId: "store-1",
  locale: context.locale,
  timeZone: "Europe/London",
  businessDate: "2026-08-01",
  region: "GB",
  permissions: new Set(["customer.profile.read", "sales.order.read"]),
});
const principal = Object.freeze({
  principalVersion: "storefront-account-principal.v1",
  source: "authenticated-session",
  customerId,
  requestContext,
});

function customer() {
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
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    createdBy: "staff-1",
    updatedBy: "staff-1",
    version: 3n,
  };
}

function dependencies(overrides = {}) {
  return {
    repository: {
      async resolveBootstrap(requestHostname) {
        assert.equal(requestHostname, hostname);
        return bootstrap;
      },
    },
    principalResolver: {
      async resolve() {
        return principal;
      },
    },
    customerService: {
      async get(ctx, id) {
        assert.equal(ctx, requestContext);
        assert.equal(id, customerId);
        return customer();
      },
    },
    orderRead: {
      async listForCustomer(input) {
        assert.equal(input.requestContext, requestContext);
        assert.equal(input.customerId, customerId);
        assert.equal(input.storefrontId, context.storefrontId);
        assert.equal(input.salesChannelId, context.salesChannelId);
        return { records: [], nextCursor: null };
      },
      async getForCustomer(input) {
        assert.equal(input.requestContext, requestContext);
        assert.equal(input.customerId, customerId);
        assert.equal(input.storefrontId, context.storefrontId);
        assert.equal(input.salesChannelId, context.salesChannelId);
        assert.equal(input.orderId, orderId);
        return null;
      },
    },
    ...overrides,
  };
}

async function body(response) {
  return await response.json();
}

function assertPrivateHeaders(response) {
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-cache, no-store, must-revalidate",
  );
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("vary"), "Authorization, Cookie");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("private account handler requires trusted authentication and never calls profile authority when absent", async () => {
  let profileCalls = 0;
  const deps = dependencies({
    principalResolver: { async resolve() { return null; } },
    customerService: { async get() { profileCalls += 1; throw new Error("unexpected"); } },
  });
  const url = new URL(`https://${hostname}/v1/storefront/account?hostname=${hostname}`);
  const response = await handleStorefrontCustomerAccountRequest(
    deps,
    new Request(url),
    url,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: { code: "AUTHENTICATION_REQUIRED" } });
  assert.equal(profileCalls, 0);
  assertPrivateHeaders(response);
});

test("private account handler rejects browser customer identity before principal resolution", async () => {
  let principalCalls = 0;
  const deps = dependencies({
    principalResolver: { async resolve() { principalCalls += 1; return principal; } },
  });
  const url = new URL(
    `https://${hostname}/v1/storefront/account?hostname=${hostname}&customerId=${customerId}`,
  );
  const response = await handleStorefrontCustomerAccountRequest(
    deps,
    new Request(url),
    url,
  );

  assert.equal(response.status, 400);
  assert.equal((await body(response)).error.code, "INVALID_ACCOUNT_REQUEST");
  assert.equal(principalCalls, 0);
  assertPrivateHeaders(response);
});

test("private account profile returns only projected buyer fields with private cache controls", async () => {
  const url = new URL(`https://${hostname}/v1/storefront/account?hostname=${hostname}`);
  const response = await handleStorefrontCustomerAccountRequest(
    dependencies(),
    new Request(url, { headers: { Cookie: "session=opaque" } }),
    url,
  );

  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.contractVersion, "storefront-customer-account.v1");
  assert.equal(payload.customerId, customerId);
  assert.equal(payload.profileRevision, "3");
  assert.equal(JSON.stringify(payload).includes("staff-1"), false);
  assertPrivateHeaders(response);
});

test("private order history is bounded and order detail not-found does not expose other data", async () => {
  const historyUrl = new URL(
    `https://${hostname}/v1/storefront/account/orders?hostname=${hostname}&limit=25`,
  );
  const historyResponse = await handleStorefrontCustomerAccountRequest(
    dependencies(),
    new Request(historyUrl),
    historyUrl,
  );
  assert.equal(historyResponse.status, 200);
  assert.deepEqual((await body(historyResponse)).items, []);
  assertPrivateHeaders(historyResponse);

  const invalidLimit = new URL(
    `https://${hostname}/v1/storefront/account/orders?hostname=${hostname}&limit=51`,
  );
  const invalidResponse = await handleStorefrontCustomerAccountRequest(
    dependencies(),
    new Request(invalidLimit),
    invalidLimit,
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal((await body(invalidResponse)).error.code, "INVALID_ACCOUNT_REQUEST");

  const detailUrl = new URL(
    `https://${hostname}/v1/storefront/account/orders/${orderId}?hostname=${hostname}`,
  );
  const detailResponse = await handleStorefrontCustomerAccountRequest(
    dependencies(),
    new Request(detailUrl),
    detailUrl,
  );
  assert.equal(detailResponse.status, 404);
  assert.deepEqual(await body(detailResponse), { error: { code: "ORDER_NOT_FOUND" } });
  assertPrivateHeaders(detailResponse);
});

test("private account handler is GET-only and remains unregistered from storefront runtime routers", async () => {
  const url = new URL(`https://${hostname}/v1/storefront/account?hostname=${hostname}`);
  const response = await handleStorefrontCustomerAccountRequest(
    dependencies(),
    new Request(url, { method: "POST" }),
    url,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assertPrivateHeaders(response);

  const routerSources = await Promise.all([
    readFile(new URL("../../apps/api/src/modules/storefront/handler.ts", import.meta.url), "utf8"),
    readFile(new URL("../../apps/api/src/modules/storefront/public-handler.ts", import.meta.url), "utf8"),
  ]);
  for (const source of routerSources) {
    assert.equal(source.includes("customer-account-handler"), false);
    assert.equal(source.includes("handleStorefrontCustomerAccountRequest"), false);
    assert.equal(source.includes("/v1/storefront/account"), false);
  }
});
