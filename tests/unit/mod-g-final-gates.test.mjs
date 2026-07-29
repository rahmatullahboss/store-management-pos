import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceProjectionCursor,
  decideReportingWorkload,
  observeModGOperation,
  orchestrateReportingExport,
  recordModGBacklog,
  recordModGReconciliation,
} from "../../build/modules/reporting/src/index.js";
import { redactIntegrationDiagnostic } from "../../build/modules/integrations/src/index.js";

const quiet = {
  checkoutActiveRequests: 10,
  checkoutP95Milliseconds: 120,
  exportQueueDepth: 12,
  concurrentHeavyJobs: 1,
  projectionLagSeconds: 30,
};

test("reporting workload admission defers heavy work before checkout can degrade", () => {
  assert.deepEqual(decideReportingWorkload({ kind: "large_export", snapshot: quiet }), {
    disposition: "admit",
    reason: "within_budget",
    priority: "background",
  });
  const checkoutPressure = decideReportingWorkload({
    kind: "large_export",
    snapshot: { ...quiet, checkoutP95Milliseconds: 500 },
  });
  assert.deepEqual(checkoutPressure, {
    disposition: "defer",
    reason: "checkout_pressure",
    retryAfterSeconds: 30,
    priority: "background",
  });
  const interactive = decideReportingWorkload({
    kind: "interactive_query",
    snapshot: { ...quiet, checkoutP95Milliseconds: 500 },
  });
  assert.equal(interactive.disposition, "admit");
  const saturated = decideReportingWorkload({
    kind: "full_rebuild",
    snapshot: { ...quiet, concurrentHeavyJobs: 4 },
  });
  assert.equal(saturated.reason, "heavy_job_capacity");
});

test("large export rendering is bounded before storage or completion commands", async () => {
  let stored = 0;
  let completed = 0;
  await assert.rejects(
    orchestrateReportingExport({
      request: {
        schemaVersion: "1.0",
        exportId: "export-1",
        scope: { tenantId: "tenant-1", actorId: "user-1", locale: "en-GB", timeZone: "UTC", businessDate: "2026-07-30" },
        format: "csv",
        reportId: "owner.daily-control",
        parameters: {},
        requestedAt: "2026-07-30T00:00:00.000Z",
        metadata: { actorId: "user-1", requestId: "request-1", traceId: "trace-1" },
      },
      renderer: {
        async render() {
          return { body: new Uint8Array([1]), rowCount: 1_000_001, byteCount: 1, contentType: "text/csv" };
        },
      },
      storage: {
        async put() {
          stored += 1;
          return { objectReference: "tenant/tenant-1/report.csv", contentHash: "a".repeat(64), receipt: "receipt-1" };
        },
      },
      commands: {
        async start() {},
        async complete() { completed += 1; },
        async fail() {},
      },
      observedAt: "2026-07-30T00:01:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      limits: { maxRows: 1_000_000, maxBytes: 10_000_000 },
    }),
    /row limit/i,
  );
  assert.equal(stored, 0);
  assert.equal(completed, 0);
});

test("projection cursors reject cross-tenant events before cursor advancement", () => {
  const cursor = {
    schemaVersion: "1.0",
    tenantId: "tenant-1",
    projectionName: "sales",
    sourceStream: "sales.order.completed.v1",
    highWaterSequence: "10",
    lastEventId: "event-10",
    lastOccurredAt: "2026-07-30T00:00:00.000Z",
    status: "fresh",
  };
  const event = {
    schemaVersion: "1.0",
    eventId: "event-11",
    tenantId: "tenant-2",
    eventType: "sales.order.completed.v1",
    aggregateType: "sales",
    aggregateId: "order-1",
    sequence: "11",
    occurredAt: "2026-07-30T00:01:00.000Z",
    businessDate: "2026-07-30",
    payload: {},
    metadata: { actorId: "user-1", requestId: "request-1", traceId: "trace-1" },
  };
  assert.throws(() => advanceProjectionCursor(cursor, event), /tenant does not match/i);
  assert.equal(cursor.highWaterSequence, "10");
});

test("integration diagnostics recursively remove credentials and bound hostile structures", () => {
  const diagnostic = {
    provider: "commerce",
    authorization: "hidden",
    nested: {
      accessToken: "hidden",
      result: "ok",
      connection: { api_key: "hidden", cursor: "cursor-1" },
    },
    values: [{ password: "hidden", value: "safe" }],
    long: "x".repeat(5_000),
  };
  diagnostic.circular = diagnostic;
  const redacted = redactIntegrationDiagnostic(diagnostic);
  assert.equal("authorization" in redacted, false);
  assert.equal("accessToken" in redacted.nested, false);
  assert.equal("api_key" in redacted.nested.connection, false);
  assert.equal(redacted.nested.connection.cursor, "cursor-1");
  assert.deepEqual(redacted.values, [{ value: "safe" }]);
  assert.equal(redacted.circular, "[Circular]");
  assert.equal(redacted.long.length, 4_097);
  assert.match(redacted.long, /…$/u);
});

test("MOD-G observability emits bounded operation, backlog and reconciliation telemetry", async () => {
  const increments = [];
  const observations = [];
  const logs = [];
  const metrics = {
    increment(name, value, attributes) { increments.push({ name, value, attributes }); },
    observe(name, value, attributes) { observations.push({ name, value, attributes }); },
  };
  const logger = {
    debug() {},
    info(message, context) { logs.push({ level: "info", message, context }); },
    warn() {},
    error(message, context) { logs.push({ level: "error", message, context }); },
  };
  const result = await observeModGOperation({
    ports: { metrics, logger },
    module: "reporting",
    operation: "metric.query",
    work: async () => "ok",
  });
  assert.equal(result, "ok");
  recordModGBacklog({ metrics, queue: "export", depth: 12, oldestAgeSeconds: 45 });
  recordModGReconciliation({ metrics, projection: "sales.net", reconciled: false, differenceMinor: "-250" });
  assert.ok(increments.some(({ name, attributes }) => name === "mod_g.operation.completed" && attributes.outcome === "success"));
  assert.ok(observations.some(({ name, value }) => name === "mod_g.backlog.depth" && value === 12));
  assert.ok(observations.some(({ name, value }) => name === "mod_g.reconciliation.absolute_difference_minor" && value === 250));
  assert.ok(logs.some(({ level, context }) => level === "info" && !Object.keys(context).some((key) => /token|secret|credential/iu.test(key))));

  await assert.rejects(
    observeModGOperation({
      ports: { metrics, logger },
      module: "integration",
      operation: "connector.sync",
      classifyError: () => "Authorization: bearer value",
      work: async () => { throw new Error("provider failed"); },
    }),
    /provider failed/u,
  );
  assert.ok(increments.some(({ attributes }) => attributes.category === "unexpected_failure"));
});
