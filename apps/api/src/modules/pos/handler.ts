import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  PosSqlRepository,
  type OfflineOperationUploadInput,
  type PosCartInput,
  type PosCartLineInput,
  type PosCheckoutInput,
  type PosDeviceEnrollmentInput,
  type PosSessionInput,
} from "../../../../../modules/pos/src/sql-repository.js";
import {
  boundedLimit,
  jsonBody,
  jsonResponse,
  optionalString,
  requireArray,
  requireInteger,
  requirePermission,
  requireRecord,
  requireString,
  requireUuid,
} from "../http.js";

const CHECKOUT_MODES = new Set<PosCheckoutInput["mode"]>(["online", "offline"]);
const PAYMENT_STATES = new Set<PosCheckoutInput["paymentState"]>(["not_required", "accepted", "captured", "unknown", "declined"]);
const OFFLINE_OPERATION_TYPES = new Set<OfflineOperationUploadInput["operationType"]>([
  "checkout",
  "cash_event",
  "shift_open",
  "shift_close",
  "receipt_delivery",
  "device_health",
]);

function exactString(value: unknown, field: string, maximumLength = 80): string {
  return requireString(value, field, maximumLength);
}

function recordArray(value: unknown, field: string, maximumLength: number): readonly Readonly<Record<string, unknown>>[] {
  return requireArray(value, field, maximumLength).map((item, index) => requireRecord(item, `${field}[${index}]`));
}

function deviceInput(body: Record<string, unknown>): PosDeviceEnrollmentInput {
  const registerId = optionalString(body.registerId, "registerId", 36);
  return {
    ...(body.id === undefined ? {} : { id: requireUuid(body.id, "id") }),
    storeId: requireUuid(body.storeId, "storeId"),
    ...(registerId === undefined ? {} : { registerId: requireUuid(registerId, "registerId") }),
    deviceKey: requireString(body.deviceKey, "deviceKey", 200),
    displayName: requireString(body.displayName, "displayName", 200),
    capabilities: requireRecord(body.capabilities ?? {}, "capabilities"),
  };
}

function sessionInput(body: Record<string, unknown>): PosSessionInput {
  return {
    ...(body.id === undefined ? {} : { id: requireUuid(body.id, "id") }),
    storeId: requireUuid(body.storeId, "storeId"),
    registerId: requireUuid(body.registerId, "registerId"),
    deviceId: requireUuid(body.deviceId, "deviceId"),
  };
}

function cartLine(value: unknown, index: number): PosCartLineInput {
  const line = requireRecord(value, `lines[${index}]`);
  return {
    ...(line.id === undefined ? {} : { id: requireUuid(line.id, `lines[${index}].id`) }),
    lineNumber: requireInteger(line.lineNumber, `lines[${index}].lineNumber`, 1, 100_000),
    variantReference: requireString(line.variantReference, `lines[${index}].variantReference`, 200),
    quantity: exactString(line.quantity, `lines[${index}].quantity`),
    unitPriceMinor: exactString(line.unitPriceMinor, `lines[${index}].unitPriceMinor`),
    discountMinor: exactString(line.discountMinor, `lines[${index}].discountMinor`),
    taxMinor: exactString(line.taxMinor, `lines[${index}].taxMinor`),
    priceSnapshot: requireRecord(line.priceSnapshot, `lines[${index}].priceSnapshot`),
    taxSnapshot: requireRecord(line.taxSnapshot, `lines[${index}].taxSnapshot`),
  };
}

function cartInput(body: Record<string, unknown>): PosCartInput {
  const customerReference = optionalString(body.customerReference, "customerReference", 200);
  return {
    ...(body.id === undefined ? {} : { id: requireUuid(body.id, "id") }),
    sessionId: requireUuid(body.sessionId, "sessionId"),
    ...(customerReference === undefined ? {} : { customerReference }),
    currency: requireString(body.currency, "currency", 3).toUpperCase(),
    scale: requireInteger(body.scale, "scale", 0, 12),
    lines: requireArray(body.lines, "lines", 1_000).map(cartLine),
  };
}

function checkoutInput(body: Record<string, unknown>): PosCheckoutInput {
  const mode = requireString(body.mode, "mode", 16) as PosCheckoutInput["mode"];
  if (!CHECKOUT_MODES.has(mode)) throw new PlatformError("VALIDATION_FAILED", "Unsupported checkout mode", 400);
  const paymentState = requireString(body.paymentState, "paymentState", 32) as PosCheckoutInput["paymentState"];
  if (!PAYMENT_STATES.has(paymentState)) throw new PlatformError("VALIDATION_FAILED", "Unsupported payment state", 400);

  return {
    ...(body.id === undefined ? {} : { id: requireUuid(body.id, "id") }),
    storeId: requireUuid(body.storeId, "storeId"),
    registerId: requireUuid(body.registerId, "registerId"),
    deviceId: requireUuid(body.deviceId, "deviceId"),
    sessionId: requireUuid(body.sessionId, "sessionId"),
    cartId: requireUuid(body.cartId, "cartId"),
    operationId: requireString(body.operationId, "operationId", 200),
    requestHash: requireString(body.requestHash, "requestHash", 200),
    mode,
    currency: requireString(body.currency, "currency", 3).toUpperCase(),
    scale: requireInteger(body.scale, "scale", 0, 12),
    subtotalMinor: exactString(body.subtotalMinor, "subtotalMinor"),
    discountMinor: exactString(body.discountMinor, "discountMinor"),
    taxMinor: exactString(body.taxMinor, "taxMinor"),
    totalMinor: exactString(body.totalMinor, "totalMinor"),
    paymentState,
    cartSnapshot: requireRecord(body.cartSnapshot, "cartSnapshot"),
    tenderSnapshot: recordArray(body.tenderSnapshot, "tenderSnapshot", 20),
    occurredAt: requireString(body.occurredAt, "occurredAt", 40),
    committedAt: requireString(body.committedAt, "committedAt", 40),
  };
}

function offlineOperation(value: unknown, index: number): OfflineOperationUploadInput {
  const operation = requireRecord(value, `operations[${index}]`);
  const operationType = requireString(operation.operationType, `operations[${index}].operationType`, 32) as OfflineOperationUploadInput["operationType"];
  if (!OFFLINE_OPERATION_TYPES.has(operationType)) throw new PlatformError("VALIDATION_FAILED", "Unsupported offline operation type", 400);
  return {
    ...(operation.id === undefined ? {} : { id: requireUuid(operation.id, `operations[${index}].id`) }),
    deviceId: requireUuid(operation.deviceId, `operations[${index}].deviceId`),
    registerId: requireUuid(operation.registerId, `operations[${index}].registerId`),
    authorizationId: requireUuid(operation.authorizationId, `operations[${index}].authorizationId`),
    operationId: requireString(operation.operationId, `operations[${index}].operationId`, 200),
    deviceSequence: exactString(operation.deviceSequence, `operations[${index}].deviceSequence`),
    operationType,
    aggregateId: requireString(operation.aggregateId, `operations[${index}].aggregateId`, 200),
    aggregateVersion: exactString(operation.aggregateVersion, `operations[${index}].aggregateVersion`),
    payload: requireRecord(operation.payload, `operations[${index}].payload`),
    payloadHash: requireString(operation.payloadHash, `operations[${index}].payloadHash`, 200),
    recordedAt: requireString(operation.recordedAt, `operations[${index}].recordedAt`, 40),
    localSchemaVersion: requireString(operation.localSchemaVersion, `operations[${index}].localSchemaVersion`, 50),
    appVersion: requireString(operation.appVersion, `operations[${index}].appVersion`, 50),
  };
}

export async function handlePosRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  repository = new PosSqlRepository(),
): Promise<Response | undefined> {
  if (request.method === "POST" && url.pathname === "/v1/pos/devices") {
    requirePermission(context, "pos.device.manage");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.enrollDevice(client, context, deviceInput(body))), { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/v1/pos/sessions") {
    requirePermission(context, "pos.session.open");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.openSession(client, context, sessionInput(body))), { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/v1/pos/carts") {
    requirePermission(context, "pos.checkout");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.createCart(client, context, cartInput(body))), { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/v1/pos/checkouts") {
    requirePermission(context, "pos.checkout");
    const body = await jsonBody(request);
    return jsonResponse(await database.withClientTransaction(context, async (client) => await repository.recordCheckout(client, context, checkoutInput(body))), { status: 202 });
  }

  if (request.method === "POST" && url.pathname === "/v1/pos/offline/operations") {
    requirePermission(context, "pos.sync.execute");
    const body = await jsonBody(request, 4_000_000);
    const operations = requireArray(body.operations, "operations", 500).map(offlineOperation);
    return jsonResponse({ outcomes: await database.withClientTransaction(context, async (client) => await repository.uploadOfflineOperations(client, context, operations)) }, { status: 202 });
  }

  if (request.method === "GET" && url.pathname === "/v1/pos/reconciliation") {
    requirePermission(context, "pos.sync.read");
    return jsonResponse({ data: await database.withClientTransaction(context, async (client) => await repository.listReconciliation(client, context, boundedLimit(url))) });
  }

  return undefined;
}
