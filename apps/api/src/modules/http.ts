import type { RequestContext } from "../../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../../packages/foundation/src/errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new PlatformError("PERMISSION_DENIED", `Permission ${permission} is required`, 403);
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be a UUID`, 400);
  return value;
}

export function requireString(value: unknown, field: string, maximumLength = 500): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return value.trim();
}

export function optionalString(value: unknown, field: string, maximumLength = 500): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, maximumLength);
}

export function requireInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new PlatformError("VALIDATION_FAILED", `${field} must be an integer between ${minimum} and ${maximum}`, 400);
  return value;
}

export function requireArray(value: unknown, field: string, maximumLength = 1000): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumLength) throw new PlatformError("VALIDATION_FAILED", `${field} must contain 1 to ${maximumLength} items`, 400);
  return value;
}

export function requireRecord(value: unknown, field = "request body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an object`, 400);
  return value as Record<string, unknown>;
}

export async function jsonBody(request: Request, maximumBytes = 1_000_000): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) throw new PlatformError("VALIDATION_FAILED", "Request body is too large", 413);
  const text = await request.text();
  if (text.length > maximumBytes) throw new PlatformError("VALIDATION_FAILED", "Request body is too large", 413);
  try { return requireRecord(JSON.parse(text)); }
  catch (error) { if (error instanceof PlatformError) throw error; throw new PlatformError("VALIDATION_FAILED", "Request body must be valid JSON", 400); }
}

export function boundedLimit(url: URL, fallback = 100): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 500) throw new PlatformError("VALIDATION_FAILED", "limit must be between 1 and 500", 400);
  return value;
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
  return new Response(body, { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers ?? {}) } });
}
