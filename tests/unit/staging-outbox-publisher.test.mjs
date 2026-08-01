import assert from "node:assert/strict";
import test from "node:test";
import {
  STAGING_OUTBOX_CONSUMER,
  STAGING_OUTBOX_LIMITS,
  canonicalOutboxEnvelopeDigest,
  claimSyntheticOutboxBatch,
  drainSyntheticOutbox,
  inspectSyntheticOutboxBacklog,
  markSyntheticOutboxPublished,
  recordSyntheticOutboxReceipt,
  scheduleSyntheticOutboxRetry,
} from "../../tooling/scripts/staging-outbox-publisher.mjs";

function event(overrides = {}) {
  return {
    id: "018f0000-0000-7000-8000-000000000901",
    tenantId: "018f0000-0000-7000-8000-000000000002",
    eventType: "inventory.reservation.created.v1",
    aggregateType: "inventory_reservation",
    aggregateId: "018f0000-0000-7000-8000-000000000902",
    schemaVersion: "1",
    payload: { quantity: { amount: "1", scale: 0 }, tags: ["synthetic", "staging"] },
    metadata: { source: "persistent-staging", nested: { beta: 2, alpha: 1 } },
    correlationId: "staging-correlation-1",
    causationId: null,
    occurredAt: "2026-07-30T19:00:00.000Z",
    businessDate: "2026-07-31",
    attempt: 1,
    ...overrides,
  };
}

test("publisher constants are fixed, bounded and staging-specific", () => {
  assert.equal(STAGING_OUTBOX_CONSUMER, "staging-operability-evidence-v1");
  assert.ok(Object.isFrozen(STAGING_OUTBOX_LIMITS));
  assert.deepEqual(STAGING_OUTBOX_LIMITS, {
    batchSize: 25,
    maxBatchSize: 100,
    leaseSeconds: 300,
    maxAttempts: 8,
    maxEventsPerRun: 500,
    retryBaseSeconds: 30,
    retryMaxSeconds: 900,
  });
});

test("canonical digest is stable for recursively equivalent envelopes and changes with content", () => {
  const left = event();
  const right = event({
    payload: { tags: ["synthetic", "staging"], quantity: { scale: 0, amount: "1" } },
    metadata: { nested: { alpha: 1, beta: 2 }, source: "persistent-staging" },
  });
  const changed = event({ payload: { quantity: { amount: "2", scale: 0 }, tags: ["synthetic", "staging"] } });
  const digest = canonicalOutboxEnvelopeDigest(left);
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(digest, canonicalOutboxEnvelopeDigest(right));
  assert.notEqual(digest, canonicalOutboxEnvelopeDigest(changed));
  assert.doesNotMatch(digest, /inventory|synthetic|staging/u);
});

test("canonical digest rejects malformed or non-JSON-safe envelopes", () => {
  assert.throws(
    () => canonicalOutboxEnvelopeDigest(event({ eventType: "" })),
    /eventType must be a non-empty string/u,
  );
  assert.throws(
    () => canonicalOutboxEnvelopeDigest(event({ payload: { unsafe: 1n } })),
    /payload must contain JSON-safe values/u,
  );
  assert.throws(
    () => canonicalOutboxEnvelopeDigest(event({ metadata: [undefined] })),
    /metadata must contain JSON-safe values/u,
  );
});

test("claim query leases only due synthetic events with skip-locked and bounded attempts", async () => {
  let observed;
  const client = {
    async query(sql, params) {
      observed = { sql, params };
      return {
        rows: [{
          id: event().id,
          tenant_id: event().tenantId,
          event_type: event().eventType,
          aggregate_type: event().aggregateType,
          aggregate_id: event().aggregateId,
          schema_version: event().schemaVersion,
          payload: event().payload,
          metadata: event().metadata,
          correlation_id: event().correlationId,
          causation_id: null,
          occurred_at: event().occurredAt,
          business_date: event().businessDate,
          attempts: "2",
        }],
      };
    },
  };
  const claimed = await claimSyntheticOutboxBatch(client, { batchSize: 10, leaseSeconds: 120, maxAttempts: 6 });
  assert.equal(claimed.length, 1);
  assert.deepEqual(claimed[0], event({ attempt: 2 }));
  assert.deepEqual(observed.params, [10, 120, 6]);
  assert.match(observed.sql, /staging-outbox:claim/u);
  assert.match(observed.sql, /code LIKE 'synthetic-%'/u);
  assert.match(observed.sql, /published_at IS NULL/u);
  assert.match(observed.sql, /next_attempt_at IS NULL OR outbox\.next_attempt_at <= clock_timestamp\(\)/u);
  assert.match(observed.sql, /attempts < \$3/u);
  assert.match(observed.sql, /FOR UPDATE SKIP LOCKED/u);
  assert.match(observed.sql, /attempts = outbox\.attempts \+ 1/u);
  assert.match(observed.sql, /next_attempt_at = clock_timestamp\(\) \+ \(\$2 \* interval '1 second'\)/u);
});

test("claim validation rejects unsafe limits before database access", async () => {
  let called = false;
  const client = { query: async () => { called = true; return { rows: [] }; } };
  for (const options of [
    { batchSize: 0 },
    { batchSize: 101 },
    { leaseSeconds: 0 },
    { maxAttempts: 0 },
    { batchSize: 1.5 },
  ]) {
    await assert.rejects(claimSyntheticOutboxBatch(client, options), /must be/u);
  }
  assert.equal(called, false);
});

test("durable receipt persists only an envelope hash and replays the same hash", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ payload_hash: params[3], status: "completed", attempts: "2" }] };
    },
  };
  const result = await recordSyntheticOutboxReceipt(client, event());
  assert.deepEqual(result, { delivered: false, replayed: true, receiptAttempts: 2 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.slice(0, 3), [event().tenantId, STAGING_OUTBOX_CONSUMER, event().id]);
  assert.equal(calls[0].params[3], canonicalOutboxEnvelopeDigest(event()));
  assert.match(calls[0].sql, /staging-outbox:receipt/u);
  assert.match(calls[0].sql, /platform\.inbox_receipts/u);
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, consumer_name, event_id\)/u);
  assert.match(calls[0].sql, /WHERE receipt\.payload_hash = EXCLUDED\.payload_hash/u);
  assert.doesNotMatch(calls[0].sql, /payload\s+jsonb|metadata\s+jsonb|correlation_id|aggregate_id/iu);
  assert.doesNotMatch(JSON.stringify(result), /018f|inventory|synthetic|payload|token|cookie/iu);
});

test("durable receipt rejects a changed-envelope conflict", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    recordSyntheticOutboxReceipt(client, event()),
    /staging outbox receipt hash conflict/u,
  );
});

test("publish acknowledgement is bound to tenant, event and exact claimed attempt", async () => {
  let observed;
  const client = {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [{ published_at: "2026-07-30T19:01:00.000Z" }] };
    },
  };
  const result = await markSyntheticOutboxPublished(client, event({ attempt: 3 }));
  assert.deepEqual(result, { published: true });
  assert.deepEqual(observed.params, [event().tenantId, event().id, 3]);
  assert.match(observed.sql, /staging-outbox:ack/u);
  assert.match(observed.sql, /attempts = \$3/u);
  assert.match(observed.sql, /code LIKE 'synthetic-%'/u);
  assert.match(observed.sql, /published_at = clock_timestamp\(\)/u);
  assert.match(observed.sql, /next_attempt_at = NULL/u);
  assert.match(observed.sql, /last_error = NULL/u);
  await assert.rejects(
    markSyntheticOutboxPublished({ query: async () => ({ rows: [] }) }, event()),
    /stale staging outbox acknowledgement/u,
  );
});

test("retry scheduling stores a fixed category with bounded exponential delay", async () => {
  let observed;
  const client = {
    async query(sql, params) {
      observed = { sql, params };
      return { rows: [{ next_attempt_at: "2026-07-30T19:02:00.000Z" }] };
    },
  };
  const result = await scheduleSyntheticOutboxRetry(client, event({ attempt: 3 }), "delivery_failed");
  assert.deepEqual(result, { scheduled: true, retrySeconds: 120 });
  assert.deepEqual(observed.params, [event().tenantId, event().id, 3, "delivery_failed", 120]);
  assert.match(observed.sql, /staging-outbox:retry/u);
  assert.match(observed.sql, /last_error = \$4/u);
  assert.match(observed.sql, /next_attempt_at = clock_timestamp\(\) \+ \(\$5 \* interval '1 second'\)/u);
  await assert.rejects(
    scheduleSyntheticOutboxRetry(client, event(), "raw provider error"),
    /Unsupported staging outbox error category/u,
  );
});

test("backlog inspection returns aggregate counts without row identifiers or payloads", async () => {
  let observedSql = "";
  const result = await inspectSyntheticOutboxBacklog({
    async query(sql) {
      observedSql = sql;
      return { rows: [{ remaining: "4", exhausted: "1", oldest_seconds: "90" }] };
    },
  });
  assert.deepEqual(result, { remaining: 4, exhausted: 1, oldestSeconds: 90 });
  assert.match(observedSql, /staging-outbox:backlog/u);
  assert.match(observedSql, /code LIKE 'synthetic-%'/u);
  assert.doesNotMatch(observedSql, /payload|metadata|aggregate_id|correlation_id|last_error/iu);
});

test("bounded drain delivers multiple batches, preserves replay evidence and returns aggregates only", async () => {
  const batches = [
    [event({ id: "event-1", attempt: 1 }), event({ id: "event-2", attempt: 1 })],
    [event({ id: "event-3", attempt: 2 })],
    [],
  ];
  const acknowledged = [];
  const summary = await drainSyntheticOutbox({}, {
    batchSize: 2,
    maxEvents: 5,
    claim: async () => batches.shift(),
    deliver: async (_client, current) => ({ delivered: current.id !== "event-3", replayed: current.id === "event-3", receiptAttempts: current.id === "event-3" ? 2 : 1 }),
    acknowledge: async (_client, current) => { acknowledged.push(current.id); return { published: true }; },
    retry: async () => { throw new Error("retry should not run"); },
    inspect: async () => ({ remaining: 0, exhausted: 0, oldestSeconds: 0 }),
  });
  assert.deepEqual(acknowledged, ["event-1", "event-2", "event-3"]);
  assert.deepEqual(summary, {
    schemaVersion: 1,
    consumer: STAGING_OUTBOX_CONSUMER,
    batches: 2,
    claimed: 3,
    delivered: 2,
    replayed: 1,
    failed: 0,
    remaining: 0,
    exhausted: 0,
    oldestUnpublishedSeconds: 0,
    payloadsPersistedInArtifacts: false,
    externalDelivery: false,
  });
  assert.doesNotMatch(JSON.stringify(summary), /event-1|018f|inventory|metadata|token|cookie/iu);
});

test("bounded drain schedules safe retry and reports remaining work without leaking the error", async () => {
  const retries = [];
  const summary = await drainSyntheticOutbox({}, {
    batchSize: 1,
    maxEvents: 2,
    claim: (() => {
      let called = false;
      return async () => called ? [] : (called = true, [event({ id: "private-event" })]);
    })(),
    deliver: async () => { throw new Error("provider token super-secret-value"); },
    acknowledge: async () => { throw new Error("ack should not run"); },
    retry: async (_client, current, category) => { retries.push([current.id, category]); return { scheduled: true, retrySeconds: 30 }; },
    inspect: async () => ({ remaining: 1, exhausted: 0, oldestSeconds: 10 }),
  });
  assert.deepEqual(retries, [["private-event", "delivery_failed"]]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.remaining, 1);
  assert.doesNotMatch(JSON.stringify(summary), /private-event|provider token|super-secret-value/iu);
});

test("bounded drain rejects unsafe execution limits before claiming work", async () => {
  let claimed = false;
  await assert.rejects(
    drainSyntheticOutbox({}, { maxEvents: 0, claim: async () => { claimed = true; return []; } }),
    /maxEvents must be/u,
  );
  assert.equal(claimed, false);
});
