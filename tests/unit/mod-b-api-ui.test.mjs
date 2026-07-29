import test from "node:test";
import assert from "node:assert/strict";
import { exportCsv, parseCsv, parseReorderPolicyImport } from "../../build/modules/inventory/import-export.js";
import { parseSupplierImport } from "../../build/modules/procurement/import-export.js";
import { InventoryTelemetry } from "../../build/modules/inventory/observability.js";
import { ProcurementTelemetry } from "../../build/modules/procurement/observability.js";
import { handleInventoryRequest } from "../../build/apps/api/src/modules/inventory/handler.js";
import { handleProcurementRequest } from "../../build/apps/api/src/modules/procurement/handler.js";
import { renderInventoryAdminPage, renderProcurementAdminPage } from "../../build/apps/admin-web/src/app-shell/index.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const warehouseId = "33333333-3333-4333-8333-333333333333";
const variantId = "44444444-4444-4444-8444-444444444444";

function context(permissions = []) {
  return {
    tenantId,
    actorId,
    permissions: new Set(permissions),
    locale: "en-GB",
    timeZone: "Asia/Dhaka",
    businessDate: "2026-07-28",
    requestId: "request-1",
    traceId: "trace-1",
  };
}

const database = {
  async withClientTransaction(_context, callback) { return await callback({ query: async () => ({ rows: [], rowCount: 0 }) }); },
};

test("CSV import/export is deterministic and neutralizes spreadsheet formula injection", () => {
  const csv = exportCsv(["name", "value"], [{ name: "Normal", value: "=HYPERLINK(\"https://bad\")" }, { name: "Comma, Inc", value: "42" }]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"Comma, Inc"/);
  const rows = parseCsv("id,name\r\n1,Alpha\r\n2,Beta", ["id", "name"]);
  assert.deepEqual(rows, [{ id: "1", name: "Alpha" }, { id: "2", name: "Beta" }]);
  assert.throws(() => parseSupplierImport("id,code,legal_name,display_name,currency,payment_terms_days,lead_time_days\n1,SUP,Supplier,Supplier,GB,30,7"), /invalid currency/i);
  assert.throws(() => parseReorderPolicyImport("id,variant_id,warehouse_id,reorder_point,safety_stock,minimum_quantity,maximum_quantity,scale,unit,lead_time_days\n1,v,w,10,2,5,20,19,EA,7"), /invalid scale/i);
});

test("telemetry emits actionable alerts without exposing payload data", () => {
  const inventory = new InventoryTelemetry(() => new Date("2026-07-28T10:00:00Z"));
  inventory.recordReconciliation({ id: "run-1", tenantId, status: "mismatch", ledgerEntryCount: 5, projectionKeyCount: 2, mismatches: [{ key: "dimension", ledgerQuantity: 5n, projectionQuantity: 4n }], checkedAt: "2026-07-28T10:00:00Z" });
  assert.equal(inventory.snapshot().alerts[0].code, "INVENTORY_RECONCILIATION_MISMATCH");
  const procurement = new ProcurementTelemetry(() => new Date("2026-07-28T10:00:00Z"));
  procurement.recordThreeWayMatch({ id: "match-1", tenantId, supplierBillId: "bill-1", status: "price_variance", orderedAmount: { amountMinor: "100", currency: "GBP", scale: 2 }, receivedAmount: { amountMinor: "100", currency: "GBP", scale: 2 }, billedAmount: { amountMinor: "120", currency: "GBP", scale: 2 }, quantityVarianceMinor: "0", priceVarianceMinor: "20", evidenceRefs: [], checkedAt: "2026-07-28T10:00:00Z" });
  assert.equal(procurement.snapshot().alerts[0].code, "THREE_WAY_MATCH_VARIANCE");
});

test("inventory API enforces permissions and delegates validated availability reads", async () => {
  await assert.rejects(async () => await handleInventoryRequest(new Request(`https://example.test/v1/inventory/availability?variantId=${variantId}&warehouseId=${warehouseId}`), new URL(`https://example.test/v1/inventory/availability?variantId=${variantId}&warehouseId=${warehouseId}`), context(), database, {}), /Permission inventory.stock.read is required/);
  let captured;
  const repository = { async availability(_client, _context, input) { captured = input; return { variantId, warehouseId, onHand: { amount: "10", unit: "EA", scale: 0 }, reserved: { amount: "2", unit: "EA", scale: 0 }, available: { amount: "8", unit: "EA", scale: 0 }, asOf: "2026-07-28T10:00:00Z", version: "1" }; } };
  const url = new URL(`https://example.test/v1/inventory/availability?variantId=${variantId}&warehouseId=${warehouseId}`);
  const response = await handleInventoryRequest(new Request(url), url, context(["inventory.stock.read"]), database, repository);
  assert.equal(response.status, 200);
  assert.deepEqual(captured, { variantId, warehouseId });
  assert.equal((await response.json()).available.amount, "8");
});

test("procurement API validates supplier writes and permission boundaries", async () => {
  let input;
  const repository = { async createSupplier(_client, _context, value) { input = value; return { id: value.id, status: "active" }; } };
  const body = { id: "55555555-5555-4555-8555-555555555555", legalEntityId: "66666666-6666-4666-8666-666666666666", code: "SUP-1", legalName: "Supplier One Limited", displayName: "Supplier One", currency: "GBP", paymentTermsDays: 30, leadTimeDays: 7 };
  const url = new URL("https://example.test/v1/procurement/suppliers");
  const response = await handleProcurementRequest(new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), url, context(["procurement.supplier.manage"]), database, repository);
  assert.equal(response.status, 201);
  assert.equal(input.currency, "GBP");
  await assert.rejects(async () => await handleProcurementRequest(new Request(url, { method: "POST", body: JSON.stringify(body) }), url, context(), database, repository), /Permission procurement.supplier.manage is required/);
});

test("MOD-B admin surfaces preserve route permissions, provenance, forms and responsive semantics", () => {
  const inventoryHtml = renderInventoryAdminPage({ displayName: "Operator", tenantName: "Ozzyl Retail", permissions: new Set(["inventory.stock.read"]), location: "Dhaka Central" });
  assert.match(inventoryHtml, /Know what is available, where, and why/);
  assert.match(inventoryHtml, /Trace a stock effect/);
  assert.match(inventoryHtml, /Synthetic operational fixture/);
  assert.match(inventoryHtml, /aria-current="page"/);
  assert.doesNotMatch(inventoryHtml, />Procurement</);
  const procurementHtml = renderProcurementAdminPage({ displayName: "Buyer", tenantName: "Ozzyl Retail", permissions: new Set(["procurement.purchase_order.read"]) });
  assert.match(procurementHtml, /Buy with control\. Receive with evidence/);
  assert.match(procurementHtml, /<label for="receive-po">/);
  assert.match(procurementHtml, /Orders do not create stock/);
  assert.doesNotMatch(procurementHtml, />Inventory</);
});
