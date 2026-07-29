import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import { exportCsv, parseReorderPolicyImport } from "../../../../../modules/inventory/import-export.js";
import { InventoryOperationsSqlRepository } from "../../../../../modules/inventory/operations-sql-repository.js";
import type { MovementType, StockPostingCommand, StockPostingLine, StockStatus } from "../../../../../modules/inventory/types.js";
import { boundedLimit, jsonBody, jsonResponse, optionalString, requireArray, requireInteger, requirePermission, requireRecord, requireString, requireUuid } from "../http.js";

const MOVEMENTS = new Set<MovementType>(["opening_balance", "purchase_receipt", "sale_issue", "customer_return", "supplier_return", "transfer_dispatch", "transfer_receipt", "adjustment_gain", "adjustment_loss", "physical_count_variance", "status_change", "landed_cost_revaluation", "reversal"]);
const STATUSES = new Set<StockStatus>(["sellable", "reserved", "in_transit", "damaged", "quarantine"]);

function quantity(value: unknown): { amount: string; unit: string; scale: number } {
  const record = requireRecord(value, "quantity");
  return { amount: requireString(record.amount, "quantity.amount", 80), unit: requireString(record.unit, "quantity.unit", 32).toUpperCase(), scale: requireInteger(record.scale, "quantity.scale", 0, 18) };
}

function postingLine(value: unknown): StockPostingLine {
  const record = requireRecord(value, "stock posting line");
  const item = requireRecord(record.item, "stock posting line item");
  const statusValue = optionalString(record.stockStatus, "stockStatus", 32);
  if (statusValue !== undefined && !STATUSES.has(statusValue as StockStatus)) throw new PlatformError("VALIDATION_FAILED", "Unsupported stock status", 400);
  return {
    item: { itemId: requireUuid(item.itemId, "item.itemId"), variantId: requireUuid(item.variantId, "item.variantId") },
    warehouseId: requireUuid(record.warehouseId, "warehouseId"),
    ...(record.binId === undefined ? {} : { binId: requireUuid(record.binId, "binId") }),
    ...(statusValue === undefined ? {} : { stockStatus: statusValue as StockStatus }),
    ...(record.batchId === undefined ? {} : { batchId: requireUuid(record.batchId, "batchId") }),
    ...(record.serialId === undefined ? {} : { serialId: requireUuid(record.serialId, "serialId") }),
    ...(record.expiryDate === undefined ? {} : { expiryDate: requireString(record.expiryDate, "expiryDate", 10) }),
    quantityDelta: quantity(record.quantityDelta),
    ...(record.unitCostMinor === undefined ? {} : { unitCostMinor: requireString(record.unitCostMinor, "unitCostMinor", 80) }),
    ...(record.currency === undefined ? {} : { currency: requireString(record.currency, "currency", 3).toUpperCase() }),
    sourceDocumentId: requireString(record.sourceDocumentId, "sourceDocumentId", 200),
    ...(record.sourceDocumentLineId === undefined ? {} : { sourceDocumentLineId: requireString(record.sourceDocumentLineId, "sourceDocumentLineId", 200) }),
    ...(record.reversalOfEntryId === undefined ? {} : { reversalOfEntryId: requireUuid(record.reversalOfEntryId, "reversalOfEntryId") }),
  };
}

function postingCommand(body: Record<string, unknown>, context: RequestContext): StockPostingCommand {
  const movement = requireString(body.movementType, "movementType", 64) as MovementType;
  if (!MOVEMENTS.has(movement)) throw new PlatformError("VALIDATION_FAILED", "Unsupported movement type", 400);
  return {
    schemaVersion: "1.0",
    context: { tenantId: context.tenantId, ...(context.legalEntityId ? { legalEntityId: context.legalEntityId } : {}), actorId: context.actorId, locale: context.locale, timeZone: context.timeZone, businessDate: context.businessDate },
    operationId: requireString(body.operationId, "operationId", 200),
    postingGroupId: requireString(body.postingGroupId, "postingGroupId", 200),
    movementType: movement,
    sourceDocumentType: requireString(body.sourceDocumentType, "sourceDocumentType", 100),
    lines: requireArray(body.lines, "lines", 500).map(postingLine),
    audit: { actorId: context.actorId, requestId: context.requestId, traceId: context.traceId, ...(body.reason === undefined ? {} : { reason: requireString(body.reason, "reason", 500) }) },
    ...(body.approvalId === undefined ? {} : { approvalId: requireUuid(body.approvalId, "approvalId") }),
  };
}

export async function handleInventoryRequest(request: Request, url: URL, context: RequestContext, database: NeonDatabase, repository = new InventoryOperationsSqlRepository()): Promise<Response | undefined> {
  if (request.method === "GET" && url.pathname === "/v1/inventory/availability") {
    requirePermission(context, "inventory.stock.read");
    const variantId = requireUuid(url.searchParams.get("variantId"), "variantId");
    const warehouseId = requireUuid(url.searchParams.get("warehouseId"), "warehouseId");
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.availability(client, context, { variantId, warehouseId })));
  }
  if (request.method === "GET" && (url.pathname === "/v1/inventory/movements" || url.pathname === "/v1/inventory/movements.csv")) {
    requirePermission(context, "inventory.stock.read");
    const variantId = url.searchParams.get("variantId") === null ? undefined : requireUuid(url.searchParams.get("variantId"), "variantId");
    const warehouseId = url.searchParams.get("warehouseId") === null ? undefined : requireUuid(url.searchParams.get("warehouseId"), "warehouseId");
    const rows = await database.withClientTransaction(context, async (client) => await repository.listMovement(client, context, { ...(variantId ? { variantId } : {}), ...(warehouseId ? { warehouseId } : {}), limit: boundedLimit(url) }));
    if (url.pathname.endsWith(".csv")) {
      const columns = ["id", "operation_id", "posting_group_id", "variant_id", "warehouse_id", "stock_status", "quantity_amount", "quantity_scale", "unit_code", "unit_cost_minor", "currency", "value_delta_minor", "movement_type", "source_document_type", "source_document_id", "source_document_line_id", "business_date", "posted_at", "reversal_of_entry_id"];
      const csv = exportCsv(columns, rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] === null || row[column] === undefined ? "" : String(row[column])]))));
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=inventory-movements.csv" } });
    }
    return jsonResponse({ data: rows });
  }
  if (request.method === "GET" && url.pathname === "/v1/inventory/reconciliation") {
    requirePermission(context, "inventory.stock.reconcile");
    const rows = await database.withClientTransaction(context, async (client) => await repository.reconciliationSummary(client, context));
    const mismatchCount = rows.filter((row) => row.matched !== true).length;
    return jsonResponse({ status: mismatchCount === 0 ? "matched" : "mismatch", mismatchCount, dimensions: rows });
  }
  if (request.method === "POST" && url.pathname === "/v1/inventory/stock-postings") {
    requirePermission(context, "inventory.stock.post");
    const command = postingCommand(await jsonBody(request), context);
    if (["adjustment_loss", "physical_count_variance"].includes(command.movementType)) requirePermission(context, "inventory.stock.adjust");
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.postStock(client, context, command)), { status: 201 });
  }
  if (request.method === "POST" && url.pathname === "/v1/inventory/reorder-policies/import") {
    requirePermission(context, "inventory.replenishment.manage");
    const csv = await request.text();
    const rows = parseReorderPolicyImport(csv);
    const result = await database.withClientTransaction(context, async (client) => {
      for (const row of rows) {
        const values = [row.reorderPoint, row.safetyStock, row.minimumQuantity, row.maximumQuantity].map((amount) => {
          const parsed = postingLine({ item: { itemId: row.variantId, variantId: row.variantId }, warehouseId: row.warehouseId, quantityDelta: { amount, unit: row.unit, scale: row.scale }, sourceDocumentId: row.id });
          const [whole = "0", fraction = ""] = parsed.quantityDelta.amount.split(".");
          return `${whole}${fraction.padEnd(row.scale, "0")}`;
        });
        await client.query(
          `INSERT INTO inventory.reorder_policies(
             id, tenant_id, variant_id, warehouse_id, supplier_id, reorder_point, safety_stock,
             minimum_quantity, maximum_quantity, quantity_scale, unit_code, lead_time_days
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10,$11,$12)
           ON CONFLICT (tenant_id, variant_id, warehouse_id) DO UPDATE SET
             supplier_id = EXCLUDED.supplier_id, reorder_point = EXCLUDED.reorder_point,
             safety_stock = EXCLUDED.safety_stock, minimum_quantity = EXCLUDED.minimum_quantity,
             maximum_quantity = EXCLUDED.maximum_quantity, quantity_scale = EXCLUDED.quantity_scale,
             unit_code = EXCLUDED.unit_code, lead_time_days = EXCLUDED.lead_time_days,
             active = true, updated_at = now(), version = inventory.reorder_policies.version + 1`,
          [row.id, context.tenantId, requireUuid(row.variantId, "variant_id"), requireUuid(row.warehouseId, "warehouse_id"), row.supplierId ? requireUuid(row.supplierId, "supplier_id") : null, ...values, row.scale, row.unit, row.leadTimeDays],
        );
      }
      return { imported: rows.length };
    });
    return jsonResponse(result, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/v1/inventory/reservations") {
    requirePermission(context, "inventory.reservation.manage");
    const body = await jsonBody(request);
    const policy = requireString(body.fulfillmentPolicy, "fulfillmentPolicy", 32);
    if (policy !== "all_or_nothing" && policy !== "allow_partial") throw new PlatformError("VALIDATION_FAILED", "Unsupported fulfillment policy", 400);
    const lines = requireArray(body.lines, "lines", 500).map((value) => {
      const line = requireRecord(value, "reservation line");
      return { id: requireUuid(line.id, "line.id"), variantId: requireUuid(line.variantId, "line.variantId"), warehouseId: requireUuid(line.warehouseId, "line.warehouseId"), quantity: quantity(line.quantity) };
    });
    const result = await database.withClientTransaction(context, async (client) => await repository.createReservation(client, context, {
      id: requireUuid(body.id, "id"), sourceType: requireString(body.sourceType, "sourceType", 100), sourceId: requireString(body.sourceId, "sourceId", 200), fulfillmentPolicy: policy, ...(body.expiresAt === undefined ? {} : { expiresAt: requireString(body.expiresAt, "expiresAt", 40) }), lines,
    }));
    return jsonResponse(result, { status: 201 });
  }
  const reservationRelease = /^\/v1\/inventory\/reservations\/([0-9a-f-]+)\/release$/iu.exec(url.pathname);
  if (request.method === "POST" && reservationRelease) {
    requirePermission(context, "inventory.reservation.manage");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.releaseReservation(client, context, requireUuid(reservationRelease[1], "reservationId"), requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER))));
  }
  const reservationConsume = /^\/v1\/inventory\/reservations\/([0-9a-f-]+)\/consume$/iu.exec(url.pathname);
  if (request.method === "POST" && reservationConsume) {
    requirePermission(context, "inventory.reservation.manage");
    const body = await jsonBody(request);
    const rawQuantities = body.quantities === undefined ? undefined : requireRecord(body.quantities, "quantities");
    const quantities = rawQuantities === undefined ? undefined : Object.fromEntries(Object.entries(rawQuantities).map(([lineId, value]) => [requireUuid(lineId, "reservation line id"), quantity(value)]));
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.consumeReservation(client, context, { reservationId: requireUuid(reservationConsume[1], "reservationId"), expectedVersion: requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER), ...(quantities === undefined ? {} : { quantities }) })));
  }
  if (request.method === "POST" && url.pathname === "/v1/inventory/transfers") {
    requirePermission(context, "inventory.transfer.manage");
    const body = await jsonBody(request);
    const lines = requireArray(body.lines, "lines", 500).map((value) => {
      const line = requireRecord(value, "transfer line");
      const serialIds = line.serialIds === undefined ? undefined : requireArray(line.serialIds, "line.serialIds", 1000).map((serialId) => requireUuid(serialId, "line.serialId"));
      return { id: requireUuid(line.id, "line.id"), variantId: requireUuid(line.variantId, "line.variantId"), quantity: quantity(line.quantity), ...(line.batchId === undefined ? {} : { batchId: requireUuid(line.batchId, "line.batchId") }), ...(serialIds === undefined ? {} : { serialIds }) };
    });
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.createTransfer(client, context, { id: requireUuid(body.id, "id"), legalEntityId: requireUuid(body.legalEntityId ?? context.legalEntityId, "legalEntityId"), sourceWarehouseId: requireUuid(body.sourceWarehouseId, "sourceWarehouseId"), destinationWarehouseId: requireUuid(body.destinationWarehouseId, "destinationWarehouseId"), lines })), { status: 201 });
  }
  const transferApprove = /^\/v1\/inventory\/transfers\/([0-9a-f-]+)\/approve$/iu.exec(url.pathname);
  if (request.method === "POST" && transferApprove) {
    requirePermission(context, "inventory.transfer.approve");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.approveTransfer(client, context, { transferId: requireUuid(transferApprove[1], "transferId"), approvalId: requireUuid(body.approvalId, "approvalId"), expectedVersion: requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER) })));
  }
  const transferDispatch = /^\/v1\/inventory\/transfers\/([0-9a-f-]+)\/dispatch$/iu.exec(url.pathname);
  if (request.method === "POST" && transferDispatch) {
    requirePermission(context, "inventory.transfer.manage");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.dispatchTransfer(client, context, { transferId: requireUuid(transferDispatch[1], "transferId"), operationId: requireString(body.operationId, "operationId", 200), postingGroupId: requireString(body.postingGroupId, "postingGroupId", 200) })));
  }
  const transferReceive = /^\/v1\/inventory\/transfers\/([0-9a-f-]+)\/receive$/iu.exec(url.pathname);
  if (request.method === "POST" && transferReceive) {
    requirePermission(context, "inventory.transfer.manage");
    const body = await jsonBody(request);
    const lines = requireArray(body.lines, "lines", 500).map((value) => { const line = requireRecord(value, "transfer receipt line"); return { lineId: requireUuid(line.lineId, "line.lineId"), received: quantity(line.received), ...(line.damaged === undefined ? {} : { damaged: quantity(line.damaged) }), ...(line.missing === undefined ? {} : { missing: quantity(line.missing) }) }; });
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.receiveTransfer(client, context, { transferId: requireUuid(transferReceive[1], "transferId"), operationId: requireString(body.operationId, "operationId", 200), postingGroupId: requireString(body.postingGroupId, "postingGroupId", 200), lines })));
  }
  if (request.method === "POST" && url.pathname === "/v1/inventory/counts") {
    requirePermission(context, "inventory.count.manage");
    const body = await jsonBody(request);
    const items = requireArray(body.items, "items", 5000).map((value) => { const item = requireRecord(value, "count item"); return { id: requireUuid(item.id, "item.id"), variantId: requireUuid(item.variantId, "item.variantId"), unit: requireString(item.unit, "item.unit", 32).toUpperCase(), scale: requireInteger(item.scale, "item.scale", 0, 18) }; });
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.createCount(client, context, { id: requireUuid(body.id, "id"), warehouseId: requireUuid(body.warehouseId, "warehouseId"), blind: body.blind === undefined ? true : body.blind === true, items })), { status: 201 });
  }
  const countSubmit = /^\/v1\/inventory\/counts\/([0-9a-f-]+)\/submit$/iu.exec(url.pathname);
  if (request.method === "POST" && countSubmit) {
    requirePermission(context, "inventory.count.manage");
    const body = await jsonBody(request);
    const observationsRecord = requireRecord(body.observations, "observations");
    const observations = Object.fromEntries(Object.entries(observationsRecord).map(([lineId, value]) => [requireUuid(lineId, "count line id"), quantity(value)]));
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.submitCount(client, context, { countId: requireUuid(countSubmit[1], "countId"), expectedVersion: requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER), observations, recount: body.recount === true })));
  }
  const countPost = /^\/v1\/inventory\/counts\/([0-9a-f-]+)\/approve-post$/iu.exec(url.pathname);
  if (request.method === "POST" && countPost) {
    requirePermission(context, "inventory.count.approve");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.approveAndPostCount(client, context, { countId: requireUuid(countPost[1], "countId"), approvalId: requireUuid(body.approvalId, "approvalId"), expectedVersion: requireInteger(body.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER), operationId: requireString(body.operationId, "operationId", 200), postingGroupId: requireString(body.postingGroupId, "postingGroupId", 200) })));
  }
  if (request.method === "POST" && url.pathname === "/v1/inventory/jobs/expire-reservations") {
    requirePermission(context, "inventory.reservation.manage");
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.expireReservations(client, context)));
  }
  if (request.method === "POST" && url.pathname === "/v1/inventory/jobs/reconcile") {
    requirePermission(context, "inventory.stock.reconcile");
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.runReconciliation(client, context)));
  }
  if (request.method === "GET" && url.pathname === "/v1/inventory/replenishment-proposals") {
    requirePermission(context, "inventory.replenishment.read");
    return jsonResponse({ data: await database.withClientTransaction(context, async (client) => await repository.generateReplenishmentProposals(client, context)) });
  }
  if (request.method === "GET" && url.pathname === "/v1/inventory/health") {
    requirePermission(context, "inventory.stock.read");
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.operationalHealth(client, context)));
  }
  return undefined;
}
