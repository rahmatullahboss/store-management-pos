const PUBLIC_API_VERSION = "1.0.0";

export const publicApiOpenApiDocument = Object.freeze({
  openapi: "3.1.0",
  info: Object.freeze({
    title: "Ozzyl Store Operating System Public API",
    version: PUBLIC_API_VERSION,
    description: "Contract-first partner API. Tenant business endpoints require an active API client, explicit scopes, bounded rate limits and idempotency for mutations.",
  }),
  tags: Object.freeze([
    Object.freeze({ name: "Discovery", description: "Unauthenticated API metadata and capabilities." }),
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
            headers: Object.freeze({
              "x-api-version": Object.freeze({ schema: Object.freeze({ type: "string" }) }),
            }),
            content: Object.freeze({
              "application/json": Object.freeze({ schema: Object.freeze({ type: "object" }) }),
            }),
          }),
        }),
      }),
    }),
    "/public/v1/capabilities": Object.freeze({
      get: Object.freeze({
        tags: Object.freeze(["Discovery"]),
        operationId: "getPublicApiCapabilities",
        summary: "Get supported partner API conventions",
        responses: Object.freeze({
          "200": Object.freeze({
            description: "Public API capability metadata",
            content: Object.freeze({
              "application/json": Object.freeze({
                schema: Object.freeze({ $ref: "#/components/schemas/PublicApiCapabilities" }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
  components: Object.freeze({
    securitySchemes: Object.freeze({
      ApiKeyAuth: Object.freeze({ type: "apiKey", in: "header", name: "x-api-key" }),
      OAuth2ClientCredentials: Object.freeze({
        type: "oauth2",
        flows: Object.freeze({
          clientCredentials: Object.freeze({ tokenUrl: "/public/v1/oauth/token", scopes: Object.freeze({}) }),
        }),
      }),
    }),
    parameters: Object.freeze({
      RequestId: Object.freeze({
        name: "x-request-id",
        in: "header",
        required: false,
        schema: Object.freeze({ type: "string", minLength: 1, maxLength: 200 }),
      }),
      IdempotencyKey: Object.freeze({
        name: "idempotency-key",
        in: "header",
        required: true,
        schema: Object.freeze({ type: "string", minLength: 8, maxLength: 200 }),
      }),
      Cursor: Object.freeze({
        name: "cursor",
        in: "query",
        required: false,
        schema: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9_-]{8,512}$" }),
      }),
      Limit: Object.freeze({
        name: "limit",
        in: "query",
        required: false,
        schema: Object.freeze({ type: "integer", minimum: 1, maximum: 200, default: 50 }),
      }),
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
      Problem: Object.freeze({
        type: "object",
        required: Object.freeze(["error"]),
        properties: Object.freeze({
          error: Object.freeze({
            type: "object",
            required: Object.freeze(["code", "message", "requestId"]),
            properties: Object.freeze({
              code: Object.freeze({ type: "string" }),
              message: Object.freeze({ type: "string" }),
              requestId: Object.freeze({ type: "string" }),
            }),
          }),
        }),
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
  if (request.method === "GET" && url.pathname === "/public/v1/openapi.json") {
    return discoveryResponse(publicApiOpenApiDocument);
  }
  if (request.method === "GET" && url.pathname === "/public/v1/capabilities") {
    return discoveryResponse(Object.freeze({ data: CAPABILITIES }));
  }
  return undefined;
}
