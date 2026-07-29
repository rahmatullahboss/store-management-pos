import assert from "node:assert/strict";
import test from "node:test";
import { publicApiOpenApiDocument } from "../../build/apps/api/src/public-api-discovery.js";
import { handlePublicPartnerApi } from "../../build/apps/api/src/public-partner-api.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const serviceUserId = "33333333-3333-4333-8333-333333333333";
const metricDefinitionId = "44444444-4444-7444-8444-444444444444";
const exportId = "55555555-5555-7555-8555-555555555555";

function directoryRow(scopes) {
  return {
    client_id: clientId,
    tenant_id: tenantId,
    service_user_id: serviceUserId,
    display_name: "Partner test client",
    authentication: "api_key",
    scopes,
    status: "active",
    rate_limit_per_minute: 60,
    created_at: "2026-07-29T18:00:00.000Z",
    expires_at: "2027-07-29T18:00:00.000Z",
    revoked_at: null,
    credential_reference: "secret://partner/client-1",
    credential_version: 1,
    credential_valid_from: "2026-07-29T18:00:00.000Z",
  };
}

function bindings() {
  return {
    PUBLIC_API_CREDENTIAL_VERIFIER: { verify: async () => "match" },
    PUBLIC_API_RATE_LIMITER: {
      consume: async () => ({ disposition: "allowed", remaining: 59, resetAt: "2026-07-29T19:01:00.000Z" }),
    },
  };
}

function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-tenant-id", tenantId);
  headers.set("x-client-id", clientId);
  headers.set("x-api-key", "partner-key-0001");
  headers.set("x-request-id", "request-partner-0001");
  headers.set("x-business-date", "2026-07-29");
  return new Request(`https://api.test${path}`, { ...init, headers });
}

function databaseFor(scopes, query) {
  const contexts = [];
  return {
    contexts,
    database: {
      httpQuery: async (sql) => {
        assert.match(sql, /resolve_api_client_authentication/u);
        return [directoryRow(scopes)];
      },
      withClientTransaction: async (context, work) => {
        contexts.push(context);
        return await work({ query });
      },
    },
  };
}

test("partner metric listing authenticates before a tenant-scoped transaction", async () => {
  let businessQueries = 0;
  const { database, contexts } = databaseFor(["reporting.metrics.read"], async (sql) => {
    businessQueries += 1;
    assert.match(sql, /reporting\.metric_definitions/u);
    return {
      rows: [{
        id: metricDefinitionId,
        metric_id: "sales.gross_total",
        version: "1.0.0",
        owner_module: "sales",
        display_name: "Gross sales",
        description: "Gross sales before returns",
        value_kind: "money",
        supported_dimensions: ["storeId"],
        control_total_metric_id: null,
        freshness_seconds: 60,
        effective_from: "2026-07-29T00:00:00.000Z",
      }],
      rowCount: 1,
    };
  });
  const publicRequest = request("/public/v1/reporting/metrics?limit=10");
  const response = await handlePublicPartnerApi({
    request: publicRequest,
    url: new URL(publicRequest.url),
    database,
    bindings: bindings(),
    requestId: "request-partner-0001",
    region: "test",
  });
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.items[0].metricId, "sales.gross_total");
  assert.equal(response.headers.get("x-ratelimit-remaining"), "59");
  assert.equal(contexts[0].tenantId, tenantId);
  assert.equal(contexts[0].actorId, serviceUserId);
  assert.equal(businessQueries, 1);
});

test("partner routes deny missing scopes before reading business rows", async () => {
  let businessQueries = 0;
  const { database } = databaseFor(["integration.webhook.read"], async () => {
    businessQueries += 1;
    throw new Error("business query must not run");
  });
  const publicRequest = request("/public/v1/reporting/metrics");
  const response = await handlePublicPartnerApi({
    request: publicRequest,
    url: new URL(publicRequest.url),
    database,
    bindings: bindings(),
    requestId: "request-partner-0001",
    region: "test",
  });
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(businessQueries, 0);
});

test("partner authentication fails closed when credential services are unavailable", async () => {
  const { database } = databaseFor(["reporting.metrics.read"], async () => ({ rows: [], rowCount: 0 }));
  const publicRequest = request("/public/v1/reporting/metrics");
  const response = await handlePublicPartnerApi({
    request: publicRequest,
    url: new URL(publicRequest.url),
    database,
    bindings: {},
    requestId: "request-partner-0001",
    region: "test",
  });
  assert.ok(response);
  assert.equal(response.status, 503);
});

test("partner export requests require idempotency and replay safely", async () => {
  let commandCalls = 0;
  const { database } = databaseFor(["reporting.exports.write"], async (sql, values) => {
    commandCalls += 1;
    assert.match(sql, /reporting\.request_export/u);
    assert.equal(values[1], tenantId);
    assert.equal(values[7], serviceUserId);
    return { rows: [{ export_id: exportId, replayed: false }], rowCount: 1 };
  });

  const missingKey = request("/public/v1/reporting/exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportId: "sales.summary", format: "csv", parameters: { storeId: "store-1" } }),
  });
  const missingResponse = await handlePublicPartnerApi({ request: missingKey, url: new URL(missingKey.url), database, bindings: bindings(), requestId: "request-partner-0001", region: "test" });
  assert.ok(missingResponse);
  assert.equal(missingResponse.status, 400);
  assert.equal(commandCalls, 0);

  const accepted = request("/public/v1/reporting/exports", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "export-request-0001" },
    body: JSON.stringify({ reportId: "sales.summary", format: "csv", parameters: { storeId: "store-1" } }),
  });
  const acceptedResponse = await handlePublicPartnerApi({ request: accepted, url: new URL(accepted.url), database, bindings: bindings(), requestId: "request-partner-0001", region: "test" });
  assert.ok(acceptedResponse);
  assert.equal(acceptedResponse.status, 202);
  const acceptedBody = await acceptedResponse.json();
  assert.equal(acceptedBody.data.exportId, exportId);
  assert.equal(acceptedBody.data.replayed, false);
  assert.equal(commandCalls, 1);
});

test("OpenAPI catalog documents every implemented partner operation", () => {
  const paths = publicApiOpenApiDocument.paths;
  for (const path of [
    "/public/v1/reporting/metrics",
    "/public/v1/reporting/queries",
    "/public/v1/reporting/exports",
    "/public/v1/reporting/exports/{exportId}",
    "/public/v1/integrations/webhook-deliveries",
    "/public/v1/integrations/webhook-deliveries/{deliveryId}/replay",
  ]) assert.ok(paths[path], `${path} must be documented`);
  assert.equal(paths["/public/v1/reporting/exports"].post.parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), true);
  assert.equal(paths["/public/v1/integrations/webhook-deliveries/{deliveryId}/replay"].post.operationId, "requestWebhookDeliveryReplay");
});
