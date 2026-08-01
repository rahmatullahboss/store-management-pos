import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStorefrontCustomerAccountV1,
  parseStorefrontOrderDetailV1,
  parseStorefrontOrderHistoryPageV1,
  parseStorefrontOrderHistoryRequestV1,
} from "../../build/packages/storefront-contracts/src/customer-account.js";

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

const customerId = "018f0000-0000-4000-8000-000000000401";
const addressId = "018f0000-0000-4000-8000-000000000402";
const orderId = "018f0000-0000-4000-8000-000000000403";
const lineId = "018f0000-0000-4000-8000-000000000404";
const productId = "018f0000-0000-4000-8000-000000000405";
const variantId = "018f0000-0000-4000-8000-000000000406";

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

test("customer account contract accepts only bounded private-profile projection fields", () => {
  assert.deepEqual(parseStorefrontCustomerAccountV1(account()), account());

  assert.throws(
    () => parseStorefrontCustomerAccountV1(account({ creditProfile: { balanceMinor: "999" } })),
    /unsupported fields: creditProfile/u,
  );
  assert.throws(
    () => parseStorefrontCustomerAccountV1(account({ contacts: [{ type: "website", value: "https:\/\/example.com", primary: true, verified: false }] })),
    /type is unsupported/u,
  );
});

test("order history request is bounded and carries no browser customer identity", () => {
  assert.deepEqual(
    parseStorefrontOrderHistoryRequestV1({
      contractVersion: "storefront-order-history-request.v1",
      cursor: null,
      limit: 20,
    }),
    {
      contractVersion: "storefront-order-history-request.v1",
      cursor: null,
      limit: 20,
    },
  );

  assert.throws(
    () => parseStorefrontOrderHistoryRequestV1({
      contractVersion: "storefront-order-history-request.v1",
      customerId,
      cursor: null,
      limit: 20,
    }),
    /unsupported fields: customerId/u,
  );
  assert.throws(
    () => parseStorefrontOrderHistoryRequestV1({
      contractVersion: "storefront-order-history-request.v1",
      cursor: null,
      limit: 500,
    }),
    /between 1 and 50/u,
  );
});

test("order history and detail preserve exact integer money and reject internal authority fields", () => {
  const history = {
    contractVersion: "storefront-order-history.v1",
    context,
    items: [summary()],
    nextCursor: null,
  };
  assert.deepEqual(parseStorefrontOrderHistoryPageV1(history), history);
  assert.deepEqual(parseStorefrontOrderDetailV1(detail()), detail());

  assert.throws(
    () => parseStorefrontOrderDetailV1(detail({ warehouseId: "warehouse-secret" })),
    /unsupported fields: warehouseId/u,
  );
  assert.throws(
    () => parseStorefrontOrderDetailV1(detail({ total: { currency: "GBP", minor: "15.99", scale: 2 } })),
    /minor must be an integer string/u,
  );
  assert.throws(
    () => parseStorefrontOrderDetailV1(detail({
      lines: [{ ...detail().lines[0], tax: { currency: "USD", minor: "100", scale: 2 } }],
    })),
    /money values must use one currency and scale/u,
  );
});
