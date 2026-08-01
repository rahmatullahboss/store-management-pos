import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveStorefrontOrderTrackingV1,
  formatStorefrontMoneyExactV1,
} from "../../build/packages/storefront-client/src/order-tracking.js";

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

function detail(overrides = {}) {
  return {
    contractVersion: "storefront-order-detail.v1",
    context,
    orderId: "018f0000-0000-4000-8000-000000000403",
    documentNumber: "SO-1001",
    orderRevision: "4",
    createdAt: "2026-08-01T12:10:00.000Z",
    updatedAt: "2026-08-01T12:20:00.000Z",
    orderStatus: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "partially_fulfilled",
    returnStatus: "not_returned",
    total: { currency: "GBP", minor: "1599", scale: 2 },
    fulfillmentMethod: "ship_from_store",
    lines: [
      {
        lineId: "018f0000-0000-4000-8000-000000000404",
        productId: "018f0000-0000-4000-8000-000000000405",
        variantId: "018f0000-0000-4000-8000-000000000406",
        sku: "SHIRT-BLUE-M",
        displayName: "Linen shirt",
        quantity: { amount: "125", unit: "metre", scale: 2 },
        unitPrice: { currency: "GBP", minor: "1199", scale: 2 },
        discount: { currency: "GBP", minor: "0", scale: 2 },
        tax: { currency: "GBP", minor: "100", scale: 2 },
        total: { currency: "GBP", minor: "1599", scale: 2 },
      },
    ],
    ...overrides,
  };
}

test("order tracking view contains only canonical buyer-safe facts", () => {
  const result = deriveStorefrontOrderTrackingV1(detail());

  assert.equal(result.viewVersion, "storefront-order-tracking-view.v1");
  assert.equal(result.state, "in_progress");
  assert.equal(result.totalLabel, "GBP 15.99");
  assert.equal(result.lines[0].label, "Linen shirt");
  assert.equal(result.lines[0].quantityLabel, "1.25 metre");
  assert.equal(result.lines[0].totalLabel, "GBP 15.99");
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "createdAt",
      "documentNumber",
      "fulfillmentMethod",
      "fulfillmentStatus",
      "lines",
      "orderId",
      "orderRevision",
      "orderStatus",
      "paymentStatus",
      "returnStatus",
      "state",
      "totalLabel",
      "updatedAt",
      "viewVersion",
    ].sort(),
  );
});

test("tracking state uses explicit canonical status precedence without invented timeline", () => {
  const cases = [
    [{ orderStatus: "draft", paymentStatus: "unpaid", fulfillmentStatus: "unfulfilled" }, "pending"],
    [{ orderStatus: "confirmed", paymentStatus: "paid", fulfillmentStatus: "unfulfilled" }, "in_progress"],
    [{ orderStatus: "on_hold" }, "attention"],
    [{ returnStatus: "partially_returned" }, "attention"],
    [{ paymentStatus: "partially_refunded" }, "attention"],
    [{ orderStatus: "completed", fulfillmentStatus: "fulfilled" }, "complete"],
    [{ paymentStatus: "refunded" }, "refunded"],
    [{ returnStatus: "returned" }, "returned"],
    [{ orderStatus: "cancelled" }, "cancelled"],
    [{ fulfillmentStatus: "cancelled" }, "cancelled"],
  ];
  for (const [overrides, expected] of cases) {
    assert.equal(deriveStorefrontOrderTrackingV1(detail(overrides)).state, expected);
  }
});

test("exact money formatting never converts integer minor values through binary floating point", () => {
  assert.equal(
    formatStorefrontMoneyExactV1({
      currency: "JPY",
      minor: "900719925474099312345678901234567890",
      scale: 0,
    }),
    "JPY 900719925474099312345678901234567890",
  );
  assert.equal(
    formatStorefrontMoneyExactV1({
      currency: "BHD",
      minor: "123456789012345678901",
      scale: 3,
    }),
    "BHD 123456789012345678.901",
  );
});

test("tracking model fails closed on non-canonical/internal order detail fields", () => {
  assert.throws(
    () => deriveStorefrontOrderTrackingV1(detail({ carrierTrackingUrl: "https://carrier.example/secret" })),
    /unsupported fields: carrierTrackingUrl/u,
  );
  assert.throws(
    () => deriveStorefrontOrderTrackingV1(detail({ estimatedDeliveryAt: "2026-08-02T00:00:00.000Z" })),
    /unsupported fields: estimatedDeliveryAt/u,
  );
  assert.throws(
    () => deriveStorefrontOrderTrackingV1(detail({ total: { currency: "GBP", minor: "15.99", scale: 2 } })),
    /minor must be an integer string/u,
  );
});
