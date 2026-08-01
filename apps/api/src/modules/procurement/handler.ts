import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { parseSupplierImport } from "../../../../../modules/procurement/import-export.js";
import { ProcurementApiSqlRepository } from "../../../../../modules/procurement/api-sql-repository.js";
import { boundedLimit, jsonBody, jsonResponse, optionalString, requireArray, requireInteger, requirePermission, requireRecord, requireString, requireUuid } from "../http.js";

function quantity(value: unknown): { amount: string; unit: string; scale: number } {
  const record = requireRecord(value, "quantity");
  return { amount: requireString(record.amount, "quantity.amount", 80), unit: requireString(record.unit, "quantity.unit", 32).toUpperCase(), scale: requireInteger(record.scale, "quantity.scale", 0, 18) };
}

export async function handleProcurementRequest(request: Request, url: URL, context: RequestContext, database: NeonDatabase, repository = new ProcurementApiSqlRepository()): Promise<Response | undefined> {
  if (request.method === "GET" && url.pathname === "/v1/procurement/suppliers") {
    requirePermission(context, "procurement.supplier.read");
    return jsonResponse({ data: await database.withClientTransaction(context, async (client) => await repository.listSuppliers(client, context, { ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}), limit: boundedLimit(url) })) });
  }
  if (request.method === "POST" && url.pathname === "/v1/procurement/suppliers") {
    requirePermission(context, "procurement.supplier.manage");
    const body = await jsonBody(request);
    const result = await database.withClientTransaction(context, async (client) => await repository.createSupplier(client, context, {
      id: requireUuid(body.id, "id"), legalEntityId: requireUuid(body.legalEntityId ?? context.legalEntityId, "legalEntityId"),
      code: requireString(body.code, "code", 32), legalName: requireString(body.legalName, "legalName", 240), displayName: requireString(body.displayName, "displayName", 160),
      currency: requireString(body.currency, "currency", 3).toUpperCase(), paymentTermsDays: requireInteger(body.paymentTermsDays, "paymentTermsDays", 0, 3650), leadTimeDays: requireInteger(body.leadTimeDays, "leadTimeDays", 0, 3650),
      ...(optionalString(body.taxRegistration, "taxRegistration", 100) ? { taxRegistration: optionalString(body.taxRegistration, "taxRegistration", 100)! } : {}),
      ...(optionalString(body.email, "email", 320) ? { email: optionalString(body.email, "email", 320)! } : {}),
      ...(optionalString(body.phone, "phone", 64) ? { phone: optionalString(body.phone, "phone", 64)! } : {}),
    }));
    return jsonResponse(result, { status: 201 });
  }
  if (request.method === "POST" && url.pathname === "/v1/procurement/suppliers/import") {
    requirePermission(context, "procurement.supplier.manage");
    const legalEntityId = requireUuid(request.headers.get("x-legal-entity-id") ?? context.legalEntityId, "x-legal-entity-id");
    const rows = parseSupplierImport(await request.text());
    const imported = await database.withClientTransaction(context, async (client) => {
      for (const row of rows) await repository.createSupplier(client, context, { ...row, legalEntityId });
      return rows.length;
    });
    return jsonResponse({ imported }, { status: 201 });
  }
  if (request.method === "GET" && url.pathname === "/v1/procurement/purchase-orders") {
    requirePermission(context, "procurement.purchase_order.read");
    const supplierId = url.searchParams.get("supplierId") ? requireUuid(url.searchParams.get("supplierId"), "supplierId") : undefined;
    const warehouseId = url.searchParams.get("warehouseId") ? requireUuid(url.searchParams.get("warehouseId"), "warehouseId") : undefined;
    return jsonResponse({ data: await database.withClientTransaction(context, async (client) => await repository.listOpenPurchaseOrders(client, context, { ...(supplierId ? { supplierId } : {}), ...(warehouseId ? { warehouseId } : {}), limit: boundedLimit(url) })) });
  }
  if (request.method === "POST" && url.pathname === "/v1/procurement/purchase-orders") {
    requirePermission(context, "procurement.purchase_order.manage");
    const body = await jsonBody(request);
    const lines = requireArray(body.lines, "lines", 500).map((value) => {
      const line = requireRecord(value, "purchase order line");
      return {
        id: requireUuid(line.id, "line.id"), itemId: requireUuid(line.itemId, "line.itemId"), variantId: requireUuid(line.variantId, "line.variantId"), quantity: quantity(line.quantity), unitCostMinor: requireString(line.unitCostMinor, "line.unitCostMinor", 80),
        ...(optionalString(line.taxCode, "line.taxCode", 64) ? { taxCode: optionalString(line.taxCode, "line.taxCode", 64)! } : {}),
        ...(optionalString(line.promisedDate, "line.promisedDate", 10) ? { promisedDate: optionalString(line.promisedDate, "line.promisedDate", 10)! } : {}),
        ...(line.overReceiptToleranceBasisPoints === undefined ? {} : { overReceiptToleranceBasisPoints: requireInteger(line.overReceiptToleranceBasisPoints, "line.overReceiptToleranceBasisPoints", 0, 10_000) }),
        ...(optionalString(line.notes, "line.notes", 2000) ? { notes: optionalString(line.notes, "line.notes", 2000)! } : {}),
      };
    });
    const result = await database.withClientTransaction(context, async (client) => await repository.createPurchaseOrder(client, context, {
      id: requireUuid(body.id, "id"), legalEntityId: requireUuid(body.legalEntityId ?? context.legalEntityId, "legalEntityId"), supplierId: requireUuid(body.supplierId, "supplierId"), orderNumber: requireString(body.orderNumber, "orderNumber", 100), warehouseId: requireUuid(body.warehouseId, "warehouseId"), lines,
    }));
    return jsonResponse(result, { status: 201 });
  }
  const submitMatch = /^\/v1\/procurement\/purchase-orders\/([0-9a-f-]+)\/submit$/iu.exec(url.pathname);
  if (request.method === "POST" && submitMatch) {
    requirePermission(context, "procurement.purchase_order.manage");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.submitPurchaseOrder(client, context, requireUuid(submitMatch[1], "purchaseOrderId"), requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER))));
  }
  const approveMatch = /^\/v1\/procurement\/purchase-orders\/([0-9a-f-]+)\/approve$/iu.exec(url.pathname);
  if (request.method === "POST" && approveMatch) {
    requirePermission(context, "procurement.purchase_order.approve");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.approvePurchaseOrder(client, context, { purchaseOrderId: requireUuid(approveMatch[1], "purchaseOrderId"), approvalId: requireUuid(body.approvalId, "approvalId"), expectedVersion: requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER) })));
  }
  if (request.method === "POST" && url.pathname === "/v1/procurement/goods-receipts") {
    requirePermission(context, "procurement.receipt.manage");
    const body = await jsonBody(request);
    const lines = requireArray(body.lines, "lines", 500).map((value) => {
      const line = requireRecord(value, "goods receipt line");
      const disposition = requireString(line.disposition, "line.disposition", 32) as "accepted" | "quarantine" | "damaged" | "rejected";
      return {
        id: requireUuid(line.id, "line.id"), purchaseOrderLineId: requireUuid(line.purchaseOrderLineId, "line.purchaseOrderLineId"), quantity: quantity(line.quantity), disposition,
        ...(line.batchId === undefined ? {} : { batchId: requireUuid(line.batchId, "line.batchId") }),
        ...(line.serialIds === undefined ? {} : { serialIds: (Array.isArray(line.serialIds) ? line.serialIds : []).map((serialId) => requireUuid(serialId, "line.serialIds")) }),
        ...(optionalString(line.expiryDate, "line.expiryDate", 10) ? { expiryDate: optionalString(line.expiryDate, "line.expiryDate", 10)! } : {}),
        ...(optionalString(line.discrepancyReason, "line.discrepancyReason", 500) ? { discrepancyReason: optionalString(line.discrepancyReason, "line.discrepancyReason", 500)! } : {}),
      };
    });
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.receivePurchaseOrder(client, context, {
      receiptId: requireUuid(body.receiptId, "receiptId"), receiptNumber: requireString(body.receiptNumber, "receiptNumber", 100), purchaseOrderId: requireUuid(body.purchaseOrderId, "purchaseOrderId"), operationId: requireString(body.operationId, "operationId", 200), postingGroupId: requireString(body.postingGroupId, "postingGroupId", 200), lines,
    })), { status: 201 });
  }
  if (request.method === "GET" && url.pathname === "/v1/procurement/reports/supplier-performance") {
    requirePermission(context, "procurement.report.read");
    return jsonResponse({ data: await database.withClientTransaction(context, async (client) => await repository.supplierPerformance(client, context)) });
  }
  if (request.method === "GET" && url.pathname === "/v1/procurement/health") {
    requirePermission(context, "procurement.report.read");
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.operationalHealth(client, context)));
  }
  return undefined;
}
