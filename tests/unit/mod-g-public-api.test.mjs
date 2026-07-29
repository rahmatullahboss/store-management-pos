import assert from "node:assert/strict";
import test from "node:test";
import api from "../../build/apps/api/src/index.js";
import {
  apiScopeGranted,
  applyApiRateLimit,
  authorizePublicApiRequest,
  beginPublicApiIdempotency,
  completePublicApiIdempotency,
  normalizePublicApiPagination,
} from "../../build/modules/integrations/src/index.js";

const client = {
  schemaVersion: "1.0",
  clientId: "client-1",
  tenantId: "tenant-1",
  displayName: "Reporting partner",
  authentication: "api_key",
  scopes: ["reporting.*", "integration.webhook.read"],
  status: "active",
  rateLimitPerMinute: 2,
  createdAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2027-07-29T12:00:00.000Z",
};

const scope = {
  tenantId: "tenant-1",
  actorId: "client-1",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-29",
};

function publicRequest(overrides = {}) {
  return {
    schemaVersion: "1.0",
    scope,
    clientId: "client-1",
    operationId: "reporting.metrics.query",
    pagination: { limit: 50, sort: ["businessDate", "-amount"] },
    body: { metricId: "sales.gross_total" },
    requestedAt: "2026-07-29T12:00:01.000Z",
    ...overrides,
  };
}

test("public API scope authorization is tenant-bound and mutations require idempotency", () => {
  assert.equal(apiScopeGranted(client.scopes, "reporting.metrics.read"), true);
  assert.equal(apiScopeGranted(client.scopes, "integration.webhook.manage"), false);

  const allowed = authorizePublicApiRequest({
    client,
    request: publicRequest(),
    requiredScopes: ["reporting.metrics.read"],
    observedAt: "2026-07-29T12:00:02.000Z",
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "allowed");

  const tenantDenied = authorizePublicApiRequest({
    client,
    request: publicRequest({ scope: { ...scope, tenantId: "tenant-2" } }),
    requiredScopes: ["reporting.metrics.read"],
    observedAt: "2026-07-29T12:00:02.000Z",
  });
  assert.equal(tenantDenied.reason, "tenant_mismatch");

  const scopeDenied = authorizePublicApiRequest({
    client,
    request: publicRequest(),
    requiredScopes: ["integration.webhook.manage"],
    observedAt: "2026-07-29T12:00:02.000Z",
  });
  assert.equal(scopeDenied.reason, "scope_denied");

  const idempotencyDenied = authorizePublicApiRequest({
    client,
    request: publicRequest({ operationId: "reporting.export.create" }),
    requiredScopes: ["reporting.exports.write"],
    observedAt: "2026-07-29T12:00:02.000Z",
    requiresIdempotency: true,
  });
  assert.equal(idempotencyDenied.reason, "idempotency_required");
});

test("public API rate limits deduplicate request IDs and reset on minute boundaries", () => {
  const first = applyApiRateLimit({ client, requestId: "request-1", observedAt: "2026-07-29T12:00:01.000Z" });
  assert.equal(first.disposition, "allowed");
  assert.equal(first.remaining, 1);

  const duplicate = applyApiRateLimit({
    client,
    requestId: "request-1",
    observedAt: "2026-07-29T12:00:10.000Z",
    current: first.window,
  });
  assert.equal(duplicate.disposition, "duplicate");
  assert.equal(duplicate.window.requestCount, 1);

  const second = applyApiRateLimit({
    client,
    requestId: "request-2",
    observedAt: "2026-07-29T12:00:20.000Z",
    current: duplicate.window,
  });
  assert.equal(second.disposition, "allowed");
  assert.equal(second.remaining, 0);

  const limited = applyApiRateLimit({
    client,
    requestId: "request-3",
    observedAt: "2026-07-29T12:00:30.000Z",
    current: second.window,
  });
  assert.equal(limited.disposition, "limited");
  assert.equal(limited.resetAt, "2026-07-29T12:01:00.000Z");

  const reset = applyApiRateLimit({
    client,
    requestId: "request-3",
    observedAt: "2026-07-29T12:01:00.000Z",
    current: limited.window,
  });
  assert.equal(reset.disposition, "allowed");
  assert.equal(reset.window.requestCount, 1);
});

test("public API idempotency distinguishes replay, conflict and in-progress work", () => {
  const request = publicRequest({
    operationId: "reporting.export.create",
    idempotency: { key: "export-key-0001", requestHash: "a".repeat(64), replayed: false },
  });
  const started = beginPublicApiIdempotency({
    request,
    observedAt: "2026-07-29T12:00:00.000Z",
    expiresAt: "2026-07-30T12:00:00.000Z",
  });
  assert.equal(started.disposition, "started");

  const inProgress = beginPublicApiIdempotency({
    request,
    observedAt: "2026-07-29T12:00:01.000Z",
    expiresAt: "2026-07-30T12:00:00.000Z",
    existing: started.record,
  });
  assert.equal(inProgress.disposition, "in_progress");

  const conflict = beginPublicApiIdempotency({
    request: publicRequest({
      operationId: "reporting.export.create",
      idempotency: { key: "export-key-0001", requestHash: "b".repeat(64), replayed: false },
    }),
    observedAt: "2026-07-29T12:00:02.000Z",
    expiresAt: "2026-07-30T12:00:00.000Z",
    existing: started.record,
  });
  assert.equal(conflict.disposition, "conflict");

  const completed = completePublicApiIdempotency({
    record: started.record,
    responseStatus: 201,
    responseBody: { exportId: "export-1" },
    observedAt: "2026-07-29T12:00:03.000Z",
  });
  const replay = beginPublicApiIdempotency({
    request,
    observedAt: "2026-07-29T12:00:04.000Z",
    expiresAt: "2026-07-30T12:00:00.000Z",
    existing: completed,
  });
  assert.equal(replay.disposition, "replay");
  assert.deepEqual(replay.record.responseBody, { exportId: "export-1" });
});

test("public API pagination uses bounded opaque cursors and deterministic sort fields", () => {
  assert.deepEqual(normalizePublicApiPagination(undefined), { limit: 50 });
  assert.deepEqual(
    normalizePublicApiPagination({ limit: 100, cursor: "cursor_0001", sort: ["businessDate", "-amount"] }),
    { limit: 100, cursor: "cursor_0001", sort: ["businessDate", "-amount"] },
  );
  assert.throws(() => normalizePublicApiPagination({ limit: 201 }), /between 1 and 200/i);
  assert.throws(() => normalizePublicApiPagination({ limit: 10, cursor: "short" }), /cursor/i);
  assert.throws(() => normalizePublicApiPagination({ limit: 10, sort: ["bad field"] }), /sort/i);
});

test("public OpenAPI discovery is available without database or tenant authentication", async () => {
  const env = { DATABASE_URL: "intentionally-invalid", APP_ENV: "test", REGION: "test" };
  const openApi = await api.fetch(new Request("https://api.test/public/v1/openapi.json"), env);
  assert.equal(openApi.status, 200);
  assert.equal(openApi.headers.get("x-api-version"), "1.0.0");
  const openApiBody = await openApi.json();
  assert.equal(openApiBody.openapi, "3.1.0");
  assert.ok(openApiBody.components.securitySchemes.ApiKeyAuth);
  assert.ok(openApiBody.components.securitySchemes.OAuth2ClientCredentials);

  const capabilities = await api.fetch(new Request("https://api.test/public/v1/capabilities"), env);
  assert.equal(capabilities.status, 200);
  const capabilitiesBody = await capabilities.json();
  assert.equal(capabilitiesBody.data.mutations, "idempotency_required");
  assert.equal(capabilitiesBody.data.tenantIsolation, "required");
});
