const PUBLIC_API_VERSION = "1.0.0";

const PUBLIC_SECURITY = Object.freeze([
  Object.freeze({ ApiKeyAuth: Object.freeze([]) }),
  Object.freeze({ OAuth2ClientCredentials: Object.freeze([]) }),
]);

const PUBLIC_HEADERS = Object.freeze([
  Object.freeze({ $ref: "#/components/parameters/TenantId" }),
  Object.freeze({ $ref: "#/components/parameters/ClientId" }),
  Object.freeze({ $ref: "#/components/parameters/RequestId" }),
  Object.freeze({ $ref: "#/components/parameters/BusinessDate" }),
  Object.freeze({ $ref: "#/components/parameters/TimeZone" }),
]);

const STANDARD_RESPONSES = Object.freeze({
  "400": Object.freeze({ description: "Invalid request", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
  "401": Object.freeze({ description: "Invalid or unavailable client credential", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
  "403": Object.freeze({ description: "Required client scope is not granted", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
  "429": Object.freeze({ description: "Per-client rate limit exceeded", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
  "503": Object.freeze({ description: "Credential or rate-limit service unavailable", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
});

function jsonResponse(description: string, schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    description,
    headers: Object.freeze({
      "x-request-id": Object.freeze({ $ref: "#/components/headers/RequestId" }),
      "x-ratelimit-limit": Object.freeze({ $ref: "#/components/headers/RateLimitLimit" }),
      "x-ratelimit-remaining": Object.freeze({ $ref: "#/components/headers/RateLimitRemaining" }),
      "x-ratelimit-reset": Object.freeze({ $ref: "#/components/headers/RateLimitReset" }),
    }),
    content: Object.freeze({ "application/json": Object.freeze({ schema }) }),
  });
}

export const publicApiOpenApiDocument = Object.freeze({
  openapi: "3.1.0",
  info: Object.freeze({
    title: "Ozzyl Store Operating System Public API",
    version: PUBLIC_API_VERSION,
    description: "Contract-first partner API. Tenant business endpoints require an active API client, explicit scopes, bounded rate limits and idempotency for mutations.",
  }),
  tags: Object.freeze([
    Object.freeze({ name: "Discovery", description: "Unauthenticated API metadata and capabilities." }),
    Object.freeze({ name: "Reporting", description: "Versioned metric definitions, reconciled results and asynchronous exports." }),
    Object.freeze({ name: "Webhooks", description: "Tenant-scoped delivery health and controlled dead-letter replay." }),
  ]),
  paths: Object.freeze({
    "/public/v1/openapi.json": Object.freeze({
      get: Object.freeze({
        tags: Object.freeze(["Discovery"]),
        operationId: "getPublicApiOpenApiDocument",
        summary: "Get the public API OpenAPI document",
        responses: Object.freeze({
          "200": Object.freeze({
            description: "OpenAPI 3.1 document",
            headers: Object.freeze({ "x-api-version": Object.freeze({ schema: Object.freeze({ type: "string" }) }) }),
            content: Object.freeze({ "application/json": Object.freeze({ schema: Object.freeze({ type: "object" }) }) }),
          }),
        }),
      }),
    }),
    "/public/v1/capabilities": Object.freeze({
      get: Object.freeze({
        tags: Object.freeze(["Discovery"]),
        operationId: "getPublicApiCapabilities",
        summary: "Get supported partner API conventions",
        responses: Object.freeze({ "200": jsonResponse("Public API capability metadata", Object.freeze({ $ref: "#/components/schemas/PublicApiCapabilities" })) }),
      }),
    }),
    "/public/v1/reporting/metrics": Object.freeze({
      get: Object.freeze({
        tags: Object.freeze(["Reporting"]),
        operationId: "listMetricDefinitions",
        summary: "List active versioned metric definitions",
        description: "Requires scope reporting.metrics.read.",
        security: PUBLIC_SECURITY,
        parameters: Object.freeze([...PUBLIC_HEADERS, Object.freeze({ $ref: "#/components/parameters/Cursor" }), Object.freeze({ $ref: "#/components/parameters/Limit" })]),
        responses: Object.freeze({ "200": jsonResponse("Metric definition page", Object.freeze({ $ref: "#/components/schemas/MetricDefinitionPage" })), ...STANDARD_RESPONSES }),
      }),
    }),
    "/public/v1/reporting/queries": Object.freeze({
      post: Object.freeze({
        tags: Object.freeze(["Reporting"]),
        operationId: "queryMetricResult",
        summary: "Read one reconciled metric result",
        description: "Requires scope reporting.metrics.read. Query identity includes period and dimensions.",
        security: PUBLIC_SECURITY,
        parameters: PUBLIC_HEADERS,
        requestBody: Object.freeze({ required: true, content: Object.freeze({ "application/json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/MetricQueryRequest" }) }) }) }),
        responses: Object.freeze({
          "200": jsonResponse("Metric result with freshness and reconciliation provenance", Object.freeze({ $ref: "#/components/schemas/MetricQueryResponse" })),
          "404": Object.freeze({ description: "Metric result not found", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
          ...STANDARD_RESPONSES,
        }),
      }),
    }),
    "/public/v1/reporting/exports": Object.freeze({
      post: Object.freeze({
        tags: Object.freeze(["Reporting"]),
        operationId: "createReportingExport",
        summary: "Request an asynchronous export",
        description: "Requires scope reporting.exports.write and an idempotency-key header.",
        security: PUBLIC_SECURITY,
        parameters: Object.freeze([...PUBLIC_HEADERS, Object.freeze({ $ref: "#/components/parameters/IdempotencyKey" })]),
        requestBody: Object.freeze({ required: true, content: Object.freeze({ "application/json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/ExportCreateRequest" }) }) }) }),
        responses: Object.freeze({
          "200": jsonResponse("Idempotent replay of an existing export request", Object.freeze({ $ref: "#/components/schemas/ExportCreateResponse" })),
          "202": jsonResponse("Export request accepted", Object.freeze({ $ref: "#/components/schemas/ExportCreateResponse" })),
          ...STANDARD_RESPONSES,
        }),
      }),
    }),
    "/public/v1/reporting/exports/{exportId}": Object.freeze({
      get: Object.freeze({
        tags: Object.freeze(["Reporting"]),
        operationId: "getReportingExport",
        summary: "Get asynchronous export status",
        description: "Requires scope reporting.exports.read.",
        security: PUBLIC_SECURITY,
        parameters: Object.freeze([...PUBLIC_HEADERS, Object.freeze({ name: "exportId", in: "path", required: true, schema: Object.freeze({ type: "string", format: "uuid" }) })]),
        responses: Object.freeze({
          "200": jsonResponse("Export request status", Object.freeze({ $ref: "#/components/schemas/ExportStatusResponse" })),
          "404": Object.freeze({ description: "Export not found", content: Object.freeze({ "application/problem+json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/Problem" }) }) }) }),
          ...STANDARD_RESPONSES,
        }),
      }),
    }),
    "/public/v1/integrations/webhook-deliveries": Object.freeze({
      get: Object.freeze({
        tags: Object.freeze(["Webhooks"]),
        operationId: "listWebhookDeliveries",
        summary: "List tenant webhook delivery health",
        description: "Requires scope integration.webhook.read. Payload and signing material are never returned.",
        security: PUBLIC_SECURITY,
        parameters: Object.freeze([...PUBLIC_HEADERS, Object.freeze({ $ref: "#/components/parameters/Cursor" }), Object.freeze({ $ref: "#/components/parameters/Limit" })]),
        responses: Object.freeze({ "200": jsonResponse("Webhook delivery page", Object.freeze({ $ref: "#/components/schemas/WebhookDeliveryPage" })), ...STANDARD_RESPONSES }),
      }),
    }),
    "/public/v1/integrations/webhook-deliveries/{deliveryId}/replay": Object.freeze({
      post: Object.freeze({
        tags: Object.freeze(["Webhooks"]),
        operationId: "requestWebhookDeliveryReplay",
        summary: "Request replay of a dead-letter delivery",
        description: "Requires scope integration.webhook.manage and an idempotency-key header. Only dead-letter deliveries are eligible.",
        security: PUBLIC_SECURITY,
        parameters: Object.freeze([
          ...PUBLIC_HEADERS,
          Object.freeze({ $ref: "#/components/parameters/IdempotencyKey" }),
          Object.freeze({ name: "deliveryId", in: "path", required: true, schema: Object.freeze({ type: "string", format: "uuid" }) }),
        ]),
        requestBody: Object.freeze({ required: true, content: Object.freeze({ "application/json": Object.freeze({ schema: Object.freeze({ $ref: "#/components/schemas/WebhookReplayRequest" }) }) }) }),
        responses: Object.freeze({
          "200": jsonResponse("Idempotent replay of an existing request", Object.freeze({ $ref: "#/components/schemas/WebhookReplayResponse" })),
          "202": jsonResponse("Replay request accepted", Object.freeze({ $ref: "#/components/schemas/WebhookReplayResponse" })),
          ...STANDARD_RESPONSES,
        }),
      }),
    }),
  }),
  components: Object.freeze({
    securitySchemes: Object.freeze({
      ApiKeyAuth: Object.freeze({ type: "apiKey", in: "header", name: "x-api-key" }),
      OAuth2ClientCredentials: Object.freeze({
        type: "oauth2",
        flows: Object.freeze({ clientCredentials: Object.freeze({ tokenUrl: "/public/v1/oauth/token", scopes: Object.freeze({}) }) }),
      }),
    }),
    parameters: Object.freeze({
      TenantId: Object.freeze({ name: "x-tenant-id", in: "header", required: true, schema: Object.freeze({ type: "string", format: "uuid" }) }),
      ClientId: Object.freeze({ name: "x-client-id", in: "header", required: true, schema: Object.freeze({ type: "string", format: "uuid" }) }),
      RequestId: Object.freeze({ name: "x-request-id", in: "header", required: false, schema: Object.freeze({ type: "string", minLength: 1, maxLength: 200 }) }),
      BusinessDate: Object.freeze({ name: "x-business-date", in: "header", required: false, schema: Object.freeze({ type: "string", format: "date" }) }),
      TimeZone: Object.freeze({ name: "x-time-zone", in: "header", required: false, schema: Object.freeze({ type: "string", default: "UTC" }) }),
      IdempotencyKey: Object.freeze({ name: "idempotency-key", in: "header", required: true, schema: Object.freeze({ type: "string", minLength: 8, maxLength: 200 }) }),
      Cursor: Object.freeze({ name: "cursor", in: "query", required: false, schema: Object.freeze({ type: "string", pattern: "^[a-f0-9]{32}$" }) }),
      Limit: Object.freeze({ name: "limit", in: "query", required: false, schema: Object.freeze({ type: "integer", minimum: 1, maximum: 200, default: 50 }) }),
    }),
    headers: Object.freeze({
      RateLimitLimit: Object.freeze({ schema: Object.freeze({ type: "integer", minimum: 1 }) }),
      RateLimitRemaining: Object.freeze({ schema: Object.freeze({ type: "integer", minimum: 0 }) }),
      RateLimitReset: Object.freeze({ schema: Object.freeze({ type: "string", format: "date-time" }) }),
      RequestId: Object.freeze({ schema: Object.freeze({ type: "string" }) }),
    }),
    schemas: Object.freeze({
      PublicApiCapabilities: Object.freeze({
        type: "object",
        required: Object.freeze(["schemaVersion", "apiVersion", "authentication", "pagination", "mutations", "rateLimits"]),
        properties: Object.freeze({
          schemaVersion: Object.freeze({ type: "string", const: "1.0" }),
          apiVersion: Object.freeze({ type: "string" }),
          authentication: Object.freeze({ type: "array", items: Object.freeze({ type: "string", enum: Object.freeze(["api_key", "oauth2_client_credentials"]) }) }),
          pagination: Object.freeze({ type: "string", const: "opaque_cursor" }),
          mutations: Object.freeze({ type: "string", const: "idempotency_required" }),
          rateLimits: Object.freeze({ type: "string", const: "per_client_per_minute" }),
        }),
      }),
      MetricDefinitionPage: Object.freeze({ type: "object", required: Object.freeze(["data"]), properties: Object.freeze({ data: Object.freeze({ type: "object", required: Object.freeze(["items"]), properties: Object.freeze({ items: Object.freeze({ type: "array", items: Object.freeze({ $ref: "#/components/schemas/MetricDefinition" }) }), nextCursor: Object.freeze({ type: "string" }) }) }) }) }),
      MetricDefinition: Object.freeze({
        type: "object",
        required: Object.freeze(["metricId", "version", "ownerModule", "displayName", "description", "valueKind", "supportedDimensions", "defaultFreshnessSeconds", "effectiveFrom"]),
        properties: Object.freeze({
          metricId: Object.freeze({ type: "string" }), version: Object.freeze({ type: "string" }), ownerModule: Object.freeze({ type: "string" }), displayName: Object.freeze({ type: "string" }), description: Object.freeze({ type: "string" }),
          valueKind: Object.freeze({ type: "string", enum: Object.freeze(["money", "quantity", "count", "ratio", "duration"]) }), supportedDimensions: Object.freeze({ type: "array", items: Object.freeze({ type: "string" }) }),
          controlTotalMetricId: Object.freeze({ type: "string" }), defaultFreshnessSeconds: Object.freeze({ type: "integer", minimum: 1 }), effectiveFrom: Object.freeze({ type: "string", format: "date-time" }),
        }),
      }),
      MetricQueryRequest: Object.freeze({
        type: "object", required: Object.freeze(["metricId", "periodStart", "periodEnd"]),
        properties: Object.freeze({ metricId: Object.freeze({ type: "string" }), metricVersion: Object.freeze({ type: "string" }), periodStart: Object.freeze({ type: "string", format: "date-time" }), periodEnd: Object.freeze({ type: "string", format: "date-time" }), dimensions: Object.freeze({ type: "object", additionalProperties: Object.freeze({ type: "string" }) }) }),
      }),
      MetricQueryResponse: Object.freeze({ type: "object", required: Object.freeze(["data"]), properties: Object.freeze({ data: Object.freeze({ type: "object", additionalProperties: true }) }) }),
      ExportCreateRequest: Object.freeze({ type: "object", required: Object.freeze(["reportId", "format"]), properties: Object.freeze({ reportId: Object.freeze({ type: "string" }), format: Object.freeze({ type: "string", enum: Object.freeze(["csv", "xlsx", "pdf", "json"]) }), parameters: Object.freeze({ type: "object", additionalProperties: Object.freeze({ type: "string" }) }) }) }),
      ExportCreateResponse: Object.freeze({ type: "object", required: Object.freeze(["data"]), properties: Object.freeze({ data: Object.freeze({ type: "object", required: Object.freeze(["exportId", "status", "replayed", "expiresAt"]), properties: Object.freeze({ exportId: Object.freeze({ type: "string", format: "uuid" }), status: Object.freeze({ type: "string", const: "queued" }), replayed: Object.freeze({ type: "boolean" }), expiresAt: Object.freeze({ type: "string", format: "date-time" }) }) }) }) }),
      ExportStatusResponse: Object.freeze({ type: "object", required: Object.freeze(["data"]), properties: Object.freeze({ data: Object.freeze({ type: "object", additionalProperties: true }) }) }),
      WebhookDeliveryPage: Object.freeze({ type: "object", required: Object.freeze(["data"]), properties: Object.freeze({ data: Object.freeze({ type: "object", required: Object.freeze(["items"]), properties: Object.freeze({ items: Object.freeze({ type: "array", items: Object.freeze({ type: "object", additionalProperties: true }) }), nextCursor: Object.freeze({ type: "string" }) }) }) }) }),
      WebhookReplayRequest: Object.freeze({ type: "object", required: Object.freeze(["reason"]), properties: Object.freeze({ reason: Object.freeze({ type: "string", minLength: 1, maxLength: 500 }) }) }),
      WebhookReplayResponse: Object.freeze({ type: "object", required: Object.freeze(["data"]), properties: Object.freeze({ data: Object.freeze({ type: "object", required: Object.freeze(["replayId", "deliveryId", "replayed", "status"]), properties: Object.freeze({ replayId: Object.freeze({ type: "string", format: "uuid" }), deliveryId: Object.freeze({ type: "string", format: "uuid" }), replayed: Object.freeze({ type: "boolean" }), status: Object.freeze({ type: "string", const: "queued" }) }) }) }) }),
      Problem: Object.freeze({
        type: "object", required: Object.freeze(["error"]), properties: Object.freeze({ error: Object.freeze({ type: "object", required: Object.freeze(["code", "message", "requestId"]), properties: Object.freeze({ code: Object.freeze({ type: "string" }), message: Object.freeze({ type: "string" }), requestId: Object.freeze({ type: "string" }) }) }) }),
      }),
    }),
  }),
});

const CAPABILITIES = Object.freeze({
  schemaVersion: "1.0",
  apiVersion: PUBLIC_API_VERSION,
  authentication: Object.freeze(["api_key", "oauth2_client_credentials"]),
  pagination: "opaque_cursor",
  maximumPageSize: 200,
  mutations: "idempotency_required",
  rateLimits: "per_client_per_minute",
  rateLimitHeaders: Object.freeze(["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]),
  requestTracing: Object.freeze(["x-request-id", "traceparent"]),
  tenantIsolation: "required",
  credentialStorage: "reference_only",
  operations: Object.freeze([
    "reporting.metrics.list",
    "reporting.metrics.query",
    "reporting.exports.create",
    "reporting.exports.get",
    "integration.webhookDeliveries.list",
    "integration.webhookDeliveries.replay",
  ]),
});

function discoveryResponse(body: unknown): Response {
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=300",
      "x-api-version": PUBLIC_API_VERSION,
      "x-content-type-options": "nosniff",
    },
  });
}

export function handlePublicApiDiscovery(request: Request, url: URL): Response | undefined {
  if (request.method === "GET" && url.pathname === "/public/v1/openapi.json") return discoveryResponse(publicApiOpenApiDocument);
  if (request.method === "GET" && url.pathname === "/public/v1/capabilities") return discoveryResponse(Object.freeze({ data: CAPABILITIES }));
  return undefined;
}
