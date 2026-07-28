import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  InMemorySalesRepository,
  SalesService,
  createDeterministicSalesSimulators,
} from "../../build/modules/sales/src/index.js";

const tenantId = "018f0000-0000-7000-8000-000000000001";
const actorId = "018f0000-0000-7000-8000-000000000101";
const legalEntityId = "018f0000-0000-7000-8000-000000000201";
const storeId = "018f0000-0000-7000-8000-000000000301";
const warehouseId = "018f0000-0000-7000-8000-000000000401";

function context(permissions = [
  "sales.quote.create",
  "sales.quote.update",
  "sales.quote.send",
  "sales.quote.accept",
  "sales.order.create",
  "sales.order.read",
  "sales.order.update",
  "sales.invoice.create",
  "sales.invoice.post",
  "sales.credit_note.create",
  "sales.order.cancel",
]) {
  return {
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
    tenantId,
    actorId,
    legalEntityId,
    storeId,
    warehouseId,
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-28",
    region: "test",
    permissions: new Set(permissions),
  };
}

function line(overrides = {}) {
  return {
    item: {
      itemId: "018f0000-0000-7000-8000-000000001001",
      variantId: "018f0000-0000-7000-8000-000000001101",
      sku: "SKU-1001",
      displayNameSnapshot: "Everyday cotton shirt",
    },
    quantity: { amount: "2", unit: "EA", scale: 0 },
    unitPriceMinor: 5_000n,
    taxRateBasisPoints: 2_000,
    ...overrides,
  };
}

async function acceptedQuote(service) {
  const draft = await service.createQuote(context(), {
    idempotencyKey: "quote-create-001",
    customer: { customerId: "018f0000-0000-7000-8000-000000002001", displayNameSnapshot: "Northwind Retail Ltd" },
    currency: "GBP",
    expiresAt: "2026-08-15T23:59:59.000Z",
    lines: [line()],
    salespersonId: actorId,
    notes: ["Deliver before the autumn campaign"],
  });
  const sent = await service.sendQuote(context(), { quoteId: draft.id, expectedVersion: draft.version });
  return service.acceptQuote(context(), { quoteId: sent.id, expectedVersion: sent.version });
}

test("quote revision and conversion reject stale versions and duplicate effects", async () => {
  const repository = new InMemorySalesRepository();
  const simulators = createDeterministicSalesSimulators();
  const service = new SalesService(repository, simulators, { now: () => "2026-07-28T11:00:00.000Z" });
  const quote = await acceptedQuote(service);
  assert.equal(quote.status, "accepted");
  assert.equal(quote.revisions.length, 3);
  assert.equal(quote.total.grossMinor, 12_000n);

  const order = await service.convertQuoteToOrder(context(), {
    quoteId: quote.id,
    expectedQuoteVersion: quote.version,
    idempotencyKey: "quote-convert-001",
    fulfillmentMethod: "ship_from_store",
    warehouseId,
    paymentTerms: "on_account",
  });
  const replay = await service.convertQuoteToOrder(context(), {
    quoteId: quote.id,
    expectedQuoteVersion: quote.version,
    idempotencyKey: "quote-convert-001",
    fulfillmentMethod: "ship_from_store",
    warehouseId,
    paymentTerms: "on_account",
  });
  assert.equal(replay.id, order.id);
  assert.equal(order.sourceQuoteId, quote.id);
  assert.equal(order.orderStatus, "confirmed");
  assert.equal(order.paymentStatus, "unpaid");
  assert.equal(order.fulfillmentStatus, "unfulfilled");
  assert.equal(order.invoiceStatus, "not_invoiced");
  assert.equal(order.returnStatus, "not_returned");
  assert.equal(simulators.inventory.requests.length, 1);
  assert.equal(simulators.credit.requests.length, 1);
  assert.equal(repository.outboxEvents.filter((event) => event.eventType === "sales.order.confirmed.v1").length, 1);

  await assert.rejects(
    () => service.convertQuoteToOrder(context(), {
      quoteId: quote.id,
      expectedQuoteVersion: quote.version - 1n,
      idempotencyKey: "quote-convert-stale",
      fulfillmentMethod: "ship_from_store",
      warehouseId,
      paymentTerms: "on_account",
    }),
    /version conflict/i,
  );
});

test("price and tax snapshots are immutable and preserve exact contract scope", async () => {
  const simulators = createDeterministicSalesSimulators();
  const service = new SalesService(new InMemorySalesRepository(), simulators, { now: () => "2026-07-28T11:00:00.000Z" });
  const quote = await service.createQuote(context(), {
    idempotencyKey: "quote-snapshot-001",
    customer: { customerId: "018f0000-0000-7000-8000-000000002001" },
    currency: "GBP",
    lines: [line({ unitPriceMinor: 2_499n, taxRateBasisPoints: 2_000 })],
  });
  assert.equal(quote.lines[0].priceTaxSnapshot.effectiveUnitPrice.amountMinor, "2499");
  assert.equal(quote.lines[0].priceTaxSnapshot.grossTotal.amountMinor, "5998");
  assert.equal(simulators.priceTax.requests[0].context.tenantId, tenantId);
  assert.equal(simulators.priceTax.requests[0].context.legalEntityId, legalEntityId);
  assert.equal(simulators.priceTax.requests[0].context.storeId, storeId);
  assert.equal(Object.isFrozen(quote.lines[0].priceTaxSnapshot), true);
  assert.throws(() => { quote.lines[0].priceTaxSnapshot.grossTotal.amountMinor = "1"; }, /read only|Cannot assign/i);
});

test("payment, fulfillment, invoicing and backorder states remain independent", async () => {
  const service = new SalesService(new InMemorySalesRepository(), createDeterministicSalesSimulators());
  const quote = await acceptedQuote(service);
  let order = await service.convertQuoteToOrder(context(), {
    quoteId: quote.id,
    expectedQuoteVersion: quote.version,
    idempotencyKey: "order-state-001",
    fulfillmentMethod: "pickup",
    warehouseId,
    paymentTerms: "prepaid",
  });
  order = await service.recordPayment(context(), order.id, {
    intentId: "payment-intent-001",
    status: "captured",
    amountMinor: 5_000n,
    currency: "GBP",
    expectedVersion: order.version,
  });
  assert.equal(order.paymentStatus, "partially_paid");
  assert.equal(order.fulfillmentStatus, "unfulfilled");
  order = await service.recordFulfillment(context(), order.id, {
    status: "partially_fulfilled",
    fulfilledQuantities: [{ orderLineId: order.lines[0].id, quantity: { amount: "1", unit: "EA", scale: 0 } }],
    backorderedQuantities: [{ orderLineId: order.lines[0].id, quantity: { amount: "1", unit: "EA", scale: 0 } }],
    expectedVersion: order.version,
  });
  assert.equal(order.paymentStatus, "partially_paid");
  assert.equal(order.fulfillmentStatus, "partially_fulfilled");
  assert.equal(order.backorderStatus, "backordered");
  assert.equal(order.invoiceStatus, "not_invoiced");
});

test("posted operational invoices and credit notes are immutable", async () => {
  const service = new SalesService(new InMemorySalesRepository(), createDeterministicSalesSimulators(), { now: () => "2026-07-28T11:00:00.000Z" });
  const quote = await acceptedQuote(service);
  const order = await service.convertQuoteToOrder(context(), {
    quoteId: quote.id,
    expectedQuoteVersion: quote.version,
    idempotencyKey: "order-invoice-001",
    fulfillmentMethod: "local_delivery",
    warehouseId,
    paymentTerms: "prepaid",
  });
  const draft = await service.createInvoice(context(), { orderId: order.id, expectedOrderVersion: order.version, idempotencyKey: "invoice-create-001" });
  const posted = await service.postInvoice(context(), { invoiceId: draft.id, expectedVersion: draft.version });
  assert.equal(posted.status, "posted");
  assert.equal(posted.documentNumber, "INV-20260728-000001");
  await assert.rejects(() => service.updateInvoiceReference(context(), { invoiceId: posted.id, expectedVersion: posted.version, reference: "Changed" }), /immutable/i);

  const credit = await service.createCreditNote(context(), {
    invoiceId: posted.id,
    idempotencyKey: "credit-note-001",
    reason: "Approved partial commercial adjustment",
    lines: [{ invoiceLineId: posted.lines[0].id, quantity: { amount: "1", unit: "EA", scale: 0 } }],
  });
  assert.equal(credit.status, "posted");
  assert.equal(credit.documentNumber, "CRN-20260728-000001");
  assert.equal(credit.lines[0].originalPriceTaxSnapshot.calculationId, posted.lines[0].priceTaxSnapshot.calculationId);
  await assert.rejects(() => service.voidPostedDocument(context(), { documentType: "credit_note", documentId: credit.id, reason: "attempt" }), /immutable/i);
});

test("sales numbering remains unique under concurrent document creation", async () => {
  const repository = new InMemorySalesRepository();
  const service = new SalesService(repository, createDeterministicSalesSimulators());
  const quote = await acceptedQuote(service);
  const orders = await Promise.all(Array.from({ length: 25 }, (_, index) => service.createOrder(context(), {
    idempotencyKey: `concurrent-order-${index}`,
    customer: quote.customer,
    currency: quote.currency,
    lines: [line()],
    fulfillmentMethod: "pickup",
    warehouseId,
    paymentTerms: "prepaid",
  })));
  assert.equal(new Set(orders.map((order) => order.documentNumber)).size, 25);
  assert.equal(orders.map((order) => order.documentNumber).sort()[0], "ORD-20260728-000001");
  assert.equal(orders.map((order) => order.documentNumber).sort().at(-1), "ORD-20260728-000025");
});

test("order cancellation after payment or fulfillment requires explicit approval", async () => {
  const service = new SalesService(new InMemorySalesRepository(), createDeterministicSalesSimulators());
  const quote = await acceptedQuote(service);
  let order = await service.convertQuoteToOrder(context(), {
    quoteId: quote.id,
    expectedQuoteVersion: quote.version,
    idempotencyKey: "order-cancel-001",
    fulfillmentMethod: "pickup",
    warehouseId,
    paymentTerms: "prepaid",
  });
  order = await service.recordPayment(context(), order.id, {
    intentId: "payment-intent-cancel",
    status: "captured",
    amountMinor: order.total.grossMinor,
    currency: order.currency,
    expectedVersion: order.version,
  });
  await assert.rejects(() => service.cancelOrder(context(), { orderId: order.id, expectedVersion: order.version, reason: "Customer request" }), /approval/i);
  const cancelled = await service.cancelOrder(context([...context().permissions, "sales.order.cancel_after_effects"]), {
    orderId: order.id,
    expectedVersion: order.version,
    reason: "Manager approved cancellation after captured payment",
    approvalId: "018f0000-0000-7000-8000-000000009001",
  });
  assert.equal(cancelled.orderStatus, "cancelled");
  assert.equal(cancelled.paymentStatus, "paid");
});

test("sales permissions and tenant lookup fail closed", async () => {
  const repository = new InMemorySalesRepository();
  const service = new SalesService(repository, createDeterministicSalesSimulators());
  const order = await service.createOrder(context(), {
    idempotencyKey: "tenant-order-001",
    customer: { customerId: "018f0000-0000-7000-8000-000000002001" },
    currency: "GBP",
    lines: [line()],
    fulfillmentMethod: "pickup",
    warehouseId,
    paymentTerms: "prepaid",
  });
  await assert.rejects(() => service.getOrder({ ...context(), tenantId: "018f0000-0000-7000-8000-000000000002" }, order.id), /not found/i);
  await assert.rejects(() => service.getOrder(context([]), order.id), /sales\.order\.read/);
});

test("sales migration declares independent states, immutable documents, RLS and numbering", async () => {
  const sql = await readFile("database/modules/sales/migrations/SAL-0001-sales.sql", "utf8");
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS sales/);
  assert.match(sql, /payment_status/);
  assert.match(sql, /fulfillment_status/);
  assert.match(sql, /invoice_status/);
  assert.match(sql, /return_status/);
  assert.match(sql, /sales\.reject_posted_document_mutation/);
  assert.match(sql, /sales\.next_document_number/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/g);
  assert.match(sql, /sales_order_query_idx/);
  assert.match(sql, /sales\.order\.cancel_after_effects/);
  assert.match(sql, /SAL-0001/);
});
