import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  CashSqlRepository,
  type AppendCashEventInput,
  type CashLedgerEventType,
  type CloseCashShiftInput,
  type OpenCashShiftInput,
} from "../../../../../modules/cash/src/sql-repository.js";
import {
  boundedLimit,
  jsonBody,
  jsonResponse,
  optionalString,
  requireInteger,
  requirePermission,
  requireRecord,
  requireString,
  requireUuid,
} from "../http.js";

const CASH_EVENT_TYPES = new Set<CashLedgerEventType>([
  "cash_sale",
  "cash_refund",
  "paid_in",
  "paid_out",
  "safe_drop",
  "adjustment_in",
  "adjustment_out",
]);
const COUNT_TYPES = new Set<CloseCashShiftInput["countType"]>(["blind_close", "recount", "audit"]);

function optionalUuid(value: unknown, field: string): string | undefined {
  const parsed = optionalString(value, field, 36);
  return parsed === undefined ? undefined : requireUuid(parsed, field);
}

function exactString(value: unknown, field: string): string {
  return requireString(value, field, 80);
}

function openShiftInput(body: Record<string, unknown>): OpenCashShiftInput {
  const id = optionalUuid(body.id, "id");
  const openingEventId = optionalUuid(body.openingEventId, "openingEventId");
  return {
    ...(id === undefined ? {} : { id }),
    storeId: requireUuid(body.storeId, "storeId"),
    registerId: requireUuid(body.registerId, "registerId"),
    posSessionId: requireUuid(body.posSessionId, "posSessionId"),
    currency: requireString(body.currency, "currency", 3).toUpperCase(),
    scale: requireInteger(body.scale, "scale", 0, 12),
    openingFloatMinor: exactString(body.openingFloatMinor, "openingFloatMinor"),
    ...(openingEventId === undefined ? {} : { openingEventId }),
    idempotencyKey: requireString(body.idempotencyKey, "idempotencyKey", 200),
    requestHash: requireString(body.requestHash, "requestHash", 200),
    occurredAt: requireString(body.occurredAt, "occurredAt", 40),
  };
}

function cashEventInput(body: Record<string, unknown>, shiftId: string): AppendCashEventInput {
  const eventType = requireString(body.eventType, "eventType", 32) as CashLedgerEventType;
  if (!CASH_EVENT_TYPES.has(eventType)) throw new PlatformError("VALIDATION_FAILED", "Unsupported cash event type", 400);
  const id = optionalUuid(body.id, "id");
  const reversalOfEventId = optionalUuid(body.reversalOfEventId, "reversalOfEventId");
  const approvalRequestId = optionalUuid(body.approvalRequestId, "approvalRequestId");
  const reason = optionalString(body.reason, "reason", 500);
  return {
    ...(id === undefined ? {} : { id }),
    shiftId,
    eventType,
    currency: requireString(body.currency, "currency", 3).toUpperCase(),
    scale: requireInteger(body.scale, "scale", 0, 12),
    amountMinor: exactString(body.amountMinor, "amountMinor"),
    sourceType: requireString(body.sourceType, "sourceType", 100),
    sourceId: requireString(body.sourceId, "sourceId", 200),
    ...(reversalOfEventId === undefined ? {} : { reversalOfEventId }),
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    idempotencyKey: requireString(body.idempotencyKey, "idempotencyKey", 200),
    requestHash: requireString(body.requestHash, "requestHash", 200),
    ...(reason === undefined ? {} : { reason }),
    occurredAt: requireString(body.occurredAt, "occurredAt", 40),
  };
}

function closeShiftInput(body: Record<string, unknown>, shiftId: string): CloseCashShiftInput {
  const countType = requireString(body.countType, "countType", 32) as CloseCashShiftInput["countType"];
  if (!COUNT_TYPES.has(countType)) throw new PlatformError("VALIDATION_FAILED", "Unsupported cash count type", 400);
  const cashCountId = optionalUuid(body.cashCountId, "cashCountId");
  const closureId = optionalUuid(body.closureId, "closureId");
  const approvalRequestId = optionalUuid(body.approvalRequestId, "approvalRequestId");
  return {
    shiftId,
    ...(cashCountId === undefined ? {} : { cashCountId }),
    ...(closureId === undefined ? {} : { closureId }),
    countType,
    currency: requireString(body.currency, "currency", 3).toUpperCase(),
    scale: requireInteger(body.scale, "scale", 0, 12),
    countedMinor: exactString(body.countedMinor, "countedMinor"),
    denominationBreakdown: requireRecord(body.denominationBreakdown ?? {}, "denominationBreakdown"),
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    closedAt: requireString(body.closedAt, "closedAt", 40),
  };
}

export async function handleCashRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  repository = new CashSqlRepository(),
): Promise<Response | undefined> {
  if (request.method === "POST" && url.pathname === "/v1/cash/shifts") {
    requirePermission(context, "cash.shift.open");
    const body = await jsonBody(request);
    const result = await database.withClientTransaction(context, async (client) => await repository.openShift(client, context, openShiftInput(body)));
    return jsonResponse(result, { status: 201 });
  }

  const eventsRoute = url.pathname.match(/^\/v1\/cash\/shifts\/([^/]+)\/events$/u);
  if (eventsRoute?.[1]) {
    const shiftId = requireUuid(eventsRoute[1], "shiftId");
    if (request.method === "POST") {
      requirePermission(context, "cash.event.append");
      const body = await jsonBody(request);
      const result = await database.withClientTransaction(context, async (client) => await repository.appendEvent(client, context, cashEventInput(body, shiftId)));
      return jsonResponse(result, { status: 201 });
    }
    if (request.method === "GET") {
      requirePermission(context, "cash.shift.read");
      const data = await database.withClientTransaction(context, async (client) => await repository.listShiftEvents(client, context, shiftId, boundedLimit(url)));
      return jsonResponse({ data });
    }
  }

  const closeRoute = url.pathname.match(/^\/v1\/cash\/shifts\/([^/]+)\/close$/u);
  if (request.method === "POST" && closeRoute?.[1]) {
    requirePermission(context, "cash.shift.close");
    const shiftId = requireUuid(closeRoute[1], "shiftId");
    const body = await jsonBody(request);
    const result = await database.withClientTransaction(context, async (client) => await repository.closeShift(client, context, closeShiftInput(body, shiftId)));
    return jsonResponse(result);
  }

  return undefined;
}
