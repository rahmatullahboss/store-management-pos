import assert from "node:assert/strict";
import test from "node:test";
import {
  PermanentReportingWorkerError,
  RetryableReportingWorkerError,
  advanceProjectionCursor,
  assertMetricDefinition,
  projectionFreshness,
  reconcileProjection,
  runExportWorker,
  runProjectionBatch,
} from "../../build/modules/reporting/src/index.js";
import {
  assertConnectorMappingsLoopSafe,
  assertWebhookSubscription,
  protectSpreadsheetCell,
  redactIntegrationDiagnostic,
  runConnectorPage,
  runWebhookWorker,
  transitionWebhookDelivery,
  webhookDeliveryIdentity,
} from "../../build/modules/integrations/src/index.js";
import {
  applyUsageEvent,
  assertImpersonationGrantActive,
  assertPlanDefinition,
  evaluateEntitlement,
  transitionSubscription,
} from "../../build/modules/saas-admin/src/index.js";

const audit = {
  actorId: "user-1",
  requestId: "request-1",
  traceId: "trace-1",
};

const scope = {
  tenantId: "tenant-1",
  actorId: "user-1",
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-07-29",
};

function projectionEvent(sequence, eventId) {
  return {
    schemaVersion: "1.0",
    eventId,
    tenantId: "tenant-1",
    eventType: "sales.invoice.posted.v1",
    aggregateType: "sales.invoice",
    aggregateId: `invoice-${sequence}`,
    sequence,
    occurredAt: "2026-07-29T12:00:00.000Z",
    businessDate: "2026-07-29",
    payload: { grossMinor: "1000" },
    metadata: audit,
  };
}

test("reporting metrics preserve exact values, control totals and provenance", () => {
  const definition = {
    schemaVersion: "1.0",
    metricId: "sales.gross_total",
    version: "1.0.0",
    ownerModule: "sales",
    displayName: "Gross sales",
    description: "Posted gross sales before discounts and returns.",
    valueKind: "money",
    formula: "sum(sales.invoice.gross_minor)",
    supportedDimensions: ["storeId", "businessDate"],
    sourceEventTypes: ["sales.invoice.posted.v1"],
    defaultFreshnessSeconds: 60,
  };
  assert.doesNotThrow(() => assertMetricDefinition(definition));
  const result = reconcileProjection({
    tenantId: "tenant-1",
    projectionName: "sales.gross_projection",
    metricId: definition.metricId,
    metricVersion: definition.version,
    projected: { amount: "900719925474099312345", scale: 2, unit: "money", currency: "GBP" },
    control: { amount: "900719925474099312300", scale: 2, unit: "money", currency: "GBP" },
    checkedAt: "2026-07-29T12:00:00.000Z",
    sourceCursor: "100",
  });
  assert.equal(result.difference.amount, "45");
  assert.equal(result.reconciled, false);
  assert.throws(
    () => reconcileProjection({
      tenantId: "tenant-1",
      projectionName: "sales.gross_projection",
      metricId: definition.metricId,
      metricVersion: definition.version,
      projected: { amount: "1", scale: 2, unit: "money", currency: "GBP" },
      control: { amount: "1", scale: 2, unit: "money", currency: "USD" },
      checkedAt: "2026-07-29T12:00:00.000Z",
      sourceCursor: "100",
    }),
    /incompatible/i,
  );
});

test("projection cursor deduplicates replay and rejects silent out-of-order processing", () => {
  const event = projectionEvent("1", "event-1");
  const first = advanceProjectionCursor(undefined, event);
  const duplicate = advanceProjectionCursor(first.cursor, event);
  assert.equal(first.disposition, "applied");
  assert.equal(duplicate.disposition, "duplicate");
  assert.throws(() => advanceProjectionCursor(first.cursor, { ...event, eventId: "event-old", sequence: "0" }), /positive integer/i);
  assert.equal(projectionFreshness({ observedAt: "2026-07-29T12:00:30.000Z", sourceOccurredAt: event.occurredAt, thresholdSeconds: 60 }), "fresh");
  assert.equal(projectionFreshness({ observedAt: "2026-07-29T12:02:00.000Z", sourceOccurredAt: event.occurredAt, thresholdSeconds: 60 }), "stale");
});

test("webhook lifecycle is signed, idempotent and terminal outcomes cannot replay", () => {
  const subscription = {
    schemaVersion: "1.0",
    subscriptionId: "subscription-1",
    tenantId: "tenant-1",
    endpointUrl: "https://partner.example/webhooks",
    eventTypes: ["sales.invoice.posted.v1"],
    signingKeyReference: "secret/webhook/1",
    status: "active",
    maxAttempts: 8,
    createdAt: "2026-07-29T12:00:00.000Z",
  };
  assert.doesNotThrow(() => assertWebhookSubscription(subscription));
  assert.throws(() => assertWebhookSubscription({ ...subscription, endpointUrl: "http://partner.example/webhooks" }), /HTTPS/u);
  const queued = {
    schemaVersion: "1.0",
    deliveryId: "delivery-1",
    tenantId: "tenant-1",
    subscriptionId: "subscription-1",
    eventId: "event-1",
    eventType: "sales.invoice.posted.v1",
    payloadHash: "a".repeat(64),
    signatureVersion: "hmac-sha256-v1",
    status: "queued",
    attemptCount: 0,
    createdAt: "2026-07-29T12:00:00.000Z",
  };
  assert.equal(webhookDeliveryIdentity(queued), "tenant-1:subscription-1:event-1");
  const delivering = transitionWebhookDelivery(queued, "start", "2026-07-29T12:00:01.000Z");
  const delivered = transitionWebhookDelivery(delivering, "deliver", "2026-07-29T12:00:02.000Z", 204);
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.attemptCount, 1);
  assert.throws(() => transitionWebhookDelivery(delivered, "start", "2026-07-29T12:00:03.000Z"), /terminal/i);
});

test("connector mappings prevent ownership loops and diagnostics redact credentials", () => {
  const outbound = {
    schemaVersion: "1.0",
    mappingId: "mapping-1",
    connectionId: "connection-1",
    resourceType: "product",
    platformField: "name",
    externalField: "title",
    ownership: "platform",
    direction: "outbound",
    transformVersion: "1",
  };
  assert.doesNotThrow(() => assertConnectorMappingsLoopSafe([outbound]));
  assert.throws(
    () => assertConnectorMappingsLoopSafe([outbound, { ...outbound, mappingId: "mapping-2", direction: "inbound" }]),
    /both directions|must synchronize outbound/i,
  );
  assert.deepEqual(redactIntegrationDiagnostic({ provider: "demo", apiKey: "secret", access_token: "secret", status: "ok" }), { provider: "demo", status: "ok" });
  assert.equal(protectSpreadsheetCell("=HYPERLINK(\"https://bad.example\")"), "'=HYPERLINK(\"https://bad.example\")");
  assert.equal(protectSpreadsheetCell("Normal value"), "Normal value");
});

test("SaaS entitlements enforce hard limits while preserving business data on suspension", () => {
  const plan = {
    schemaVersion: "1.0",
    planId: "starter",
    version: "1.0.0",
    displayName: "Starter",
    status: "active",
    entitlements: [
      { entitlementCode: "stores.max", valueType: "integer", value: "5", enforcement: "hard" },
      { entitlementCode: "exports.enabled", valueType: "boolean", value: "true", enforcement: "hard" },
    ],
    effectiveFrom: "2026-01-01T00:00:00.000Z",
  };
  assert.doesNotThrow(() => assertPlanDefinition(plan));
  assert.equal(evaluateEntitlement(plan, "stores.max", "5").allowed, true);
  assert.equal(evaluateEntitlement(plan, "stores.max", "6").allowed, false);
  assert.equal(evaluateEntitlement(plan, "exports.enabled").reason, "enabled");

  const subscription = {
    schemaVersion: "1.0",
    subscriptionId: "subscription-1",
    tenantId: "tenant-1",
    planId: "starter",
    planVersion: "1.0.0",
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    currentPeriodStart: "2026-07-01T00:00:00.000Z",
    currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    version: "1",
  };
  const suspended = transitionSubscription(subscription, "suspend", "2026-07-29T12:00:00.000Z");
  const resumed = transitionSubscription(suspended, "resume", "2026-07-29T13:00:00.000Z");
  assert.equal(suspended.status, "suspended");
  assert.equal(resumed.status, "active");
  assert.equal("suspendedAt" in resumed, false);
  assert.equal(resumed.tenantId, subscription.tenantId);
});

test("usage events are exact and idempotent and support impersonation is independently approved", () => {
  const event = {
    schemaVersion: "1.0",
    usageEventId: "usage-1",
    tenantId: "tenant-1",
    subscriptionId: "subscription-1",
    meterCode: "api.requests",
    quantity: "9007199254740993",
    sourceType: "api.request",
    sourceId: "request-1",
    sourceVersion: "1",
    occurredAt: "2026-07-29T12:00:00.000Z",
    businessDate: "2026-07-29",
    idempotencyKey: "usage-1",
    requestHash: "hash-1",
  };
  const first = applyUsageEvent(undefined, event);
  const duplicate = applyUsageEvent(first.counter, event);
  assert.equal(first.counter.quantity, "9007199254740993");
  assert.equal(duplicate.disposition, "duplicate");

  const grant = {
    schemaVersion: "1.0",
    grantId: "grant-1",
    tenantId: "tenant-1",
    supportActorId: "support-1",
    approvedBy: "owner-1",
    reason: "Investigate failed export",
    scopes: ["reporting.read"],
    issuedAt: "2026-07-29T12:00:00.000Z",
    expiresAt: "2026-07-29T13:00:00.000Z",
  };
  assert.doesNotThrow(() => assertImpersonationGrantActive(grant, "2026-07-29T12:30:00.000Z"));
  assert.throws(() => assertImpersonationGrantActive({ ...grant, approvedBy: "support-1" }, "2026-07-29T12:30:00.000Z"), /independent approval/i);
});

test("projection worker preserves order across permanent, retryable and deferred events", async () => {
  const events = [
    projectionEvent("1", "worker-event-1"),
    projectionEvent("2", "worker-event-2"),
    projectionEvent("3", "worker-event-3"),
    projectionEvent("4", "worker-event-4"),
  ];
  const result = await runProjectionBatch({
    tenantId: "tenant-1",
    events,
    commands: {
      async consume(event) {
        if (event.eventId === "worker-event-2") throw new PermanentReportingWorkerError("invalid_payload", "invalid");
        if (event.eventId === "worker-event-3") throw new RetryableReportingWorkerError("database_unavailable", "retry");
        return "applied";
      },
    },
  });
  assert.deepEqual(result.appliedEventIds, ["worker-event-1"]);
  assert.deepEqual(result.deadLetters, [{ eventId: "worker-event-2", category: "invalid_payload" }]);
  assert.deepEqual(result.retryEventIds, ["worker-event-3"]);
  assert.deepEqual(result.deferredEventIds, ["worker-event-4"]);
});

test("export worker bounds artifacts and records only tenant-scoped object receipts", async () => {
  const transitions = [];
  const stored = [];
  const request = {
    schemaVersion: "1.0",
    exportId: "export-1",
    scope,
    format: "csv",
    reportId: "sales.daily",
    parameters: { period: "2026-07" },
    requestedAt: "2026-07-29T12:00:00.000Z",
    metadata: audit,
  };
  const result = await runExportWorker({
    request,
    observedAt: "2026-07-29T12:01:00.000Z",
    renderer: {
      async render() {
        return { contentType: "text/csv", fileExtension: "csv", bytes: new TextEncoder().encode("id,total\n1,100\n"), rowCount: "1" };
      },
    },
    storage: {
      async put(input) {
        stored.push(input.objectKey);
        return { etag: "etag-1" };
      },
    },
    commands: {
      async markRunning(input) { transitions.push(["running", input.exportId]); },
      async markCompleted(input) { transitions.push(["completed", input.objectKey]); },
      async markFailed(input) { transitions.push(["failed", input.category]); },
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.objectKey, "exports/tenant-1/export-1.csv");
  assert.deepEqual(stored, ["exports/tenant-1/export-1.csv"]);
  assert.deepEqual(transitions, [["running", "export-1"], ["completed", "exports/tenant-1/export-1.csv"]]);

  const failed = await runExportWorker({
    request: { ...request, exportId: "export-2" },
    observedAt: "2026-07-29T12:02:00.000Z",
    maxArtifactBytes: 1,
    renderer: {
      async render() {
        return { contentType: "text/csv", fileExtension: "csv", bytes: new TextEncoder().encode("too large"), rowCount: "1" };
      },
    },
    storage: { async put() { throw new Error("must not store"); } },
    commands: {
      async markRunning() {},
      async markCompleted() { throw new Error("must not complete"); },
      async markFailed(input) { transitions.push(["failed", input.category]); },
    },
  });
  assert.deepEqual(failed, { status: "failed", errorCategory: "byte_limit_exceeded" });
});

test("webhook worker retries transient failures and dead-letters exhausted deliveries", async () => {
  const subscription = {
    schemaVersion: "1.0",
    subscriptionId: "subscription-worker",
    tenantId: "tenant-1",
    endpointUrl: "https://partner.example/webhooks",
    eventTypes: ["sales.invoice.posted.v1"],
    signingKeyReference: "secret/webhook/worker",
    status: "active",
    maxAttempts: 2,
    createdAt: "2026-07-29T12:00:00.000Z",
  };
  const recorded = [];
  const baseDelivery = {
    schemaVersion: "1.0",
    deliveryId: "delivery-worker",
    tenantId: "tenant-1",
    subscriptionId: subscription.subscriptionId,
    eventId: "event-worker",
    eventType: "sales.invoice.posted.v1",
    payloadHash: "b".repeat(64),
    signatureVersion: "hmac-sha256-v1",
    status: "queued",
    attemptCount: 0,
    createdAt: "2026-07-29T12:00:00.000Z",
  };
  const ports = {
    signer: { async sign() { return "signature"; } },
    transport: { async send() { return { statusCode: 429 }; } },
    commands: { async record(delivery) { recorded.push(delivery.status); } },
  };
  const retry = await runWebhookWorker({
    subscription,
    delivery: baseDelivery,
    payload: new TextEncoder().encode("{}"),
    ...ports,
    observedAt: "2026-07-29T12:01:00.000Z",
    nextAttemptAt: "2026-07-29T12:02:00.000Z",
  });
  assert.equal(retry.outcome, "retry");
  assert.equal(retry.delivery.attemptCount, 1);
  assert.equal(retry.delivery.nextAttemptAt, "2026-07-29T12:02:00.000Z");

  const deadLetter = await runWebhookWorker({
    subscription,
    delivery: retry.delivery,
    payload: new TextEncoder().encode("{}"),
    ...ports,
    observedAt: "2026-07-29T12:02:00.000Z",
    nextAttemptAt: "2026-07-29T12:03:00.000Z",
  });
  assert.equal(deadLetter.outcome, "dead_letter");
  assert.equal(deadLetter.delivery.attemptCount, 2);
  assert.equal("nextAttemptAt" in deadLetter.delivery, false);
  assert.deepEqual(recorded, ["delivering", "retry_wait", "delivering", "dead_letter"]);
});

test("connector worker applies relevant mappings and advances a monotonic tenant cursor", async () => {
  const connection = {
    schemaVersion: "1.0",
    connectionId: "connection-worker",
    tenantId: "tenant-1",
    connectorType: "generic-rest",
    providerKey: "partner-products",
    credentialReference: "secret/connector/worker",
    status: "active",
    createdAt: "2026-07-29T12:00:00.000Z",
  };
  const mappings = [{
    schemaVersion: "1.0",
    mappingId: "mapping-worker",
    connectionId: connection.connectionId,
    resourceType: "product",
    platformField: "name",
    externalField: "title",
    ownership: "platform",
    direction: "outbound",
    transformVersion: "1",
  }];
  const recorded = [];
  const cursors = [];
  const result = await runConnectorPage({
    connection,
    mappings,
    resourceType: "product",
    direction: "outbound",
    observedAt: "2026-07-29T12:05:00.000Z",
    adapter: {
      async read() {
        return { records: [{ syncId: "sync-1", externalId: "external-1", payload: { title: "Product" } }], nextCursor: "cursor-2", exhausted: false };
      },
    },
    apply: {
      async apply() {
        return { status: "applied", platformReference: "product-1" };
      },
    },
    commands: {
      async recordOutcome(outcome) { recorded.push(outcome); },
      async advanceCursor(cursor) { cursors.push(cursor); },
    },
  });
  assert.equal(result.outcomes[0].status, "applied");
  assert.equal(result.cursor.cursor, "cursor-2");
  assert.equal(recorded[0].externalReference, "external-1");
  assert.equal(cursors[0].tenantId, "tenant-1");
});
