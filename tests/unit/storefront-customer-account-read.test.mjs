import assert from "node:assert/strict";
import test from "node:test";

import {
  listStorefrontCustomerOrdersV1,
  readStorefrontCustomerAccountV1,
  readStorefrontCustomerOrderV1,
} from "../../build/modules/storefront/src/customer-account.js";

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

function customer(overrides = {}) {
  return {
    id: customerId,
    tenantId: context.tenantId,
    legalEntityId: requestContext.legalEntityId,
    kind: "person",
    displayName: "Canonical Buyer",
    contacts: [
      {
        id: "018f0000-0000-4000-8000-000000000411",
        type: "email",
        value: "buyer@example.com",
        normalizedValue: "buyer@example.com",
        primary: true,
        verifiedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "018f0000-0000-4000-8000-000000000412",
        type: "website",
        value: "https://private.example.com",
        normalizedValue: "https://private.example.com",
        primary: false,
      },
    ],
    addresses: [
      {
        id: addressId,
        type: "shipping",
        line1: "10 Market Street",
        city: "London",
        postalCode: "SW1A 1AA",
        countryCode: "GB",
        primary: true,
      },
    ],
    tags: ["vip-internal"],
    groups: ["wholesale-internal"],
    taxRegistrations: [{ countryCode: "GB", registrationType: "VAT", registrationNumber: "SECRET-VAT" }],
    consentHistory: [{
      id: "consent-secret",
      channel: "email",
      purpose: "marketing",
      granted: true,
      source: "admin",
      recordedAt: "2026-07-01T00:00:00.000Z",
      recordedBy: "staff-secret",
    }],
    creditProfile: {
      currency: "GBP",
      limitMinor: 100000n,
      balanceMinor: 50000n,
      paymentTermsDays: 30,
      status: "active",
      updatedAt: "2026-07-01T00:00:00.000Z",
      updatedBy: "staff-secret",
    },
    historicalCustomerIds: [],
    status: "active",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    createdBy: "staff-secret",
    updatedBy: "staff-secret",
    version: 7n,
    ...overrides,
  };
}

function money(amountMinor) {
  return { amountMinor, currency: "GBP", scale: 2 };
}

function order(overrides = {}) {
  return {
    id: orderId,
    tenantId: context.tenantId,
    legalEntityId: requestContext.legalEntityId,
    storeId: requestContext.storeId,
    documentNumber: "SO-1001",
    customer: { customerId, displayNameSnapshot: "Canonical Buyer" },
    currency: "GBP",
    lines: [
      {
        id: lineId,
        item: {
          itemId: productId,
          variantId,
          sku: "SHIRT-BLUE-M",
          displayNameSnapshot: "Linen shirt",
        },
        quantity: { amount: "1", unit: "each", scale: 0 },
        priceTaxSnapshot: {
          schemaVersion: "1.0",
          calculationId: "calc-secret",
          item: {
            itemId: productId,
            variantId,
            sku: "SHIRT-BLUE-M",
            displayNameSnapshot: "Linen shirt",
          },
          quantity: { amount: "1", unit: "each", scale: 0 },
          originalUnitPrice: money("1499"),
          effectiveUnitPrice: money("1499"),
          discountTotal: money("0"),
          taxableBase: money("1499"),
          taxes: [
            {
              taxCode: "VAT",
              jurisdictionId: "GB",
              rateBasisPoints: "667",
              amount: money("100"),
              inclusive: false,
              ruleVersion: "vat-secret-v1",
            },
          ],
          grossTotal: money("1599"),
          roundingAdjustment: money("0"),
          appliedRuleVersions: ["price-secret-v1", "vat-secret-v1"],
          calculatedAt: "2026-08-01T12:09:00.000Z",
        },
      },
    ],
    total: {
      netMinor: 1499n,
      discountMinor: 0n,
      taxMinor: 100n,
      grossMinor: 1599n,
      currency: "GBP",
      scale: 2,
    },
    fulfillmentMethod: "ship_from_store",
    warehouseId: "warehouse-secret",
    paymentTerms: "prepaid",
    availabilityMode: "standard",
    reservationId: "reservation-secret",
    orderStatus: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "partially_fulfilled",
    invoiceStatus: "invoiced",
    returnStatus: "not_returned",
    backorderStatus: "none",
    payments: [
      {
        intentId: "payment-intent-secret",
        status: "captured",
        amountMinor: 1599n,
        currency: "GBP",
        observedAt: "2026-08-01T12:11:00.000Z",
      },
    ],
    fulfillmentObservations: [
      {
        status: "partially_fulfilled",
        fulfilledQuantities: [{ orderLineId: lineId, quantity: { amount: "1", unit: "each", scale: 0 } }],
        backorderedQuantities: [],
        observedAt: "2026-08-01T12:15:00.000Z",
      },
    ],
    salespersonId: "staff-secret",
    commissionBasisMetadata: { internal: "secret" },
    notes: ["[internal] secret note", "[customer] safe note"],
    attachments: [{ id: "attachment-secret", name: "internal.pdf", objectKey: "r2/private/secret" }],
    communications: [{ id: "communication-secret", channel: "email", subject: "secret", recordedAt: "2026-08-01T12:16:00.000Z" }],
    createdAt: "2026-08-01T12:10:00.000Z",
    updatedAt: "2026-08-01T12:20:00.000Z",
    createdBy: "staff-secret",
    updatedBy: "staff-secret",
    version: 4n,
    ...overrides,
  };
}

function orderPort(recordOverrides = {}) {
  const record = {
    order: order(),
    storefrontId: context.storefrontId,
    salesChannelId: context.salesChannelId,
    ...recordOverrides,
  };
  return {
    async listForCustomer(input) {
      assert.equal(input.customerId, customerId);
      assert.equal(input.storefrontId, context.storefrontId);
      assert.equal(input.salesChannelId, context.salesChannelId);
      assert.equal(input.requestContext, requestContext);
      return { records: [record], nextCursor: null };
    },
    async getForCustomer(input) {
      assert.equal(input.orderId, orderId);
      assert.equal(input.customerId, customerId);
      assert.equal(input.requestContext, requestContext);
      return record;
    },
  };
}

test("customer account projection exposes only buyer-owned profile fields", async () => {
  const result = await readStorefrontCustomerAccountV1(
    { async get(ctx, id) { assert.equal(ctx, requestContext); assert.equal(id, customerId); return customer(); } },
    { principal, context },
  );

  assert.equal(result.customerId, customerId);
  assert.equal(result.profileRevision, "7");
  assert.deepEqual(result.contacts, [
    { type: "email", value: "buyer@example.com", primary: true, verified: true },
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "SECRET-VAT",
    "vip-internal",
    "wholesale-internal",
    "staff-secret",
    "creditProfile",
    "consentHistory",
    "private.example.com",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("order detail is storefront-and-customer scoped and redacts operational authority", async () => {
  const result = await readStorefrontCustomerOrderV1(orderPort(), {
    principal,
    context,
    orderId,
  });

  assert.equal(result.orderId, orderId);
  assert.equal(result.total.minor, "1599");
  assert.equal(result.lines[0].tax.minor, "100");
  assert.equal(result.lines[0].displayName, "Linen shirt");
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "warehouse-secret",
    "reservation-secret",
    "payment-intent-secret",
    "r2/private/secret",
    "staff-secret",
    "calc-secret",
    "vat-secret-v1",
    "internal note",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("order history uses the trusted principal and bounded storefront ownership port", async () => {
  const result = await listStorefrontCustomerOrdersV1(orderPort(), {
    principal,
    context,
    request: {
      contractVersion: "storefront-order-history-request.v1",
      cursor: null,
      limit: 20,
    },
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].orderId, orderId);
  assert.equal(result.items[0].total.minor, "1599");
  assert.equal(result.nextCursor, null);
});

test("customer/order reads fail closed on permissions and ownership mismatches", async () => {
  const missingOrderPermission = {
    ...principal,
    requestContext: {
      ...requestContext,
      permissions: new Set(["customer.profile.read"]),
    },
  };
  await assert.rejects(
    readStorefrontCustomerOrderV1(orderPort(), {
      principal: missingOrderPermission,
      context,
      orderId,
    }),
    /lacks order read permission/u,
  );

  await assert.rejects(
    readStorefrontCustomerOrderV1(orderPort({ storefrontId: "storefront-2" }), {
      principal,
      context,
      orderId,
    }),
    /does not belong to this authenticated storefront scope/u,
  );

  await assert.rejects(
    readStorefrontCustomerOrderV1(orderPort({ order: order({ customer: { customerId: "018f0000-0000-4000-8000-000000000499" } }) }), {
      principal,
      context,
      orderId,
    }),
    /does not belong to this authenticated storefront scope/u,
  );

  await assert.rejects(
    readStorefrontCustomerAccountV1(
      { async get() { return customer({ status: "merged", mergedIntoId: "018f0000-0000-4000-8000-000000000498" }); } },
      { principal, context },
    ),
    /invalid canonical customer/u,
  );
});
