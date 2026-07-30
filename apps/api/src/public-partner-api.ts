import type { ApiClientV1, PublicApiRequestV1 } from "../../../modules/integrations/src/contracts.js";
import type { ApiClientCredentialBindingV1, ApiCredentialVerificationPort } from "../../../modules/integrations/src/credentials.js";
import { verifyApiClientCredential } from "../../../modules/integrations/src/credentials.js";
import { authorizePublicApiRequest, normalizePublicApiPagination } from "../../../modules/integrations/src/public-api.js";
import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase, TransactionClient } from "../../../packages/foundation/src/db.js";
import { assertUuid, uuidV7 } from "../../../packages/foundation/src/ids.js";

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CURSOR_PATTERN = /^[a-f0-9]{32}$/u;
const EXPORT_FORMATS = new Set(["csv", "xlsx", "pdf", "json"]);

export interface PublicApiRateLimitPort {
  consume(input: {
    readonly tenantId: string;
    readonly clientId: string;
    readonly requestId: string;
    readonly limitPerMinute: number;
    readonly observedAt: string;
  }): Promise<{
    readonly disposition: "allowed" | "duplicate" | "limited";
    readonly remaining: number;
    readonly resetAt: string;
  }>;
}

export interface PublicPartnerApiBindings {
  readonly PUBLIC_API_CREDENTIAL_VERIFIER?: ApiCredentialVerificationPort;
  readonly PUBLIC_API_RATE_LIMITER?: PublicApiRateLimitPort;
}

interface ApiClientDirectoryRow extends Record<string, unknown> {
  readonly client_id: string;
  readonly tenant_id: string;
  readonly service_user_id: string;
  readonly display_name: string;
  readonly authentication: ApiClientV1["authentication"];
  readonly scopes: readonly string[];
  readonly status: ApiClientV1["status"];
  readonly rate_limit_per_minute: number;
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly credential_reference: string;
  readonly credential_version: number;
  readonly credential_valid_from: string;
}

interface PublicApiSession {
  readonly client: ApiClientV1;
  readonly context: RequestContext;
  readonly observedAt: string;
  readonly presentedAuthentication: ApiClientV1["authentication"];
  readonly rateLimit: {
    readonly limit: number;
    readonly remaining: number;
    readonly resetAt: string;
  };
}

function problem(status: number, code: string, message: string, requestId: string, headers: HeadersInit = {}): Response {
  return Response.json({ error: { code, message, requestId } }, {
    status,
    headers: { "content-type": "application/problem+json", "x-content-type-options": "nosniff", ...headers },
  });
}

function asRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function asRequiredString(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) throw new TypeError(`${field} is invalid`);
  return value.trim();
}

function asOptionalString(value: unknown, field: string, maximum = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asRequiredString(value, field, maximum);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeCursor(id: string): string {
  return assertUuid(id, "cursor id").replaceAll("-", "");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!CURSOR_PATTERN.test(cursor)) throw new TypeError("Public API cursor is invalid");
  return `${cursor.slice(0, 8)}-${cursor.slice(8, 12)}-${cursor.slice(12, 16)}-${cursor.slice(16, 20)}-${cursor.slice(20)}`;
}

function rateHeaders(session: PublicApiSession): HeadersInit {
  return {
    "x-request-id": session.context.requestId,
    "x-ratelimit-limit": String(session.rateLimit.limit),
    "x-ratelimit-remaining": String(session.rateLimit.remaining),
    "x-ratelimit-reset": session.rateLimit.resetAt,
    "x-api-version": "1.0.0",
  };
}

function dataResponse(session: PublicApiSession, data: unknown, status = 200): Response {
  return Response.json({ data }, { status, headers: rateHeaders(session) });
}

function parsePresentedCredential(request: Request): {
  readonly authentication: ApiClientV1["authentication"];
  readonly credential: string;
} {
  const apiKey = request.headers.get("x-api-key")?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  if (apiKey && authorization) throw new TypeError("Use exactly one public API authentication method");
  if (apiKey) return { authentication: "api_key", credential: apiKey };
  if (authorization?.startsWith("Bearer ")) {
    const credential = authorization.slice(7).trim();
    if (credential.length === 0) throw new TypeError("Bearer credential is missing");
    return { authentication: "oauth2_client_credentials", credential };
  }
  throw new TypeError("Public API credential is required");
}

async function authenticatePublicClient(input: {
  readonly request: Request;
  readonly database: NeonDatabase;
  readonly bindings: PublicPartnerApiBindings;
  readonly requestId: string;
  readonly region: string;
}): Promise<PublicApiSession | Response> {
  const tenantId = assertUuid(asRequiredString(input.request.headers.get("x-tenant-id"), "x-tenant-id"), "x-tenant-id");
  const clientId = assertUuid(asRequiredString(input.request.headers.get("x-client-id"), "x-client-id"), "x-client-id");
  const presented = parsePresentedCredential(input.request);
  if (!input.bindings.PUBLIC_API_CREDENTIAL_VERIFIER || !input.bindings.PUBLIC_API_RATE_LIMITER) {
    return problem(503, "PUBLIC_API_UNAVAILABLE", "Public API authentication services are unavailable", input.requestId);
  }

  const rows = await input.database.httpQuery<ApiClientDirectoryRow>(
    "SELECT * FROM integration.resolve_api_client_authentication($1::uuid,$2::uuid,$3::text)",
    [tenantId, clientId, presented.authentication],
  );
  const row = rows[0];
  if (!row) return problem(401, "INVALID_CLIENT", "Public API authentication failed", input.requestId);

  const client: ApiClientV1 = Object.freeze({
    schemaVersion: "1.0",
    clientId: String(row.client_id),
    tenantId: String(row.tenant_id),
    displayName: String(row.display_name),
    authentication: row.authentication,
    scopes: Object.freeze([...row.scopes]),
    status: row.status,
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.expires_at === null ? {} : { expiresAt: new Date(row.expires_at).toISOString() }),
  });
  const binding: ApiClientCredentialBindingV1 = Object.freeze({
    schemaVersion: "1.0",
    bindingId: `${client.clientId}:${String(row.credential_version)}`,
    tenantId: client.tenantId,
    clientId: client.clientId,
    authentication: client.authentication,
    credentialReference: String(row.credential_reference),
    credentialVersion: Number(row.credential_version),
    status: row.revoked_at === null ? "active" : "revoked",
    validFrom: new Date(row.credential_valid_from).toISOString(),
    ...(row.revoked_at === null ? {} : { validUntil: new Date(row.revoked_at).toISOString() }),
  });
  const observedAt = new Date().toISOString();
  const credentialDecision = await verifyApiClientCredential({
    client,
    binding,
    tenantId,
    clientId,
    authentication: presented.authentication,
    presentedCredential: presented.credential,
    observedAt,
    verifier: input.bindings.PUBLIC_API_CREDENTIAL_VERIFIER,
  });
  if (!credentialDecision.verified) return problem(401, "INVALID_CLIENT", "Public API authentication failed", input.requestId);

  const rateLimit = await input.bindings.PUBLIC_API_RATE_LIMITER.consume({
    tenantId,
    clientId,
    requestId: input.requestId,
    limitPerMinute: client.rateLimitPerMinute,
    observedAt,
  });
  if (rateLimit.disposition === "limited") {
    return problem(429, "RATE_LIMITED", "Public API rate limit exceeded", input.requestId, {
      "retry-after": String(Math.max(1, Math.ceil((Date.parse(rateLimit.resetAt) - Date.parse(observedAt)) / 1000))),
      "x-ratelimit-limit": String(client.rateLimitPerMinute),
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": rateLimit.resetAt,
    });
  }

  const businessDate = input.request.headers.get("x-business-date")?.trim() ?? observedAt.slice(0, 10);
  if (!BUSINESS_DATE_PATTERN.test(businessDate)) throw new TypeError("x-business-date is invalid");
  const locale = input.request.headers.get("accept-language")?.split(",")[0]?.trim() || "en-GB";
  const timeZone = input.request.headers.get("x-time-zone")?.trim() || "UTC";
  const traceId = input.request.headers.get("traceparent")?.trim() || input.requestId;
  const context: RequestContext = Object.freeze({
    requestId: input.requestId as RequestContext["requestId"],
    traceId,
    tenantId: tenantId as RequestContext["tenantId"],
    actorId: assertUuid(String(row.service_user_id), "service_user_id") as RequestContext["actorId"],
    locale: locale as RequestContext["locale"],
    timeZone: timeZone as RequestContext["timeZone"],
    businessDate: businessDate as RequestContext["businessDate"],
    region: input.region,
    permissions: new Set<string>(),
  });
  return Object.freeze({
    client,
    context,
    observedAt,
    presentedAuthentication: presented.authentication,
    rateLimit: Object.freeze({ limit: client.rateLimitPerMinute, remaining: rateLimit.remaining, resetAt: rateLimit.resetAt }),
  });
}

async function authorizeOperation(input: {
  readonly session: PublicApiSession;
  readonly operationId: string;
  readonly requiredScopes: readonly string[];
  readonly body: unknown;
  readonly idempotencyKey?: string;
}): Promise<PublicApiRequestV1> {
  const requestHash = await sha256(input.body);
  const request: PublicApiRequestV1 = Object.freeze({
    schemaVersion: "1.0",
    scope: Object.freeze({
      tenantId: input.session.context.tenantId,
      actorId: input.session.context.actorId,
      locale: input.session.context.locale,
      timeZone: input.session.context.timeZone,
      businessDate: input.session.context.businessDate,
    }),
    clientId: input.session.client.clientId,
    operationId: input.operationId,
    body: input.body,
    requestedAt: input.session.observedAt,
    ...(input.idempotencyKey === undefined ? {} : {
      idempotency: Object.freeze({ key: input.idempotencyKey, requestHash, replayed: false }),
    }),
  });
  const decision = authorizePublicApiRequest({
    client: input.session.client,
    request,
    requiredScopes: input.requiredScopes,
    observedAt: input.session.observedAt,
    requiresIdempotency: input.idempotencyKey !== undefined,
  });
  if (!decision.allowed) throw new Error(decision.reason === "scope_denied" ? "PUBLIC_API_SCOPE_DENIED" : "PUBLIC_API_AUTHORIZATION_DENIED");
  return request;
}

async function listMetrics(session: PublicApiSession, url: URL, client: TransactionClient): Promise<Response> {
  const limitValue = url.searchParams.get("limit");
  const pagination = normalizePublicApiPagination({
    limit: limitValue === null ? 50 : Number(limitValue),
    ...(url.searchParams.get("cursor") === null ? {} : { cursor: url.searchParams.get("cursor")! }),
  });
  await authorizeOperation({ session, operationId: "reporting.metrics.list", requiredScopes: ["reporting.metrics.read"], body: {} });
  const cursorId = decodeCursor(pagination.cursor);
  const result = await client.query<Record<string, unknown>>(
    `SELECT id, metric_id, version, owner_module, display_name, description, value_kind,
            supported_dimensions, control_total_metric_id, freshness_seconds, effective_from
       FROM reporting.metric_definitions
      WHERE status = 'active'
        AND effective_from <= $1::timestamptz
        AND (effective_to IS NULL OR effective_to > $1::timestamptz)
        AND ($2::uuid IS NULL OR id > $2::uuid)
      ORDER BY id
      LIMIT $3`,
    [session.observedAt, cursorId ?? null, pagination.limit + 1],
  );
  const hasMore = result.rows.length > pagination.limit;
  const rows = result.rows.slice(0, pagination.limit);
  const items = rows.map((row) => Object.freeze({
    metricId: String(row.metric_id),
    version: String(row.version),
    ownerModule: String(row.owner_module),
    displayName: String(row.display_name),
    description: String(row.description),
    valueKind: String(row.value_kind),
    supportedDimensions: Object.freeze([...(row.supported_dimensions as readonly string[])]),
    controlTotalMetricId: row.control_total_metric_id === null ? undefined : String(row.control_total_metric_id),
    defaultFreshnessSeconds: Number(row.freshness_seconds),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
  }));
  const last = rows.at(-1);
  return dataResponse(session, Object.freeze({
    items: Object.freeze(items),
    ...(hasMore && last ? { nextCursor: encodeCursor(String(last.id)) } : {}),
  }));
}

async function queryMetric(session: PublicApiSession, request: Request, client: TransactionClient): Promise<Response> {
  const body = asRecord(await request.json(), "metric query");
  const metricId = asRequiredString(body.metricId, "metricId");
  const metricVersion = asOptionalString(body.metricVersion, "metricVersion");
  const periodStart = new Date(asRequiredString(body.periodStart, "periodStart")).toISOString();
  const periodEnd = new Date(asRequiredString(body.periodEnd, "periodEnd")).toISOString();
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) throw new TypeError("periodEnd must follow periodStart");
  const dimensions = body.dimensions === undefined ? {} : asRecord(body.dimensions, "dimensions");
  await authorizeOperation({ session, operationId: "reporting.metrics.query", requiredScopes: ["reporting.metrics.read"], body });
  const result = await client.query<Record<string, unknown>>(
    `SELECT definition.metric_id, definition.version, snapshot.amount, snapshot.scale, snapshot.unit,
            snapshot.currency, snapshot.source_count, snapshot.source_cursor,
            snapshot.freshness_observed_at, snapshot.freshness_seconds, snapshot.health,
            reconciliation.control_amount, reconciliation.difference_amount, reconciliation.reconciled,
            reconciliation.checked_at
       FROM reporting.metric_definitions AS definition
       JOIN reporting.metric_snapshots AS snapshot
         ON snapshot.tenant_id = definition.tenant_id AND snapshot.metric_definition_id = definition.id
       LEFT JOIN reporting.projection_reconciliations AS reconciliation
         ON reconciliation.tenant_id = snapshot.tenant_id AND reconciliation.metric_snapshot_id = snapshot.id
      WHERE definition.metric_id = $1
        AND ($2::text IS NULL OR definition.version = $2)
        AND snapshot.period_start = $3::timestamptz
        AND snapshot.period_end = $4::timestamptz
        AND snapshot.dimensions = $5::jsonb
      ORDER BY snapshot.generated_at DESC
      LIMIT 1`,
    [metricId, metricVersion ?? null, periodStart, periodEnd, JSON.stringify(dimensions)],
  );
  const row = result.rows[0];
  if (!row) return problem(404, "METRIC_RESULT_NOT_FOUND", "No metric result matches the requested period and dimensions", session.context.requestId, rateHeaders(session));
  return dataResponse(session, Object.freeze({
    schemaVersion: "1.0",
    metricId: String(row.metric_id),
    metricVersion: String(row.version),
    periodStart,
    periodEnd,
    dimensions,
    value: Object.freeze({ amount: String(row.amount), scale: Number(row.scale), unit: String(row.unit), ...(row.currency === null ? {} : { currency: String(row.currency) }) }),
    sourceCount: String(row.source_count),
    sourceCursor: String(row.source_cursor),
    freshnessObservedAt: new Date(String(row.freshness_observed_at)).toISOString(),
    freshnessSeconds: Number(row.freshness_seconds),
    health: String(row.health),
    reconciliation: row.control_amount === null ? undefined : Object.freeze({
      controlAmount: String(row.control_amount),
      differenceAmount: String(row.difference_amount),
      reconciled: Boolean(row.reconciled),
      checkedAt: new Date(String(row.checked_at)).toISOString(),
    }),
  }));
}

async function requestExport(session: PublicApiSession, request: Request, client: TransactionClient): Promise<Response> {
  const body = asRecord(await request.json(), "export request");
  const reportId = asRequiredString(body.reportId, "reportId");
  const format = asRequiredString(body.format, "format");
  if (!EXPORT_FORMATS.has(format)) throw new TypeError("format is invalid");
  const parameters = body.parameters === undefined ? {} : asRecord(body.parameters, "parameters");
  const idempotencyKey = asRequiredString(request.headers.get("idempotency-key"), "idempotency-key");
  const publicRequest = await authorizeOperation({
    session,
    operationId: "reporting.exports.create",
    requiredScopes: ["reporting.exports.write"],
    body,
    idempotencyKey,
  });
  const exportId = uuidV7();
  const expiresAt = new Date(Date.parse(session.observedAt) + 24 * 60 * 60 * 1000).toISOString();
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM reporting.request_export(
       $1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::text,$7::text,$8::uuid,
       $9::timestamptz,$10::timestamptz,$11::text,$12::text,$13::date
     )`,
    [exportId, session.context.tenantId, reportId, format, JSON.stringify(parameters), idempotencyKey,
      publicRequest.idempotency!.requestHash, session.context.actorId, session.observedAt, expiresAt,
      session.context.requestId, session.context.traceId, session.context.businessDate],
  );
  const row = result.rows[0];
  return dataResponse(session, Object.freeze({
    exportId: String(row?.export_id ?? exportId),
    status: "queued",
    replayed: Boolean(row?.replayed),
    expiresAt,
  }), Boolean(row?.replayed) ? 200 : 202);
}

async function getExport(session: PublicApiSession, exportId: string, client: TransactionClient): Promise<Response> {
  await authorizeOperation({ session, operationId: "reporting.exports.get", requiredScopes: ["reporting.exports.read"], body: { exportId } });
  const result = await client.query<Record<string, unknown>>(
    `SELECT id, report_id, format, parameters, status, content_hash, row_count,
            requested_at, completed_at, expires_at
       FROM reporting.export_requests
      WHERE id = $1::uuid`,
    [assertUuid(exportId, "exportId")],
  );
  const row = result.rows[0];
  if (!row) return problem(404, "EXPORT_NOT_FOUND", "Export request was not found", session.context.requestId, rateHeaders(session));
  return dataResponse(session, Object.freeze({
    exportId: String(row.id),
    reportId: String(row.report_id),
    format: String(row.format),
    parameters: row.parameters,
    status: String(row.status),
    contentHash: row.content_hash === null ? undefined : String(row.content_hash),
    rowCount: row.row_count === null ? undefined : String(row.row_count),
    requestedAt: new Date(String(row.requested_at)).toISOString(),
    completedAt: row.completed_at === null ? undefined : new Date(String(row.completed_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  }));
}

async function listWebhookDeliveries(session: PublicApiSession, url: URL, client: TransactionClient): Promise<Response> {
  const limitValue = url.searchParams.get("limit");
  const pagination = normalizePublicApiPagination({
    limit: limitValue === null ? 50 : Number(limitValue),
    ...(url.searchParams.get("cursor") === null ? {} : { cursor: url.searchParams.get("cursor")! }),
  });
  await authorizeOperation({ session, operationId: "integration.webhookDeliveries.list", requiredScopes: ["integration.webhook.read"], body: {} });
  const cursorId = decodeCursor(pagination.cursor);
  const result = await client.query<Record<string, unknown>>(
    `SELECT id, subscription_id, source_event_id, source_event_type, status, attempt_count,
            next_attempt_at, delivered_at, last_response_code, last_error_category, created_at
       FROM integration.webhook_deliveries
      WHERE ($1::uuid IS NULL OR id > $1::uuid)
      ORDER BY id
      LIMIT $2`,
    [cursorId ?? null, pagination.limit + 1],
  );
  const hasMore = result.rows.length > pagination.limit;
  const rows = result.rows.slice(0, pagination.limit);
  const items = rows.map((row) => Object.freeze({
    deliveryId: String(row.id),
    subscriptionId: String(row.subscription_id),
    sourceEventId: String(row.source_event_id),
    sourceEventType: String(row.source_event_type),
    status: String(row.status),
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at === null ? undefined : new Date(String(row.next_attempt_at)).toISOString(),
    deliveredAt: row.delivered_at === null ? undefined : new Date(String(row.delivered_at)).toISOString(),
    lastResponseCode: row.last_response_code === null ? undefined : Number(row.last_response_code),
    lastErrorCategory: row.last_error_category === null ? undefined : String(row.last_error_category),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
  const last = rows.at(-1);
  return dataResponse(session, Object.freeze({
    items: Object.freeze(items),
    ...(hasMore && last ? { nextCursor: encodeCursor(String(last.id)) } : {}),
  }));
}

async function requestWebhookReplay(session: PublicApiSession, request: Request, deliveryId: string, client: TransactionClient): Promise<Response> {
  const body = asRecord(await request.json(), "webhook replay request");
  const reason = asRequiredString(body.reason, "reason", 500);
  const idempotencyKey = asRequiredString(request.headers.get("idempotency-key"), "idempotency-key");
  const publicRequest = await authorizeOperation({
    session,
    operationId: "integration.webhookDeliveries.replay",
    requiredScopes: ["integration.webhook.manage"],
    body: { deliveryId, reason },
    idempotencyKey,
  });
  const replayId = uuidV7();
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM integration.request_webhook_replay(
       $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::uuid,
       $8::timestamptz,$9::text,$10::text,$11::date
     )`,
    [replayId, session.context.tenantId, assertUuid(deliveryId, "deliveryId"), idempotencyKey,
      publicRequest.idempotency!.requestHash, reason, session.context.actorId, session.observedAt,
      session.context.requestId, session.context.traceId, session.context.businessDate],
  );
  const row = result.rows[0];
  return dataResponse(session, Object.freeze({
    replayId: String(row?.replay_id ?? replayId),
    deliveryId,
    replayed: Boolean(row?.replayed),
    status: "queued",
  }), Boolean(row?.replayed) ? 200 : 202);
}

export async function handlePublicPartnerApi(input: {
  readonly request: Request;
  readonly url: URL;
  readonly database: NeonDatabase;
  readonly bindings: PublicPartnerApiBindings;
  readonly requestId: string;
  readonly region: string;
}): Promise<Response | undefined> {
  if (!input.url.pathname.startsWith("/public/v1/")) return undefined;
  const routeMatches = input.url.pathname === "/public/v1/reporting/metrics"
    || input.url.pathname === "/public/v1/reporting/queries"
    || input.url.pathname === "/public/v1/reporting/exports"
    || /^\/public\/v1\/reporting\/exports\/[^/]+$/u.test(input.url.pathname)
    || input.url.pathname === "/public/v1/integrations/webhook-deliveries"
    || /^\/public\/v1\/integrations\/webhook-deliveries\/[^/]+\/replay$/u.test(input.url.pathname);
  if (!routeMatches) return undefined;

  try {
    const authenticated = await authenticatePublicClient({
      request: input.request,
      database: input.database,
      bindings: input.bindings,
      requestId: input.requestId,
      region: input.region,
    });
    if (authenticated instanceof Response) return authenticated;
    const session = authenticated;
    return await input.database.withClientTransaction(session.context, async (client) => {
      if (input.request.method === "GET" && input.url.pathname === "/public/v1/reporting/metrics") {
        return await listMetrics(session, input.url, client);
      }
      if (input.request.method === "POST" && input.url.pathname === "/public/v1/reporting/queries") {
        return await queryMetric(session, input.request, client);
      }
      if (input.request.method === "POST" && input.url.pathname === "/public/v1/reporting/exports") {
        return await requestExport(session, input.request, client);
      }
      const exportMatch = input.url.pathname.match(/^\/public\/v1\/reporting\/exports\/([^/]+)$/u);
      if (input.request.method === "GET" && exportMatch?.[1]) return await getExport(session, exportMatch[1], client);
      if (input.request.method === "GET" && input.url.pathname === "/public/v1/integrations/webhook-deliveries") {
        return await listWebhookDeliveries(session, input.url, client);
      }
      const replayMatch = input.url.pathname.match(/^\/public\/v1\/integrations\/webhook-deliveries\/([^/]+)\/replay$/u);
      if (input.request.method === "POST" && replayMatch?.[1]) return await requestWebhookReplay(session, input.request, replayMatch[1], client);
      return problem(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this public API route", input.requestId, rateHeaders(session));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PUBLIC_API_SCOPE_DENIED") {
      return problem(403, "SCOPE_DENIED", "API client scope does not allow this operation", input.requestId);
    }
    if (error instanceof Error && error.message === "PUBLIC_API_AUTHORIZATION_DENIED") {
      return problem(401, "INVALID_CLIENT", "Public API authorization failed", input.requestId);
    }
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
      return problem(400, "INVALID_REQUEST", error.message, input.requestId);
    }
    throw error;
  }
}
