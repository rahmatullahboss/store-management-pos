import test from "node:test";
import assert from "node:assert/strict";
import {
  CustomerService,
  InMemoryCustomerRepository,
} from "../../build/modules/customer/src/index.js";
import {
  InMemorySalesRepository,
  SalesService,
  StructuredTelemetry,
  ModCEventProjector,
  createDeterministicSalesSimulators,
  createModCRouter,
} from "../../build/modules/sales/src/index.js";
import {
  FulfillmentService,
  InMemoryFulfillmentRepository,
  createDeterministicFulfillmentSimulators,
} from "../../build/modules/fulfillment/src/index.js";
import { renderCustomerWorkspace } from "../../build/apps/admin-web/src/modules/customer/surface.js";
import { renderSalesWorkspace } from "../../build/apps/admin-web/src/modules/sales/surface.js";
import { renderFulfillmentWorkspace } from "../../build/apps/admin-web/src/modules/fulfillment/surface.js";

const tenantId = "018f0000-0000-7000-8000-000000000001";
const actorId = "018f0000-0000-7000-8000-000000000101";
const legalEntityId = "018f0000-0000-7000-8000-000000000201";
const storeId = "018f0000-0000-7000-8000-000000000301";
const warehouseId = "018f0000-0000-7000-8000-000000000401";

function context(permissions = [
  "customer.profile.create",
  "customer.profile.read",
  "customer.profile.update",
  "customer.profile.merge",
  "customer.credit.manage",
  "customer.credit.approve",
  "customer.import",
  "customer.export",
  "sales.quote.create",
  "sales.quote.update",
  "sales.quote.send",
  "sales.quote.accept",
  "sales.order.create",
  "sales.order.read",
  "sales.order.update",
  "sales.order.import",
  "sales.order.export",
  "sales.invoice.create",
  "sales.invoice.post",
  "sales.credit_note.create",
  "sales.order.cancel",
  "fulfillment.plan.create",
  "fulfillment.read",
  "return.request",
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

function services() {
  const telemetry = new StructuredTelemetry();
  return {
    telemetry,
    customer: new CustomerService(new InMemoryCustomerRepository(), { now: () => "2026-07-28T14:00:00.000Z" }),
    sales: new SalesService(new InMemorySalesRepository(), createDeterministicSalesSimulators(), { now: () => "2026-07-28T14:00:00.000Z" }),
    fulfillment: new FulfillmentService(new InMemoryFulfillmentRepository(), createDeterministicFulfillmentSimulators(), { now: () => "2026-07-28T14:00:00.000Z" }),
  };
}

async function json(response) {
  return response.json();
}

test("MOD-C API validates idempotency, serializes exact values and emits structured telemetry", async () => {
  const app = services();
  const router = createModCRouter(app);
  const request = new Request("https://store.example/api/v1/customers", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-customer-001" },
    body: JSON.stringify({ kind: "company", displayName: "Northwind Retail Ltd", company: { legalName: "Northwind Retail Ltd" } }),
  });
  const replayRequest = request.clone();
  const created = await router(request, context());
  assert.equal(created.status, 201);
  const payload = await json(created);
  assert.equal(payload.data.version, "1");
  assert.equal(created.headers.get("content-type"), "application/json; charset=utf-8");
  const replay = await router(replayRequest, context());
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).meta.replayed, true);
  assert.equal(app.telemetry.counters.get("mod_c_http_requests_total|POST|/api/v1/customers|201"), 1);
  assert.equal(app.telemetry.logs[0].requestId.length > 0, true);
  assert.equal(app.telemetry.logs.every((entry) => typeof entry === "object" && entry.module === "MOD-C"), true);
});

test("MOD-C API fails closed for malformed JSON and unavailable routes", async () => {
  const app = services();
  const router = createModCRouter(app);
  const malformed = await router(new Request("https://store.example/api/v1/customers", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-invalid-001" },
    body: "{",
  }), context());
  assert.equal(malformed.status, 400);
  assert.equal((await json(malformed)).error.code, "VALIDATION_FAILED");
  const missing = await router(new Request("https://store.example/api/v1/unknown"), context());
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).error.code, "NOT_FOUND");
});

test("MOD-C API creates quote, order and fulfillment plan through public module services", async () => {
  const app = services();
  const router = createModCRouter(app);
  const quoteResponse = await router(new Request("https://store.example/api/v1/quotes", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-quote-001" },
    body: JSON.stringify({
      customer: { customerId: "018f0000-0000-7000-8000-000000002001", displayNameSnapshot: "Northwind Retail Ltd" },
      currency: "GBP",
      lines: [{
        item: { itemId: "018f0000-0000-7000-8000-000000001001", variantId: "018f0000-0000-7000-8000-000000001101", sku: "SKU-1001" },
        quantity: { amount: "2", unit: "EA", scale: 0 },
        unitPriceMinor: "5000",
        taxRateBasisPoints: 2000,
      }],
    }),
  }), context());
  assert.equal(quoteResponse.status, 201);
  assert.equal((await json(quoteResponse)).data.total.grossMinor, "12000");

  const orderResponse = await router(new Request("https://store.example/api/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-order-001" },
    body: JSON.stringify({
      customer: { customerId: "018f0000-0000-7000-8000-000000002001" },
      currency: "GBP",
      fulfillmentMethod: "pickup",
      warehouseId,
      paymentTerms: "prepaid",
      lines: [{
        item: { itemId: "018f0000-0000-7000-8000-000000001001", variantId: "018f0000-0000-7000-8000-000000001101" },
        quantity: { amount: "1", unit: "EA", scale: 0 },
        unitPriceMinor: "5000",
        taxRateBasisPoints: 2000,
      }],
    }),
  }), context());
  const orderPayload = await json(orderResponse);
  assert.equal(orderResponse.status, 201);
  assert.equal(orderPayload.data.orderStatus, "confirmed");

  const planResponse = await router(new Request("https://store.example/api/v1/fulfillment/plans", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-plan-001" },
    body: JSON.stringify({
      order: orderPayload.data,
      allocations: [{ orderLineId: orderPayload.data.lines[0].id, method: "pickup", warehouseId, quantity: { amount: "1", unit: "EA", scale: 0 } }],
    }),
  }), context());
  assert.equal(planResponse.status, 201);
  assert.equal((await json(planResponse)).data.status, "allocated");
});

test("MOD-C API exposes bounded customer and order import/export", async () => {
  const app = services();
  const router = createModCRouter(app);
  const customerImport = await router(new Request("https://store.example/api/v1/customers/import", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-customer-import-001" },
    body: JSON.stringify({ rows: [{ externalId: "CRM-API-001", kind: "person", displayName: "API Imported Customer", email: "api@example.com", countryCode: "GB" }] }),
  }), context());
  assert.equal(customerImport.status, 201);
  assert.equal((await json(customerImport)).data.imported, 1);
  const customerExport = await router(new Request("https://store.example/api/v1/customers/export?limit=50"), context());
  assert.equal(customerExport.status, 200);
  assert.equal((await json(customerExport)).data.rows[0].externalId, "CRM-API-001");

  const orderImport = await router(new Request("https://store.example/api/v1/orders/import", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "api-order-import-001" },
    body: JSON.stringify({ rows: [{
      externalSource: "marketplace",
      externalOrderId: "API-MKT-001",
      customer: { customerId: "018f0000-0000-7000-8000-000000002001" },
      currency: "GBP",
      fulfillmentMethod: "pickup",
      warehouseId,
      paymentTerms: "deposit",
      availabilityMode: "preorder",
      lines: [{
        item: { itemId: "018f0000-0000-7000-8000-000000001001", variantId: "018f0000-0000-7000-8000-000000001101" },
        quantity: { amount: "1", unit: "EA", scale: 0 },
        unitPriceMinor: "5000",
        taxRateBasisPoints: 2000,
      }],
    }] }),
  }), context());
  assert.equal(orderImport.status, 201);
  assert.equal((await json(orderImport)).data.imported, 1);
  const orderExport = await router(new Request("https://store.example/api/v1/orders/export?limit=50"), context());
  assert.equal(orderExport.status, 200);
  const exported = (await json(orderExport)).data.rows[0];
  assert.equal(exported.externalOrderId, "API-MKT-001");
  assert.equal(exported.availabilityMode, "preorder");
});

test("event projector processes at-least-once events exactly once and exposes queue metrics", async () => {
  const telemetry = new StructuredTelemetry();
  const projector = new ModCEventProjector(telemetry);
  const event = {
    schemaVersion: "1.0",
    eventId: "018f0000-0000-7000-8000-000000009001",
    eventType: "sales.order.confirmed.v1",
    aggregateType: "order",
    aggregateId: "018f0000-0000-7000-8000-000000009101",
    tenantId,
    occurredAt: "2026-07-28T14:00:00.000Z",
    businessDate: "2026-07-28",
    correlationId: "request-001",
    actorId,
    payload: { documentNumber: "ORD-20260728-000001" },
    metadata: { traceId: "trace-001", version: "1" },
  };
  assert.deepEqual(await projector.consume(event), { processed: true, duplicate: false });
  assert.deepEqual(await projector.consume(event), { processed: false, duplicate: true });
  assert.equal(projector.orderProjection.get(event.aggregateId).status, "confirmed");
  assert.equal(telemetry.counters.get("mod_c_events_processed_total|sales.order.confirmed.v1"), 1);
  assert.equal(telemetry.counters.get("mod_c_events_duplicate_total|sales.order.confirmed.v1"), 1);
});

test("customer and sales workspaces inherit Operations Ledger semantics and resilient states", () => {
  const customer = renderCustomerWorkspace({
    locale: "en-GB",
    direction: "ltr",
    state: "ready",
    customers: [{ id: "customer-1", displayName: "Northwind Retail Ltd", kind: "company", status: "active", credit: "£250.00 available", updatedAt: "28 Jul 2026, 14:00" }],
    pendingApprovals: 1,
  });
  assert.match(customer, /<main[^>]+aria-labelledby="customer-workspace-title"/);
  assert.match(customer, /Customer directory/);
  assert.match(customer, /Credit approval needed/);
  assert.match(customer, /<table/);
  assert.match(customer, /data-state="ready"/);

  const sales = renderSalesWorkspace({ locale: "bn-BD", direction: "ltr", state: "empty", orders: [], approvalCount: 0 });
  assert.match(sales, /lang="bn-BD"/);
  assert.match(sales, /কোনো বিক্রয় অর্ডার নেই/);
  assert.match(sales, /role="status"/);
  assert.match(sales, /নতুন কোটেশন/);
});

test("fulfillment workspace supports RTL, keyboard actions and stale/conflict recovery", () => {
  const html = renderFulfillmentWorkspace({
    locale: "ar",
    direction: "rtl",
    state: "conflict",
    tasks: [{ id: "task-1", orderNumber: "ORD-20260728-000001", method: "ship_from_store", status: "picking", itemCount: 3, dueLabel: "اليوم" }],
  });
  assert.match(html, /dir="rtl"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /إعادة تحميل حالة الطلب/);
  const ready = renderFulfillmentWorkspace({
    locale: "ar",
    direction: "rtl",
    state: "ready",
    tasks: [{ id: "task-1", orderNumber: "ORD-20260728-000001", method: "ship_from_store", status: "picking", itemCount: 3, dueLabel: "اليوم" }],
  });
  assert.match(ready, /<button[^>]+type="button"[^>]+data-action="resume-pick"/);
  assert.match(ready, /aria-label="فتح الطلب ORD-20260728-000001"/);
  assert.doesNotMatch(`${html}${ready}`, /style="[^\"]*(left|right):/);
});
