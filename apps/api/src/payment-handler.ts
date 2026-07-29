import { sha256Hex } from "../../../packages/foundation/src/crypto.js";
import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { assertUuid, uuidV7 } from "../../../packages/foundation/src/ids.js";
import { money, type Money } from "../../../packages/foundation/src/money.js";
import { DeterministicPaymentProvider } from "../../../modules/payments/src/simulator.js";
import { MapPaymentProviderRegistry, PaymentService, type PaymentIntentResult, type RefundResult, type SettlementImportResult } from "../../../modules/payments/src/service.js";
import { NeonPaymentStore } from "../../../modules/payments/src/store.js";

export interface PaymentApiEnvironment {
  readonly APP_ENV: string;
}

const simulator = new DeterministicPaymentProvider();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string, maximum = 256): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, field: string, maximum = 256): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is invalid`, 400);
  }
  return value.trim();
}

function requiredUuid(record: Record<string, unknown>, field: string): string {
  try {
    return assertUuid(requiredString(record, field, 64), field);
  } catch {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be a UUID`, 400);
  }
}

function optionalUuid(record: Record<string, unknown>, field: string): string | undefined {
  const value = optionalString(record, field, 64);
  if (!value) return undefined;
  try {
    return assertUuid(value, field);
  } catch {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be a UUID`, 400);
  }
}

function parseMoney(value: unknown, field = "amount"): Money {
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  const amountMinor = value.amountMinor;
  const currency = value.currency;
  const scale = value.scale;
  if (typeof amountMinor !== "string" || !/^-?\d+$/u.test(amountMinor)) throw new PlatformError("VALIDATION_FAILED", `${field}.amountMinor must be an integer string`, 400);
  if (typeof currency !== "string") throw new PlatformError("VALIDATION_FAILED", `${field}.currency is required`, 400);
  if (!Number.isInteger(scale)) throw new PlatformError("VALIDATION_FAILED", `${field}.scale must be an integer`, 400);
  try {
    return money(BigInt(amountMinor), currency, scale as number);
  } catch (error) {
    throw new PlatformError("VALIDATION_FAILED", error instanceof Error ? error.message : `${field} is invalid`, 400);
  }
}

async function bodyRecord(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) throw new PlatformError("VALIDATION_FAILED", "Request body must be an object", 400);
  return body;
}

async function optionalBodyRecord(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) throw new PlatformError("VALIDATION_FAILED", "Request body must be an object", 400);
  return body;
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length < 8 || value.length > 200) throw new PlatformError("VALIDATION_FAILED", "idempotency-key header is required", 400);
  return value;
}

function paymentService(env: PaymentApiEnvironment, database: NeonDatabase): PaymentService {
  if (!["local", "development", "preview", "test"].includes(env.APP_ENV)) {
    throw new PlatformError("INTERNAL_ERROR", "No live payment provider adapter is configured", 503);
  }
  return new PaymentService(new NeonPaymentStore(database), new MapPaymentProviderRegistry([["simulator", simulator]]));
}

function moneyJson(value: Money): Readonly<Record<string, string | number>> {
  return { amountMinor: value.amountMinor.toString(), currency: value.currency, scale: value.scale };
}

function intentJson(result: PaymentIntentResult): Readonly<Record<string, unknown>> {
  return {
    intentId: result.intentId,
    providerAccountId: result.providerAccountId,
    providerKey: result.providerKey,
    status: result.status,
    amount: moneyJson(result.amount),
    capturedAmount: moneyJson(result.capturedAmount),
    refundedAmount: moneyJson(result.refundedAmount),
    ...(result.providerReference ? { providerReference: result.providerReference } : {}),
    version: result.version.toString(),
    observedAt: result.observedAt,
    replayed: result.replayed,
  };
}

function refundJson(result: RefundResult): Readonly<Record<string, unknown>> {
  return {
    refundId: result.refundId,
    intentId: result.intentId,
    status: result.status,
    amount: moneyJson(result.amount),
    ...(result.providerReference ? { providerReference: result.providerReference } : {}),
    observedAt: result.observedAt,
    replayed: result.replayed,
  };
}

function settlementJson(result: SettlementImportResult): Readonly<Record<string, unknown>> {
  return {
    settlementId: result.settlementId,
    providerAccountId: result.providerAccountId,
    providerSettlementId: result.providerSettlementId,
    gross: moneyJson(result.gross),
    fees: moneyJson(result.fees),
    adjustments: moneyJson(result.adjustments),
    net: moneyJson(result.net),
    settledAt: result.settledAt,
    sourceHash: result.sourceHash,
    status: result.status,
    replayed: result.replayed,
  };
}

function intentResponse(result: PaymentIntentResult, created = false): Response {
  return Response.json(
    { data: intentJson(result) },
    {
      status: created && !result.replayed ? 201 : 200,
      headers: { etag: `W/\"v${result.version.toString()}\"` },
    },
  );
}

export async function handleCreatePaymentIntent(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  env: PaymentApiEnvironment,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    intentId: optionalUuid(body, "intentId") ?? uuidV7(),
    providerAccountId: requiredUuid(body, "providerAccountId"),
    sourceType: requiredString(body, "sourceType", 40),
    sourceId: requiredString(body, "sourceId"),
    sourceVersion: requiredString(body, "sourceVersion", 80),
    amount: parseMoney(body.amount),
    methodReference: requiredString(body, "paymentMethodReference", 512),
    idempotencyKey: key,
  };
  if (!["invoice", "order", "pos_checkout", "customer_account"].includes(command.sourceType)) {
    throw new PlatformError("VALIDATION_FAILED", "sourceType is invalid", 400);
  }
  const requestHash = await sha256Hex(JSON.stringify({
    intentId: command.intentId,
    providerAccountId: command.providerAccountId,
    sourceType: command.sourceType,
    sourceId: command.sourceId,
    sourceVersion: command.sourceVersion,
    amount: moneyJson(command.amount),
    paymentMethodReference: command.methodReference,
  }));
  const result = await paymentService(env, database).createIntent(context, {
    ...command,
    sourceType: command.sourceType as "invoice" | "order" | "pos_checkout" | "customer_account",
    requestHash,
  });
  return intentResponse(result, true);
}

export async function handlePaymentAction(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  env: PaymentApiEnvironment,
  intentId: string,
  action: "authorize" | "capture" | "void" | "recover",
): Promise<Response> {
  let normalizedIntentId: string;
  try {
    normalizedIntentId = assertUuid(intentId, "intentId");
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "intentId must be a UUID", 400);
  }
  const body = await optionalBodyRecord(request);
  const amount = body.amount === undefined ? undefined : parseMoney(body.amount);
  if ((action === "void" || action === "recover") && amount) throw new PlatformError("VALIDATION_FAILED", `${action} does not accept an amount`, 400);
  const key = idempotencyKey(request);
  const requestHash = await sha256Hex(JSON.stringify({ intentId: normalizedIntentId, action, ...(amount ? { amount: moneyJson(amount) } : {}) }));
  const service = paymentService(env, database);
  if (action === "authorize") return intentResponse(await service.authorize(context, { intentId: normalizedIntentId, idempotencyKey: key, requestHash, ...(amount ? { amount } : {}) }));
  if (action === "capture") return intentResponse(await service.capture(context, { intentId: normalizedIntentId, idempotencyKey: key, requestHash, ...(amount ? { amount } : {}) }));
  if (action === "void") return intentResponse(await service.void(context, { intentId: normalizedIntentId, idempotencyKey: key, requestHash }));
  return intentResponse(await service.recoverStatus(context, { intentId: normalizedIntentId, idempotencyKey: key, requestHash }));
}

export async function handleCreateRefund(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  env: PaymentApiEnvironment,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    refundId: optionalUuid(body, "refundId") ?? uuidV7(),
    intentId: requiredUuid(body, "intentId"),
    amount: parseMoney(body.amount),
    reason: requiredString(body, "reason", 500),
    approvalRequestId: optionalUuid(body, "approvalRequestId"),
    idempotencyKey: key,
  };
  const requestHash = await sha256Hex(JSON.stringify({
    refundId: command.refundId,
    intentId: command.intentId,
    amount: moneyJson(command.amount),
    reason: command.reason,
    approvalRequestId: command.approvalRequestId ?? null,
  }));
  const result = await paymentService(env, database).refund(context, {
    refundId: command.refundId,
    intentId: command.intentId,
    amount: command.amount,
    reason: command.reason,
    ...(command.approvalRequestId ? { approvalRequestId: command.approvalRequestId } : {}),
    idempotencyKey: command.idempotencyKey,
    requestHash,
  });
  return Response.json({ data: refundJson(result) }, { status: result.replayed ? 200 : 201 });
}

export async function handleImportSettlement(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  env: PaymentApiEnvironment,
): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    settlementId: optionalUuid(body, "settlementId") ?? uuidV7(),
    providerAccountId: requiredUuid(body, "providerAccountId"),
    providerSettlementId: requiredString(body, "providerSettlementId"),
    gross: parseMoney(body.gross, "gross"),
    fees: parseMoney(body.fees, "fees"),
    adjustments: parseMoney(body.adjustments, "adjustments"),
    net: parseMoney(body.net, "net"),
    settledAt: requiredString(body, "settledAt", 64),
    sourceHash: requiredString(body, "sourceHash", 128),
    idempotencyKey: key,
  };
  const requestHash = await sha256Hex(JSON.stringify({
    settlementId: command.settlementId,
    providerAccountId: command.providerAccountId,
    providerSettlementId: command.providerSettlementId,
    gross: moneyJson(command.gross),
    fees: moneyJson(command.fees),
    adjustments: moneyJson(command.adjustments),
    net: moneyJson(command.net),
    settledAt: command.settledAt,
    sourceHash: command.sourceHash,
  }));
  const result = await paymentService(env, database).importSettlement(context, { ...command, requestHash });
  return Response.json({ data: settlementJson(result) }, { status: result.replayed ? 200 : 201 });
}
