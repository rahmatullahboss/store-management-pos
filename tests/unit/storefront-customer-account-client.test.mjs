import assert from "node:assert/strict";
import test from "node:test";

import {
  requestStorefrontCustomerAccount,
  requestStorefrontCustomerOrder,
  requestStorefrontCustomerOrders,
} from "../../build/packages/storefront-client/src/customer-account.js";
import { StorefrontClientError } from "../../build/packages/storefront-client/src/index.js";

const hostname = "shop.example.com";
const customerId = "018f0000-0000-4000-8000-000000000401";
const addressId = "018f0000-0000-4000-8000-000000000402";
const orderId = "018f0000-0000-4000-8000-000000000403";
const lineId = "018f0000-0000-4000-8000-000000000404";
const productId = "018f0000-0000-4000-8000-000000000405";
const variantId = "018f0000-0000-4000-8000-000000000406";

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

function account(overrides = {}) {
  return {
    contractVersion: "storefront-customer-account.v1",
    context,
    customerId,
    kind: "person",
    displayName: "Canonical Buyer",
    contacts: [
      { type: "email", value: "buyer@example.com", primary: true, verified: true },
    ],
    addresses: [
      {
        id: addressId,
        type: "shipping",
        line1: "10 Market Street",
        line2: null,
        city: "London",
        region: null,
        postalCode: "SW1A 1AA",
        countryCode: "GB",
        primary: true,
      },
    ],
    profileRevision: "7",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides = {}) {
  return {
    orderId,
    documentNumber: "SO-1001",
    orderRevision: "4",
    createdAt: "2026-08-01T12:10:00.000Z",
    updatedAt: "2026-08-01T12:20:00.000Z",
    orderStatus: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "partially_fulfilled",
    returnStatus: "not_returned",
    total: { currency: "GBP", minor: "1599", scale: 2 },
    ...overrides,
  };
}

function history(overrides = {}) {
  return {
    contractVersion: "storefront-order-history.v1",
    context,
    items: [summary()],
    nextCursor: null,
    ...overrides,
  };
}

function detail(overrides = {}) {
  return {
    contractVersion: "storefront-order-detail.v1",
    context,
    ...summary(),
    fulfillmentMethod: "ship_from_store",
    lines: [
      {
        lineId,
        productId,
        variantId,
        sku: "SHIRT-BLUE-M",
        displayName: "Linen shirt",
        quantity: { amount: "1", unit: "each", scale: 0 },
        unitPrice: { currency: "GBP", minor: "1499", scale: 2 },
        discount: { currency: "GBP", minor: "0", scale: 2 },
        tax: { currency: "GBP", minor: "100", scale: 2 },
        total: { currency: "GBP", minor: "1599", scale: 2 },
      },
    ],
    ...overrides,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function captureTransport(responder) {
  const calls = [];
  return {
    calls,
    transport: {
      async fetch(input, init) {
        calls.push({ url: String(input), init });
        return responder(input, init);
      },
    },
  };
}

test("customer account client is credentialed no-store and never sends customer identity", async () => {
  const captured = captureTransport(() => json(account()));
  const result = await requestStorefrontCustomerAccount(
    { baseUrl: "https://api.example.com/gateway/", transport: captured.transport },
    "SHOP.EXAMPLE.COM",
  );

  assert.equal(result.customerId, customerId);
  assert.equal(captured.calls.length, 1);
  const call = captured.calls[0];
  const url = new URL(call.url);
  assert.equal(url.pathname, "/gateway/v1/storefront/account");
  assert.equal(url.searchParams.get("hostname"), hostname);
  assert.equal(url.searchParams.has("customerId"), false);
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.credentials, "include");
  assert.equal(call.init.body, undefined);
});

test("order history client validates page options and sends only cursor/limit/hostname", async () => {
  const cursor = "018f0000-0000-4000-8000-000000000499";
  const captured = captureTransport(() => json(history()));
  await requestStorefrontCustomerOrders(
    { baseUrl: "https://api.example.com/", transport: captured.transport },
    hostname,
    { cursor, limit: 25 },
  );

  const url = new URL(captured.calls[0].url);
  assert.equal(url.pathname, "/v1/storefront/account/orders");
  assert.equal(url.searchParams.get("hostname"), hostname);
  assert.equal(url.searchParams.get("cursor"), cursor);
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.has("customerId"), false);
  assert.equal(captured.calls[0].init.cache, "no-store");
  assert.equal(captured.calls[0].init.credentials, "include");

  await assert.rejects(
    requestStorefrontCustomerOrders(
      { baseUrl: "https://api.example.com/", transport: captured.transport },
      hostname,
      { limit: 51 },
    ),
    /between 1 and 50/u,
  );
});

test("private client preserves auth failures and rejects scope/identity mismatch", async () => {
  const unauthorized = captureTransport(() => json({ error: { code: "UNAUTHENTICATED" } }, 401));
  await assert.rejects(
    requestStorefrontCustomerAccount(
      { baseUrl: "https://api.example.com", transport: unauthorized.transport },
      hostname,
    ),
    (error) => error instanceof StorefrontClientError && error.status === 401,
  );

  const forbidden = captureTransport(() => json({ error: { code: "FORBIDDEN" } }, 403));
  await assert.rejects(
    requestStorefrontCustomerOrders(
      { baseUrl: "https://api.example.com", transport: forbidden.transport },
      hostname,
    ),
    (error) => error instanceof StorefrontClientError && error.status === 403,
  );

  const wrongHost = captureTransport(() =>
    json(account({ context: { ...context, requestHostname: "other.example.com", canonicalHostname: "other.example.com" } })),
  );
  await assert.rejects(
    requestStorefrontCustomerAccount(
      { baseUrl: "https://api.example.com", transport: wrongHost.transport },
      hostname,
    ),
    /hostname mismatch/u,
  );

  const wrongOrder = captureTransport(() =>
    json(detail({ orderId: "018f0000-0000-4000-8000-000000000498" })),
  );
  await assert.rejects(
    requestStorefrontCustomerOrder(
      { baseUrl: "https://api.example.com", transport: wrongOrder.transport },
      hostname,
      orderId,
    ),
    /order identity mismatch/u,
  );
});

test("private client rejects unsafe endpoints and malformed/internal response authority", async () => {
  await assert.rejects(
    requestStorefrontCustomerAccount(
      { baseUrl: "http://api.example.com" },
      hostname,
    ),
    /safe HTTPS/u,
  );

  const internalLeak = captureTransport(() =>
    json(detail({ warehouseId: "warehouse-secret" })),
  );
  await assert.rejects(
    requestStorefrontCustomerOrder(
      { baseUrl: "https://api.example.com", transport: internalLeak.transport },
      hostname,
      orderId,
    ),
    /unsupported fields: warehouseId/u,
  );

  const fractionalMoney = captureTransport(() =>
    json(detail({ total: { currency: "GBP", minor: "15.99", scale: 2 } })),
  );
  await assert.rejects(
    requestStorefrontCustomerOrder(
      { baseUrl: "https://api.example.com", transport: fractionalMoney.transport },
      hostname,
      orderId,
    ),
    /minor must be an integer string/u,
  );
});
