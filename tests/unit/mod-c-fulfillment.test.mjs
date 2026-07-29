import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  InMemorySalesRepository,
  SalesService,
  createDeterministicSalesSimulators,
} from "../../build/modules/sales/src/index.js";
import {
  FulfillmentService,
  InMemoryFulfillmentRepository,
  createDeterministicFulfillmentSimulators,
} from "../../build/modules/fulfillment/src/index.js";

const tenantId = "018f0000-0000-7000-8000-000000000001";
const actorId = "018f0000-0000-7000-8000-000000000101";
const legalEntityId = "018f0000-0000-7000-8000-000000000201";
const storeId = "018f0000-0000-7000-8000-000000000301";
const warehouseId = "018f0000-0000-7000-8000-000000000401";

function context(permissions = [
  "sales.order.create",
  "fulfillment.plan.create",
  "fulfillment.pick",
  "fulfillment.pack",
  "fulfillment.ship",
  "fulfillment.deliver",
  "fulfillment.pickup",
  "fulfillment.read",
  "return.request",
  "return.approve",
  "return.receive",
  "return.resolve",
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

function orderLine(quantity = "4") {
  return {
    item: {
      itemId: "018f0000-0000-7000-8000-000000001001",
      variantId: "018f0000-0000-7000-8000-000000001101",
      sku: "SKU-1001",
      displayNameSnapshot: "Everyday cotton shirt",
    },
    quantity: { amount: quantity, unit: "EA", scale: 0 },
    unitPriceMinor: 5_000n,
    taxRateBasisPoints: 2_000,
  };
}

async function createOrder(quantity = "4") {
  const service = new SalesService(new InMemorySalesRepository(), createDeterministicSalesSimulators(), { now: () => "2026-07-28T12:00:00.000Z" });
  return service.createOrder(context(), {
    idempotencyKey: `fulfillment-order-${quantity}`,
    customer: { customerId: "018f0000-0000-7000-8000-000000002001", displayNameSnapshot: "Northwind Retail Ltd" },
    currency: "GBP",
    lines: [orderLine(quantity)],
    fulfillmentMethod: "split",
    warehouseId,
    paymentTerms: "prepaid",
  });
}

test("split fulfillment validates allocations and preserves independent workflow state", async () => {
  const order = await createOrder();
  const repository = new InMemoryFulfillmentRepository();
  const simulators = createDeterministicFulfillmentSimulators();
  const service = new FulfillmentService(repository, simulators, { now: () => "2026-07-28T12:30:00.000Z" });
  const plan = await service.createPlan(context(), {
    idempotencyKey: "fulfillment-plan-001",
    order,
    allocations: [
      { orderLineId: order.lines[0].id, method: "pickup", warehouseId, quantity: { amount: "1", unit: "EA", scale: 0 } },
      { orderLineId: order.lines[0].id, method: "ship_from_store", warehouseId, quantity: { amount: "3", unit: "EA", scale: 0 } },
    ],
  });
  const replay = await service.createPlan(context(), {
    idempotencyKey: "fulfillment-plan-001",
    order,
    allocations: [
      { orderLineId: order.lines[0].id, method: "pickup", warehouseId, quantity: { amount: "1", unit: "EA", scale: 0 } },
      { orderLineId: order.lines[0].id, method: "ship_from_store", warehouseId, quantity: { amount: "3", unit: "EA", scale: 0 } },
    ],
  });
  assert.equal(replay.id, plan.id);
  assert.equal(plan.status, "allocated");
  assert.equal(plan.allocations.length, 2);
  assert.equal(plan.allocations[0].status, "allocated");
  assert.equal(repository.outboxEvents.filter((event) => event.eventType === "fulfillment.plan.created.v1").length, 1);
  await assert.rejects(() => service.createPlan(context(), {
    idempotencyKey: "fulfillment-overallocate",
    order,
    allocations: [{ orderLineId: order.lines[0].id, method: "pickup", warehouseId, quantity: { amount: "5", unit: "EA", scale: 0 } }],
  }), /exceed/i);
});

test("ship-from-store enforces pick, pack, ship and proof-of-delivery transitions", async () => {
  const order = await createOrder("2");
  const simulators = createDeterministicFulfillmentSimulators();
  const service = new FulfillmentService(new InMemoryFulfillmentRepository(), simulators, { now: () => "2026-07-28T12:30:00.000Z" });
  let plan = await service.createPlan(context(), {
    idempotencyKey: "ship-plan-001",
    order,
    allocations: [{ orderLineId: order.lines[0].id, method: "ship_from_store", warehouseId, quantity: { amount: "2", unit: "EA", scale: 0 } }],
  });
  const allocationId = plan.allocations[0].id;
  plan = await service.startPicking(context(), { planId: plan.id, allocationId, expectedVersion: plan.version });
  assert.equal(plan.allocations[0].status, "picking");
  plan = await service.confirmPick(context(), { planId: plan.id, allocationId, quantity: { amount: "2", unit: "EA", scale: 0 }, expectedVersion: plan.version });
  assert.equal(plan.allocations[0].status, "picked");
  await assert.rejects(() => service.pack(context(), { planId: plan.id, allocationId, quantity: { amount: "3", unit: "EA", scale: 0 }, packageReference: "PKG-TOO-MUCH", expectedVersion: plan.version }), /picked/i);
  plan = await service.pack(context(), { planId: plan.id, allocationId, quantity: { amount: "2", unit: "EA", scale: 0 }, packageReference: "PKG-001", expectedVersion: plan.version });
  assert.equal(plan.allocations[0].status, "packed");
  plan = await service.ship(context(), {
    planId: plan.id,
    allocationId,
    carrier: "Royal Mail",
    service: "Tracked 24",
    trackingNumber: "RM-TRACK-001",
    expectedVersion: plan.version,
  });
  assert.equal(plan.allocations[0].status, "shipped");
  assert.equal(simulators.inventory.postings.length, 1);
  plan = await service.deliver(context(), {
    planId: plan.id,
    allocationId,
    proof: { type: "signature", recipientName: "Amina Rahman", reference: "pod/object-001", capturedAt: "2026-07-29T10:00:00.000Z" },
    expectedVersion: plan.version,
  });
  assert.equal(plan.status, "completed");
  assert.equal(plan.allocations[0].status, "delivered");
  assert.equal(plan.allocations[0].proof.recipientName, "Amina Rahman");
});

test("pickup requires ready state and records proof of collection", async () => {
  const order = await createOrder("1");
  const simulators = createDeterministicFulfillmentSimulators();
  const service = new FulfillmentService(new InMemoryFulfillmentRepository(), simulators);
  let plan = await service.createPlan(context(), {
    idempotencyKey: "pickup-plan-001",
    order,
    allocations: [{ orderLineId: order.lines[0].id, method: "pickup", warehouseId, quantity: { amount: "1", unit: "EA", scale: 0 } }],
  });
  const allocationId = plan.allocations[0].id;
  plan = await service.startPicking(context(), { planId: plan.id, allocationId, expectedVersion: plan.version });
  plan = await service.confirmPick(context(), { planId: plan.id, allocationId, quantity: { amount: "1", unit: "EA", scale: 0 }, expectedVersion: plan.version });
  plan = await service.markReadyForPickup(context(), { planId: plan.id, allocationId, pickupCode: "482913", expectedVersion: plan.version });
  assert.equal(plan.allocations[0].status, "ready_for_pickup");
  plan = await service.confirmPickup(context(), {
    planId: plan.id,
    allocationId,
    pickupCode: "482913",
    proof: { type: "identity_check", recipientName: "Amina Rahman", reference: "ID-LAST4-1234", capturedAt: "2026-07-28T15:00:00.000Z" },
    expectedVersion: plan.version,
  });
  assert.equal(plan.allocations[0].status, "picked_up");
  assert.equal(plan.status, "completed");
  assert.equal(simulators.inventory.postings[0].movementType, "sale_issue");
});

test("return authorization preserves original snapshot and prevents cumulative over-return", async () => {
  const order = await createOrder("2");
  const repository = new InMemoryFulfillmentRepository();
  const service = new FulfillmentService(repository, createDeterministicFulfillmentSimulators());
  const first = await service.requestReturn(context(), {
    idempotencyKey: "return-request-001",
    order,
    reason: "Wrong size supplied",
    lines: [{ orderLineId: order.lines[0].id, quantity: { amount: "1", unit: "EA", scale: 0 }, expectedCondition: "resalable", proposedDisposition: "restock" }],
    originalPaymentAllocations: [{ paymentIntentId: "payment-intent-001", amountMinor: 12_000n, currency: "GBP" }],
  });
  assert.equal(first.lines[0].originalPriceTaxSnapshot.calculationId, order.lines[0].priceTaxSnapshot.calculationId);
  assert.equal(first.lines[0].allocatedGrossMinor, 6_000n);
  assert.equal(first.status, "requested");
  await assert.rejects(() => service.requestReturn(context(), {
    idempotencyKey: "return-request-over",
    order,
    reason: "Attempt duplicate over-return",
    lines: [{ orderLineId: order.lines[0].id, quantity: { amount: "2", unit: "EA", scale: 0 }, expectedCondition: "resalable", proposedDisposition: "restock" }],
    originalPaymentAllocations: [{ paymentIntentId: "payment-intent-001", amountMinor: 12_000n, currency: "GBP" }],
  }), /exceed/i);
  const approved = await service.approveReturn(context(), { returnId: first.id, expectedVersion: first.version, decision: "approved", reason: "Within standard return policy" });
  assert.equal(approved.status, "approved");
});

test("received return can restock, refund original allocation and create exchange request", async () => {
  const order = await createOrder("2");
  const simulators = createDeterministicFulfillmentSimulators();
  const service = new FulfillmentService(new InMemoryFulfillmentRepository(), simulators, { now: () => "2026-07-28T12:30:00.000Z" });
  let authorization = await service.requestReturn(context(), {
    idempotencyKey: "return-resolution-001",
    order,
    reason: "Two units require mixed refund and exchange resolution",
    lines: [{ orderLineId: order.lines[0].id, quantity: { amount: "2", unit: "EA", scale: 0 }, expectedCondition: "damaged", proposedDisposition: "quarantine" }],
    originalPaymentAllocations: [
      { paymentIntentId: "payment-card-001", amountMinor: 6_000n, currency: "GBP" },
      { paymentIntentId: "payment-gift-001", amountMinor: 6_000n, currency: "GBP" },
    ],
  });
  authorization = await service.approveReturn(context(), { returnId: authorization.id, expectedVersion: authorization.version, decision: "approved", reason: "Carrier damage claim accepted" });
  authorization = await service.receiveReturn(context(), {
    returnId: authorization.id,
    expectedVersion: authorization.version,
    receivedLines: [{ returnLineId: authorization.lines[0].id, actualCondition: "damaged", disposition: "quarantine", warehouseId }],
  });
  assert.equal(authorization.status, "received");
  assert.equal(simulators.inventory.postings[0].movementType, "customer_return");

  const resolved = await service.resolveReturn(context(), {
    returnId: authorization.id,
    expectedVersion: authorization.version,
    idempotencyKey: "return-refund-001",
    resolutions: [
      { type: "refund", returnLineId: authorization.lines[0].id, paymentIntentId: "payment-card-001", amountMinor: 6_000n, currency: "GBP", reason: "Refund one damaged returned unit" },
      { type: "exchange", returnLineId: authorization.lines[0].id, replacementVariantId: "018f0000-0000-7000-8000-000000001102", quantity: { amount: "1", unit: "EA", scale: 0 } },
    ],
  });
  assert.equal(resolved.status, "completed");
  assert.equal(resolved.refundRequests[0].returnLineId, authorization.lines[0].id);
  assert.equal(resolved.refundRequests[0].paymentIntentId, "payment-card-001");
  assert.equal(resolved.exchangeRequests[0].sourceReturnId, authorization.id);
  assert.equal(simulators.refunds.requests.length, 1);
  assert.equal(simulators.refunds.requests[0].amount.amountMinor, "6000");
  assert.equal(simulators.exchange.requests.length, 1);
  await assert.rejects(() => service.receiveReturn(context(), { returnId: resolved.id, expectedVersion: resolved.version, receivedLines: [] }), /immutable|completed/i);
});

test("return resolution validates the complete batch before external side effects", async () => {
  const order = await createOrder("1");
  const simulators = createDeterministicFulfillmentSimulators();
  const service = new FulfillmentService(new InMemoryFulfillmentRepository(), simulators);
  let authorization = await service.requestReturn(context(), {
    idempotencyKey: "return-atomic-validation-001",
    order,
    reason: "Validate complete return resolution before side effects",
    lines: [{ orderLineId: order.lines[0].id, quantity: { amount: "1", unit: "EA", scale: 0 }, expectedCondition: "resalable", proposedDisposition: "restock" }],
    originalPaymentAllocations: [{ paymentIntentId: "payment-intent-atomic", amountMinor: 6_000n, currency: "GBP" }],
  });
  authorization = await service.approveReturn(context(), { returnId: authorization.id, expectedVersion: authorization.version, decision: "approved", reason: "Return approved" });
  authorization = await service.receiveReturn(context(), {
    returnId: authorization.id,
    expectedVersion: authorization.version,
    receivedLines: [{ returnLineId: authorization.lines[0].id, actualCondition: "resalable", disposition: "restock", warehouseId }],
  });
  await assert.rejects(() => service.resolveReturn(context(), {
    returnId: authorization.id,
    expectedVersion: authorization.version,
    idempotencyKey: "return-atomic-resolution-001",
    resolutions: [
      { type: "refund", returnLineId: authorization.lines[0].id, paymentIntentId: "payment-intent-atomic", amountMinor: 6_000n, currency: "GBP", reason: "Valid first resolution" },
      { type: "exchange", returnLineId: "018f0000-0000-7000-8000-000000009999", replacementVariantId: "018f0000-0000-7000-8000-000000001102", quantity: { amount: "1", unit: "EA", scale: 0 } },
    ],
  }), /return line not found/i);
  assert.equal(simulators.refunds.requests.length, 0);
  assert.equal(simulators.exchange.requests.length, 0);
});

test("return refund cannot exceed the named original payment allocation", async () => {
  const order = await createOrder("1");
  const service = new FulfillmentService(new InMemoryFulfillmentRepository(), createDeterministicFulfillmentSimulators());
  let authorization = await service.requestReturn(context(), {
    idempotencyKey: "return-allocation-001",
    order,
    reason: "Customer changed mind",
    lines: [{ orderLineId: order.lines[0].id, quantity: { amount: "1", unit: "EA", scale: 0 }, expectedCondition: "resalable", proposedDisposition: "restock" }],
    originalPaymentAllocations: [{ paymentIntentId: "payment-intent-limited", amountMinor: 6_000n, currency: "GBP" }],
  });
  authorization = await service.approveReturn(context(), { returnId: authorization.id, expectedVersion: authorization.version, decision: "approved", reason: "Return approved" });
  authorization = await service.receiveReturn(context(), {
    returnId: authorization.id,
    expectedVersion: authorization.version,
    receivedLines: [{ returnLineId: authorization.lines[0].id, actualCondition: "resalable", disposition: "restock", warehouseId }],
  });
  await assert.rejects(() => service.resolveReturn(context(), {
    returnId: authorization.id,
    expectedVersion: authorization.version,
    idempotencyKey: "return-allocation-over",
    resolutions: [{ type: "refund", returnLineId: authorization.lines[0].id, paymentIntentId: "payment-intent-limited", amountMinor: 6_001n, currency: "GBP", reason: "Too much" }],
  }), /allocation/i);
});

test("fulfillment lookup is tenant and permission isolated", async () => {
  const order = await createOrder("1");
  const service = new FulfillmentService(new InMemoryFulfillmentRepository(), createDeterministicFulfillmentSimulators());
  const plan = await service.createPlan(context(), {
    idempotencyKey: "tenant-plan-001",
    order,
    allocations: [{ orderLineId: order.lines[0].id, method: "pickup", warehouseId, quantity: { amount: "1", unit: "EA", scale: 0 } }],
  });
  await assert.rejects(() => service.getPlan({ ...context(), tenantId: "018f0000-0000-7000-8000-000000000002" }, plan.id), /not found/i);
  await assert.rejects(() => service.getPlan(context([]), plan.id), /fulfillment\.read/);
});

test("fulfillment migration declares workflow, returns, immutable completion and RLS", async () => {
  const sql = await readFile("database/modules/fulfillment/migrations/FUL-0001-fulfillment.sql", "utf8");
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS fulfillment/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fulfillment\.plans/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fulfillment\.allocations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fulfillment\.return_authorizations/);
  assert.match(sql, /original_price_tax_snapshot/);
  assert.match(sql, /original_payment_allocations/);
  assert.match(sql, /fulfillment\.reject_completed_return_mutation/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/g);
  assert.match(sql, /fulfillment_work_queue_idx/);
  assert.match(sql, /return\.override_policy/);
  assert.match(sql, /FUL-0001/);
});

test("return allocation migration binds refunds to immutable return-line value", async () => {
  const sql = await readFile("database/modules/fulfillment/migrations/FUL-0002-return-allocation.sql", "utf8");
  assert.match(sql, /allocation_snapshot/);
  assert.match(sql, /return_line_id/);
  assert.match(sql, /fulfillment_refund_return_line_idx/);
  assert.match(sql, /FUL-0002/);
});
