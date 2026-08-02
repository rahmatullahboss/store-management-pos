import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontSalesServiceQuotePort } from "../../build/modules/storefront/src/sales-quote-adapter.js";

const requestContext = Object.freeze({
  requestId: "request-1",
  traceId: "trace-1",
  tenantId: "tenant-1",
  actorId: "storefront-principal",
  legalEntityId: "entity-1",
  storeId: "store-1",
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-08-01",
  region: "GB",
  permissions: new Set(["sales.quote.create"]),
});

const customer = Object.freeze({ customerId: "customer-1" });
const lines = Object.freeze([
  Object.freeze({
    item: Object.freeze({ itemId: "product-1", variantId: "variant-1" }),
    quantity: Object.freeze({ amount: "1", unit: "EA", scale: 0 }),
    unitPriceMinor: 5000n,
    taxRateBasisPoints: 2000,
  }),
]);

test("MOD-C quote adapter forwards the exact trusted context without adding permissions", async () => {
  let observedContext;
  let observedInput;
  const expected = Object.freeze({ id: "quote-1" });
  const port = createStorefrontSalesServiceQuotePort({
    async createQuote(context, input) {
      observedContext = context;
      observedInput = input;
      return expected;
    },
  });

  const result = await port.createQuote({
    requestContext,
    idempotencyKey: "cart:quote:adapter:12345",
    customer,
    currency: "GBP",
    expiresAt: "2026-08-01T17:15:00.000Z",
    lines,
  });

  assert.equal(result, expected);
  assert.equal(observedContext, requestContext);
  assert.deepEqual([...observedContext.permissions], ["sales.quote.create"]);
  assert.deepEqual(observedInput, {
    idempotencyKey: "cart:quote:adapter:12345",
    customer,
    currency: "GBP",
    expiresAt: "2026-08-01T17:15:00.000Z",
    lines,
  });
  assert.equal("permissions" in observedInput, false);
});

test("MOD-C quote adapter does not synthesize sales permission for an unprivileged principal", async () => {
  const unprivileged = Object.freeze({ ...requestContext, permissions: new Set() });
  let observedContext;
  const port = createStorefrontSalesServiceQuotePort({
    async createQuote(context) {
      observedContext = context;
      throw new Error("Permission denied: sales.quote.create");
    },
  });

  await assert.rejects(
    port.createQuote({
      requestContext: unprivileged,
      idempotencyKey: "cart:quote:adapter:12345",
      customer,
      currency: "GBP",
      expiresAt: "2026-08-01T17:15:00.000Z",
      lines,
    }),
    /Permission denied/u,
  );
  assert.equal(observedContext, unprivileged);
  assert.equal(observedContext.permissions.has("sales.quote.create"), false);
});
