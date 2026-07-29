import type { PaginationRequestV1 } from "../../../packages/contracts/src/v1/common.js";
import type { ApiClientV1, PublicApiRequestV1 } from "./contracts.js";

const SCOPE_PATTERN = /^(?:\*|[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*(?:\.\*)?)$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,512}$/u;
const SORT_PATTERN = /^-?[a-z][a-z0-9_.-]{0,63}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} is invalid`);
  return parsed;
}

function assertScope(scope: string): void {
  if (!SCOPE_PATTERN.test(scope)) throw new TypeError(`API scope is invalid: ${scope}`);
}

export function assertApiClient(client: ApiClientV1): void {
  if (client.clientId.trim().length === 0 || client.tenantId.trim().length === 0) {
    throw new TypeError("API client identity is required");
  }
  if (client.displayName.trim().length === 0) throw new TypeError("API client display name is required");
  if (client.scopes.length === 0 || new Set(client.scopes).size !== client.scopes.length) {
    throw new TypeError("API client scopes must be non-empty and unique");
  }
  for (const scope of client.scopes) assertScope(scope);
  if (!Number.isInteger(client.rateLimitPerMinute) || client.rateLimitPerMinute < 1 || client.rateLimitPerMinute > 100_000) {
    throw new RangeError("API client rate limit must be between 1 and 100000 requests per minute");
  }
  parseTimestamp(client.createdAt, "API client createdAt");
  if (client.expiresAt !== undefined && parseTimestamp(client.expiresAt, "API client expiresAt") <= parseTimestamp(client.createdAt, "API client createdAt")) {
    throw new TypeError("API client expiry must follow creation");
  }
}

export function apiScopeGranted(grantedScopes: readonly string[], requiredScope: string): boolean {
  assertScope(requiredScope);
  for (const granted of grantedScopes) {
    assertScope(granted);
    if (granted === "*" || granted === requiredScope) return true;
    if (granted.endsWith(".*") && requiredScope.startsWith(granted.slice(0, -1))) return true;
  }
  return false;
}

export type PublicApiAuthorizationReason =
  | "allowed"
  | "tenant_mismatch"
  | "client_mismatch"
  | "client_inactive"
  | "client_expired"
  | "scope_denied"
  | "idempotency_required";

export interface PublicApiAuthorizationDecisionV1 {
  readonly allowed: boolean;
  readonly reason: PublicApiAuthorizationReason;
  readonly grantedScopes: readonly string[];
  readonly rateLimitPerMinute: number;
}

export function authorizePublicApiRequest(input: {
  readonly client: ApiClientV1;
  readonly request: PublicApiRequestV1;
  readonly requiredScopes: readonly string[];
  readonly observedAt: string;
  readonly requiresIdempotency?: boolean;
}): PublicApiAuthorizationDecisionV1 {
  assertApiClient(input.client);
  const observedAt = parseTimestamp(input.observedAt, "Public API observedAt");
  parseTimestamp(input.request.requestedAt, "Public API requestedAt");
  if (input.requiredScopes.length === 0 || new Set(input.requiredScopes).size !== input.requiredScopes.length) {
    throw new TypeError("Public API required scopes must be non-empty and unique");
  }
  for (const scope of input.requiredScopes) assertScope(scope);

  const decision = (allowed: boolean, reason: PublicApiAuthorizationReason): PublicApiAuthorizationDecisionV1 => Object.freeze({
    allowed,
    reason,
    grantedScopes: Object.freeze([...input.client.scopes]),
    rateLimitPerMinute: input.client.rateLimitPerMinute,
  });

  if (input.request.scope.tenantId !== input.client.tenantId) return decision(false, "tenant_mismatch");
  if (input.request.clientId !== input.client.clientId) return decision(false, "client_mismatch");
  if (input.client.status !== "active") return decision(false, "client_inactive");
  if (input.client.expiresAt !== undefined && observedAt >= parseTimestamp(input.client.expiresAt, "API client expiresAt")) {
    return decision(false, "client_expired");
  }
  if (!input.requiredScopes.every((scope) => apiScopeGranted(input.client.scopes, scope))) return decision(false, "scope_denied");
  if (input.requiresIdempotency === true && input.request.idempotency === undefined) return decision(false, "idempotency_required");
  return decision(true, "allowed");
}

export interface ApiRateLimitWindowV1 {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly clientId: string;
  readonly windowStart: string;
  readonly requestCount: number;
  readonly requestIds: readonly string[];
}

export interface ApiRateLimitResultV1 {
  readonly disposition: "allowed" | "duplicate" | "limited";
  readonly remaining: number;
  readonly resetAt: string;
  readonly window: ApiRateLimitWindowV1;
}

function minuteWindow(timestamp: number): { readonly start: number; readonly reset: number } {
  const start = Math.floor(timestamp / 60_000) * 60_000;
  return Object.freeze({ start, reset: start + 60_000 });
}

export function applyApiRateLimit(input: {
  readonly client: ApiClientV1;
  readonly requestId: string;
  readonly observedAt: string;
  readonly current?: ApiRateLimitWindowV1;
}): ApiRateLimitResultV1 {
  assertApiClient(input.client);
  if (input.requestId.trim().length === 0 || input.requestId.length > 200) throw new TypeError("Public API requestId is invalid");
  const observedAt = parseTimestamp(input.observedAt, "Rate limit observedAt");
  const expected = minuteWindow(observedAt);
  const expectedStart = new Date(expected.start).toISOString();

  let current = input.current;
  if (current !== undefined) {
    if (current.tenantId !== input.client.tenantId || current.clientId !== input.client.clientId) {
      throw new TypeError("Rate limit window scope does not match API client");
    }
    const currentStart = parseTimestamp(current.windowStart, "Rate limit windowStart");
    if (currentStart > expected.start) throw new TypeError("Rate limit observation precedes the current window");
    if (currentStart < expected.start) current = undefined;
  }

  if (current?.requestIds.includes(input.requestId) === true) {
    return Object.freeze({
      disposition: "duplicate",
      remaining: Math.max(0, input.client.rateLimitPerMinute - current.requestCount),
      resetAt: new Date(expected.reset).toISOString(),
      window: current,
    });
  }

  const requestCount = current?.requestCount ?? 0;
  if (requestCount >= input.client.rateLimitPerMinute) {
    const window = current ?? Object.freeze({
      schemaVersion: "1.0" as const,
      tenantId: input.client.tenantId,
      clientId: input.client.clientId,
      windowStart: expectedStart,
      requestCount: 0,
      requestIds: Object.freeze([] as string[]),
    });
    return Object.freeze({ disposition: "limited", remaining: 0, resetAt: new Date(expected.reset).toISOString(), window });
  }

  const requestIds = [...(current?.requestIds ?? []), input.requestId];
  const window: ApiRateLimitWindowV1 = Object.freeze({
    schemaVersion: "1.0",
    tenantId: input.client.tenantId,
    clientId: input.client.clientId,
    windowStart: expectedStart,
    requestCount: requestCount + 1,
    requestIds: Object.freeze(requestIds),
  });
  return Object.freeze({
    disposition: "allowed",
    remaining: input.client.rateLimitPerMinute - window.requestCount,
    resetAt: new Date(expected.reset).toISOString(),
    window,
  });
}

export interface PublicApiIdempotencyRecordV1 {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly clientId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly status: "processing" | "completed" | "failed";
  readonly responseStatus?: number;
  readonly responseBody?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export type BeginPublicApiIdempotencyResultV1 =
  | { readonly disposition: "started"; readonly record: PublicApiIdempotencyRecordV1 }
  | { readonly disposition: "replay"; readonly record: PublicApiIdempotencyRecordV1 }
  | { readonly disposition: "in_progress"; readonly record: PublicApiIdempotencyRecordV1 }
  | { readonly disposition: "failed"; readonly record: PublicApiIdempotencyRecordV1 }
  | { readonly disposition: "conflict"; readonly record: PublicApiIdempotencyRecordV1 };

function assertIdempotencyMetadata(request: PublicApiRequestV1): NonNullable<PublicApiRequestV1["idempotency"]> {
  const metadata = request.idempotency;
  if (metadata === undefined) throw new TypeError("Public API idempotency metadata is required");
  if (metadata.key.trim().length < 8 || metadata.key.length > 200) throw new TypeError("Public API idempotency key is invalid");
  if (!SHA256_PATTERN.test(metadata.requestHash)) throw new TypeError("Public API request hash must be SHA-256 hex");
  return metadata;
}

export function beginPublicApiIdempotency(input: {
  readonly request: PublicApiRequestV1;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly existing?: PublicApiIdempotencyRecordV1;
}): BeginPublicApiIdempotencyResultV1 {
  const metadata = assertIdempotencyMetadata(input.request);
  const observedAt = parseTimestamp(input.observedAt, "Idempotency observedAt");
  const expiresAt = parseTimestamp(input.expiresAt, "Idempotency expiresAt");
  if (expiresAt <= observedAt) throw new TypeError("Idempotency expiry must follow the observed time");

  const createRecord = (): PublicApiIdempotencyRecordV1 => Object.freeze({
    schemaVersion: "1.0",
    tenantId: input.request.scope.tenantId,
    clientId: input.request.clientId,
    operationId: input.request.operationId,
    idempotencyKey: metadata.key,
    requestHash: metadata.requestHash,
    status: "processing",
    createdAt: input.observedAt,
    updatedAt: input.observedAt,
    expiresAt: input.expiresAt,
  });

  const existing = input.existing;
  if (existing === undefined || observedAt >= parseTimestamp(existing.expiresAt, "Existing idempotency expiresAt")) {
    return Object.freeze({ disposition: "started", record: createRecord() });
  }
  if (existing.tenantId !== input.request.scope.tenantId
    || existing.clientId !== input.request.clientId
    || existing.operationId !== input.request.operationId
    || existing.idempotencyKey !== metadata.key) {
    throw new TypeError("Existing idempotency record scope does not match request");
  }
  if (existing.requestHash !== metadata.requestHash) return Object.freeze({ disposition: "conflict", record: existing });
  if (existing.status === "completed") return Object.freeze({ disposition: "replay", record: existing });
  if (existing.status === "failed") return Object.freeze({ disposition: "failed", record: existing });
  return Object.freeze({ disposition: "in_progress", record: existing });
}

export function completePublicApiIdempotency(input: {
  readonly record: PublicApiIdempotencyRecordV1;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly observedAt: string;
}): PublicApiIdempotencyRecordV1 {
  if (input.record.status !== "processing") throw new TypeError("Only processing idempotency records can complete");
  if (!Number.isInteger(input.responseStatus) || input.responseStatus < 200 || input.responseStatus > 599) {
    throw new RangeError("Public API response status is invalid");
  }
  const observedAt = parseTimestamp(input.observedAt, "Idempotency completion observedAt");
  if (observedAt < parseTimestamp(input.record.createdAt, "Idempotency createdAt")) {
    throw new TypeError("Idempotency completion precedes creation");
  }
  return Object.freeze({
    ...input.record,
    status: input.responseStatus < 500 ? "completed" : "failed",
    responseStatus: input.responseStatus,
    responseBody: input.responseBody,
    updatedAt: input.observedAt,
  });
}

export function normalizePublicApiPagination(input: PaginationRequestV1 | undefined, maximumLimit = 200): PaginationRequestV1 {
  if (!Number.isInteger(maximumLimit) || maximumLimit < 1 || maximumLimit > 1_000) {
    throw new RangeError("Public API maximum pagination limit must be between 1 and 1000");
  }
  const limit = input?.limit ?? Math.min(50, maximumLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new RangeError(`Public API pagination limit must be between 1 and ${maximumLimit}`);
  }
  if (input?.cursor !== undefined && !CURSOR_PATTERN.test(input.cursor)) throw new TypeError("Public API cursor is invalid");
  const sort = input?.sort ?? [];
  if (sort.length > 5 || new Set(sort).size !== sort.length || sort.some((field) => !SORT_PATTERN.test(field))) {
    throw new TypeError("Public API sort fields are invalid");
  }
  return Object.freeze({
    limit,
    ...(input?.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(sort.length === 0 ? {} : { sort: Object.freeze([...sort]) }),
  });
}
