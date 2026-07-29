import { sha256Hex } from "../../../packages/foundation/src/crypto.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { assertUuid } from "../../../packages/foundation/src/ids.js";
import { money, type Money } from "../../../packages/foundation/src/money.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(record: Record<string, unknown>, field: string, maximum = 256): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  }
  return value.trim();
}

export function optionalString(record: Record<string, unknown>, field: string, maximum = 256): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is invalid`, 400);
  }
  return value.trim();
}

export function requiredUuid(record: Record<string, unknown>, field: string): string {
  try {
    return assertUuid(requiredString(record, field, 64), field);
  } catch {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be a UUID`, 400);
  }
}

export function optionalUuid(record: Record<string, unknown>, field: string): string | undefined {
  const value = optionalString(record, field, 64);
  if (!value) return undefined;
  try {
    return assertUuid(value, field);
  } catch {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be a UUID`, 400);
  }
}

export function pathUuid(value: string, field: string): string {
  try {
    return assertUuid(value, field);
  } catch {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be a UUID`, 400);
  }
}

export function parseMoney(value: unknown, field = "amount"): Money {
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  const amountMinor = value.amountMinor;
  const currency = value.currency;
  const scale = value.scale;
  if (typeof amountMinor !== "string" || !/^-?\d+$/u.test(amountMinor)) {
    throw new PlatformError("VALIDATION_FAILED", `${field}.amountMinor must be an integer string`, 400);
  }
  if (typeof currency !== "string") throw new PlatformError("VALIDATION_FAILED", `${field}.currency is required`, 400);
  if (!Number.isInteger(scale)) throw new PlatformError("VALIDATION_FAILED", `${field}.scale must be an integer`, 400);
  try {
    return money(BigInt(amountMinor), currency, scale as number);
  } catch (error) {
    throw new PlatformError("VALIDATION_FAILED", error instanceof Error ? error.message : `${field} is invalid`, 400);
  }
}

export function requiredIntegerString(record: Record<string, unknown>, field: string): bigint {
  const value = requiredString(record, field, 128);
  if (!/^-?\d+$/u.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an integer string`, 400);
  return BigInt(value);
}

export function optionalInteger(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an integer`, 400);
  return value as number;
}

export function requiredInteger(record: Record<string, unknown>, field: string): number {
  const value = optionalInteger(record, field);
  if (value === undefined) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return value;
}

export function requiredRecord(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an object`, 400);
  return value;
}

export function optionalRecord(record: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an object`, 400);
  return value;
}

export function requiredArray(record: Record<string, unknown>, field: string): readonly unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an array`, 400);
  return value;
}

export function requiredEnum<const Values extends readonly string[]>(record: Record<string, unknown>, field: string, values: Values): Values[number] {
  const value = requiredString(record, field, 80);
  if (!values.includes(value)) throw new PlatformError("VALIDATION_FAILED", `${field} is invalid`, 400);
  return value as Values[number];
}

export function optionalEnum<const Values extends readonly string[]>(record: Record<string, unknown>, field: string, values: Values): Values[number] | undefined {
  const value = optionalString(record, field, 80);
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new PlatformError("VALIDATION_FAILED", `${field} is invalid`, 400);
  return value as Values[number];
}

export async function bodyRecord(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) throw new PlatformError("VALIDATION_FAILED", "Request body must be an object", 400);
  return body;
}

export function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw new PlatformError("VALIDATION_FAILED", "idempotency-key header is required", 400);
  }
  return value;
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export async function requestHash(value: unknown): Promise<string> {
  return await sha256Hex(JSON.stringify(jsonSafe(value)));
}

export function dataResponse(value: unknown, status = 200): Response {
  return Response.json({ data: jsonSafe(value) }, { status });
}
