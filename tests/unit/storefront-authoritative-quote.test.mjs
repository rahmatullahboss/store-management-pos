import assert from "node:assert/strict";
import test from "node:test";

import { parseStorefrontCartQuoteRequestV1 } from "../../build/packages/storefront-contracts/src/cart-checkout.js";
import { createStorefrontAuthoritativeQuotePort } from "../../build/modules/storefront/src/authoritative-quote.js";

const productId = "018f0000-0000-4000-8000-000000000001";
const variantId = "018f0000-0000-4000-8000-000000000101";
const lineId = "018f0000-0000-4000-8000-000000000201";
const quoteId = "018f0000-0000-4000-8000-000000000301";
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
  actorId: "storefront-checkout-principal",
  legalEntityId: "entity-1",
  storeId: "store-1",
  locale: context.locale,
  timeZone: "Europe/London",
  businessDate: "2026-08-01",
  region: "GB",
  permissions: new Set(["sales.quote.create"]),
});

const customer = Object.freeze({ customerId, displayNameSnapshot: "Buyer" });
const item = Object.freeze({
  itemId: productId,
  variantId,
  sku: "SKU-1",
  displayNameSnapshot: "Canonical Product",
});

function money(amountMinor) {
  return Object.freeze({ amountMinor, currency: "GBP", scale: 2 });
}

function request(overrides = {}) {
  return parseStorefrontCartQuoteRequestV1({
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: "5",
    idempotencyKey: "cart:quote:authority:12345",
    lines: [
      {
        productId,
        variantId,
        quantity: { amount: "2", unit: "EA", scale: 0 },
      },
    ],
    couponCodes: ["SAVE10"],
    destinationCountryCode: "GB",
    customerId,
    shippingOptionId: "standard",
    ...overrides,
  });
}

function salesQuote(overrides = {}) {
  const snapshot = Object.freeze({
    schemaVersion: "1.0",
    calculationId: "calc-mod-a-1",
    item,
    quantity: Object.freeze({ amount: "2", unit: "EA", scale: 0 }),
    originalUnitPrice: money("5000"),
    effectiveUnitPrice: money("4500"),
    discountTotal: money("1000"),
    taxableBase: money("9000"),
    taxes: Object.freeze([
      Object.freeze({
        taxCode: "VAT",
        jurisdictionId: "GB",
        rateBasisPoints: "2000",
        amount: money("1800"),
        inclusive: false,
        ruleVersion: "vat-v1",
      }),
    ]),
    grossTotal: money("10800"),
    roundingAdjustment: money("0"),
    appliedRuleVersions: Object.freeze(["price-v3", "promo-v1", "vat-v1"]),
    calculatedAt: "2026-08-01T17:00:00.000Z",
  });
  return {
    id: quoteId,
    tenantId: context.tenantId,
    legalEntityId: requestContext.legalEntityId,
    storeId: requestContext.storeId,
    documentNumber: "Q-000001",
    customer,
    currency: "GBP",
    status: "draft",
    expiresAt: "2026-08-01T17:15:00.000Z",
    lines: Object.freeze([
      Object.freeze({
        id: lineId,
        item,
        quantity: Object.freeze({ amount: "2", unit: "EA", scale: 0 }),
        priceTaxSnapshot: snapshot,
      }),
    ]),
    total: Object.freeze({
      netMinor: 9000n,
      discountMinor: 1000n,
      taxMinor: 1800n,
      grossMinor: 10800n,
      currency: "GBP",
      scale: 2,
    }),
    notes: Object.freeze([]),
    attachments: Object.freeze([]),
    communications: Object.freeze([]),
    revisions: Object.freeze([]),
    createdAt: "2026-08-01T17:00:00.000Z",
    updatedAt: "2026-08-01T17:00:00.000Z",
    createdBy: requestContext.actorId,
    updatedBy: requestContext.actorId,
    version: 1n,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const observations = {
    principal: [],
    published: [],
    commercial: [],
    inventory: [],
    sales: [],
    shipping: [],
  };
  const ports = {
    principals: {
      async resolve(input) {
        observations.principal.push(input);
        return { requestContext, customer };
      },
    },
    publishedItems: {
      async resolve(input) {
        observations.published.push(input);
        return item;
      },
    },
    commercial: {
      async resolve(input) {
        observations.commercial.push(input);
        return {
          unitPriceMinor: 5000n,
          taxRateBasisPoints: 2000,
          priceListRevision: context.priceListRevision,
        };
      },
    },
    inventory: {
      async resolve(input) {
        observations.inventory.push(input);
        return { variantId, version: "9", sufficient: true };
      },
    },
    sales: {
      async createQuote(input) {
        observations.sales.push(input);
        return salesQuote({ expiresAt: input.expiresAt });
      },
    },
    shipping: {
      async quote(input) {
        observations.shipping.push(input);
        return money("500");
      },
    },
    ...overrides,
  };
  return { ports, observations };
}

test("authoritative quote composes trusted MOD-A/B/C inputs without browser commercial facts", async () => {
  const { ports, observations } = dependencies();
  const authority = createStorefrontAuthoritativeQuotePort(ports, {
    now: () => "2026-08-01T17:00:00.000Z",
    quoteTtlSeconds: 900,
  });

  const result = await authority.quote({ context, request: request() });

  assert.equal(observations.principal.length, 1);
  assert.equal(observations.published.length, 1);
  assert.equal(observations.commercial.length, 1);
  assert.equal(observations.inventory.length, 1);
  assert.equal(observations.sales.length, 1);
  assert.equal(observations.shipping.length, 1);
  assert.equal(observations.commercial[0].item, item);
  assert.equal(observations.commercial[0].quantity.amount, "2");
  assert.deepEqual(observations.commercial[0].couponCodes, ["SAVE10"]);
  assert.equal("unitPrice" in observations.commercial[0], false);
  assert.equal("tax" in observations.commercial[0], false);
  assert.equal(observations.sales[0].lines[0].unitPriceMinor, 5000n);
  assert.equal(observations.sales[0].lines[0].taxRateBasisPoints, 2000);
  assert.equal(observations.sales[0].requestContext, requestContext);
  assert.equal(result.quote.subtotal.minor, "10000");
  assert.equal(result.quote.discount.minor, "1000");
  assert.equal(result.quote.tax.minor, "1800");
  assert.equal(result.quote.shipping.minor, "500");
  assert.equal(result.quote.total.minor, "11300");
  assert.equal(result.authority.calculationIds[0], "calc-mod-a-1");
  assert.deepEqual(result.authority.inventoryVersions, [
    { variantId, version: "9" },
  ]);
  assert.equal(result.state, "ready");
});

test("authoritative quote denies unresolved or unprivileged checkout principals before commerce calls", async () => {
  let commerceCalls = 0;
  const unresolved = dependencies({
    principals: { async resolve() { return null; } },
    commercial: { async resolve() { commerceCalls += 1; throw new Error("unexpected"); } },
  });
  await assert.rejects(
    unresolved.ports.principals.resolve().then(() =>
      createStorefrontAuthoritativeQuotePort(unresolved.ports).quote({
        context,
        request: request(),
      })
    ),
    /not available for the resolved buyer principal/u,
  );
  assert.equal(commerceCalls, 0);

  const unprivilegedContext = {
    ...requestContext,
    permissions: new Set(),
  };
  const unprivileged = dependencies({
    principals: {
      async resolve() {
        return { requestContext: unprivilegedContext, customer };
      },
    },
  });
  await assert.rejects(
    createStorefrontAuthoritativeQuotePort(unprivileged.ports).quote({
      context,
      request: request(),
    }),
    /not authorised for canonical quote creation/u,
  );
  assert.equal(unprivileged.observations.published.length, 0);
});

test("authoritative quote fails closed before MOD-A/B/C when item is not published", async () => {
  let commercialCalls = 0;
  let inventoryCalls = 0;
  let salesCalls = 0;
  const { ports } = dependencies({
    publishedItems: { async resolve() { return null; } },
    commercial: { async resolve() { commercialCalls += 1; throw new Error("unexpected"); } },
    inventory: { async resolve() { inventoryCalls += 1; throw new Error("unexpected"); } },
    sales: { async createQuote() { salesCalls += 1; throw new Error("unexpected"); } },
  });

  await assert.rejects(
    createStorefrontAuthoritativeQuotePort(ports).quote({
      context,
      request: request(),
    }),
    /unpublished or unavailable product variant/u,
  );
  assert.equal(commercialCalls, 0);
  assert.equal(inventoryCalls, 0);
  assert.equal(salesCalls, 0);
});

test("authoritative quote rejects stale MOD-A revision before MOD-C quote persistence", async () => {
  let salesCalls = 0;
  const { ports } = dependencies({
    commercial: {
      async resolve() {
        return {
          unitPriceMinor: 5000n,
          taxRateBasisPoints: 2000,
          priceListRevision: "price-list:1:v2",
        };
      },
    },
    sales: {
      async createQuote() {
        salesCalls += 1;
        return salesQuote();
      },
    },
  });

  await assert.rejects(
    createStorefrontAuthoritativeQuotePort(ports).quote({
      context,
      request: request(),
    }),
    /price-list revision is stale/u,
  );
  assert.equal(salesCalls, 0);
});

test("authoritative quote preserves MOD-B insufficiency as an unavailable draft quote", async () => {
  const { ports } = dependencies({
    inventory: {
      async resolve() {
        return { variantId, version: "10", sufficient: false };
      },
    },
  });
  const result = await createStorefrontAuthoritativeQuotePort(ports, {
    now: () => "2026-08-01T17:00:00.000Z",
  }).quote({ context, request: request() });

  assert.equal(result.state, "unavailable");
  assert.deepEqual(result.unavailableLineIds, [lineId]);
  assert.deepEqual(result.authority.inventoryVersions, [
    { variantId, version: "10" },
  ]);
});

test("authoritative quote rejects canonical sales identity and shipping scope mismatch", async () => {
  const changedSales = dependencies({
    sales: {
      async createQuote(input) {
        const quote = salesQuote({ expiresAt: input.expiresAt });
        quote.lines = [
          {
            ...quote.lines[0],
            item: {
              ...item,
              variantId: "018f0000-0000-4000-8000-000000000777",
            },
          },
        ];
        return quote;
      },
    },
  });
  await assert.rejects(
    createStorefrontAuthoritativeQuotePort(changedSales.ports, {
      now: () => "2026-08-01T17:00:00.000Z",
    }).quote({ context, request: request() }),
    /changed cart identity or quantity/u,
  );

  const wrongShipping = dependencies({
    shipping: {
      async quote() {
        return { amountMinor: "500", currency: "USD", scale: 2 };
      },
    },
  });
  await assert.rejects(
    createStorefrontAuthoritativeQuotePort(wrongShipping.ports, {
      now: () => "2026-08-01T17:00:00.000Z",
    }).quote({ context, request: request() }),
    /quote.shipping is invalid for storefront context/u,
  );
});
