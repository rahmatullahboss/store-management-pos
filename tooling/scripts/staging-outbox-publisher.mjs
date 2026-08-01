import { createHash } from "node:crypto";

export const STAGING_OUTBOX_CONSUMER = "staging-operability-evidence-v1";

export const STAGING_OUTBOX_LIMITS = Object.freeze({
  batchSize: 25,
  maxBatchSize: 100,
  leaseSeconds: 300,
  maxAttempts: 8,
  maxEventsPerRun: 500,
  retryBaseSeconds: 30,
  retryMaxSeconds: 900,
});

const SAFE_ERROR_CATEGORIES = new Set([
  "delivery_failed",
  "receipt_conflict",
  "acknowledgement_failed",
]);

function requireQueryClient(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("A query-capable staging database client is required");
  }
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function databaseInteger(value, name) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} is outside the safe integer range`);
    }
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new TypeError(`${name} must be returned as a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return parsed;
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value, name) {
  if (value === null) return null;
  return nonEmptyString(value, name);
}

function canonicalJsonValue(value, name) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must contain JSON-safe values`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item, name));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${name} must contain JSON-safe values`);
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === "bigint" || typeof item === "function" || typeof item === "symbol") {
        throw new TypeError(`${name} must contain JSON-safe values`);
      }
      result[key] = canonicalJsonValue(item, name);
    }
    return result;
  }
  throw new TypeError(`${name} must contain JSON-safe values`);
}

function timestampString(value, name) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed.toISOString();
}

function businessDateString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw new TypeError("businessDate must be an ISO date");
  }
  return text;
}

function normalizedEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Staging outbox event must be an object");
  }
  return {
    id: nonEmptyString(input.id, "id"),
    tenantId: nonEmptyString(input.tenantId, "tenantId"),
    eventType: nonEmptyString(input.eventType, "eventType"),
    aggregateType: nonEmptyString(input.aggregateType, "aggregateType"),
    aggregateId: nonEmptyString(input.aggregateId, "aggregateId"),
    schemaVersion: nonEmptyString(input.schemaVersion, "schemaVersion"),
    payload: canonicalJsonValue(input.payload, "payload"),
    metadata: canonicalJsonValue(input.metadata, "metadata"),
    correlationId: nonEmptyString(input.correlationId, "correlationId"),
    causationId: optionalString(input.causationId, "causationId"),
    occurredAt: timestampString(input.occurredAt, "occurredAt"),
    businessDate: businessDateString(input.businessDate),
  };
}

function claimedEvent(input) {
  const envelope = normalizedEnvelope(input);
  return Object.freeze({
    ...envelope,
    attempt: boundedInteger(input.attempt, "attempt", 1, Number.MAX_SAFE_INTEGER),
  });
}

export function canonicalOutboxEnvelopeDigest(input) {
  const canonical = normalizedEnvelope(input);
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

const CLAIM_SQL = `
/* staging-outbox:claim */
WITH candidates AS (
  SELECT outbox.id, outbox.tenant_id
  FROM platform.outbox_events AS outbox
  WHERE outbox.tenant_id IN (
    SELECT tenant.id
    FROM platform.tenants AS tenant
    WHERE tenant.code LIKE 'synthetic-%'
  )
    AND outbox.published_at IS NULL
    AND (outbox.next_attempt_at IS NULL OR outbox.next_attempt_at <= clock_timestamp())
    AND outbox.attempts < $3
  ORDER BY outbox.occurred_at, outbox.id
  FOR UPDATE SKIP LOCKED
  LIMIT $1
), claimed AS (
  UPDATE platform.outbox_events AS outbox
  SET attempts = outbox.attempts + 1,
      next_attempt_at = clock_timestamp() + ($2 * interval '1 second'),
      last_error = NULL
  FROM candidates
  WHERE outbox.id = candidates.id
    AND outbox.tenant_id = candidates.tenant_id
  RETURNING
    outbox.id,
    outbox.tenant_id,
    outbox.event_type,
    outbox.aggregate_type,
    outbox.aggregate_id,
    outbox.schema_version,
    outbox.payload,
    outbox.metadata,
    outbox.correlation_id,
    outbox.causation_id,
    outbox.occurred_at,
    outbox.business_date,
    outbox.attempts
)
SELECT *
FROM claimed
ORDER BY occurred_at, id
`;

export async function claimSyntheticOutboxBatch(client, options = {}) {
  requireQueryClient(client);
  const batchSize = boundedInteger(
    options.batchSize ?? STAGING_OUTBOX_LIMITS.batchSize,
    "batchSize",
    1,
    STAGING_OUTBOX_LIMITS.maxBatchSize,
  );
  const leaseSeconds = boundedInteger(
    options.leaseSeconds ?? STAGING_OUTBOX_LIMITS.leaseSeconds,
    "leaseSeconds",
    1,
    3600,
  );
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? STAGING_OUTBOX_LIMITS.maxAttempts,
    "maxAttempts",
    1,
    100,
  );
  const result = await client.query(CLAIM_SQL, [batchSize, leaseSeconds, maxAttempts]);
  if (!result || !Array.isArray(result.rows)) {
    throw new Error("Staging outbox claim did not return rows");
  }
  return result.rows.map((row) => claimedEvent({
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    schemaVersion: row.schema_version,
    payload: row.payload,
    metadata: row.metadata,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: row.occurred_at,
    businessDate: row.business_date,
    attempt: databaseInteger(row.attempts, "attempts"),
  }));
}

const RECEIPT_SQL = `
/* staging-outbox:receipt */
INSERT INTO platform.inbox_receipts AS receipt (
  tenant_id,
  consumer_name,
  event_id,
  payload_hash,
  status,
  attempts,
  first_received_at,
  completed_at,
  last_error
) VALUES (
  $1,
  $2,
  $3,
  $4,
  'completed',
  1,
  clock_timestamp(),
  clock_timestamp(),
  NULL
)
ON CONFLICT (tenant_id, consumer_name, event_id) DO UPDATE
SET status = 'completed',
    attempts = receipt.attempts + 1,
    completed_at = COALESCE(receipt.completed_at, clock_timestamp()),
    last_error = NULL
WHERE receipt.payload_hash = EXCLUDED.payload_hash
RETURNING payload_hash, status, attempts
`;

export async function recordSyntheticOutboxReceipt(client, input) {
  requireQueryClient(client);
  const envelope = claimedEvent(input);
  const digest = canonicalOutboxEnvelopeDigest(envelope);
  const result = await client.query(RECEIPT_SQL, [
    envelope.tenantId,
    STAGING_OUTBOX_CONSUMER,
    envelope.id,
    digest,
  ]);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("staging outbox receipt hash conflict");
  }
  const row = result.rows[0];
  if (row.payload_hash !== digest || row.status !== "completed") {
    throw new Error("staging outbox receipt hash conflict");
  }
  const receiptAttempts = databaseInteger(row.attempts, "receipt attempts");
  return Object.freeze({
    delivered: receiptAttempts === 1,
    replayed: receiptAttempts > 1,
    receiptAttempts,
  });
}

const ACKNOWLEDGE_SQL = `
/* staging-outbox:ack */
UPDATE platform.outbox_events AS outbox
SET published_at = clock_timestamp(),
    next_attempt_at = NULL,
    last_error = NULL
WHERE outbox.tenant_id = $1
  AND outbox.id = $2
  AND outbox.attempts = $3
  AND outbox.published_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM platform.tenants AS tenant
    WHERE tenant.id = outbox.tenant_id
      AND tenant.code LIKE 'synthetic-%'
  )
RETURNING published_at
`;

export async function markSyntheticOutboxPublished(client, input) {
  requireQueryClient(client);
  const current = claimedEvent(input);
  const result = await client.query(ACKNOWLEDGE_SQL, [current.tenantId, current.id, current.attempt]);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("stale staging outbox acknowledgement");
  }
  return Object.freeze({ published: true });
}

const RETRY_SQL = `
/* staging-outbox:retry */
UPDATE platform.outbox_events AS outbox
SET last_error = $4,
    next_attempt_at = clock_timestamp() + ($5 * interval '1 second')
WHERE outbox.tenant_id = $1
  AND outbox.id = $2
  AND outbox.attempts = $3
  AND outbox.published_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM platform.tenants AS tenant
    WHERE tenant.id = outbox.tenant_id
      AND tenant.code LIKE 'synthetic-%'
  )
RETURNING next_attempt_at
`;

export async function scheduleSyntheticOutboxRetry(client, input, errorCategory) {
  requireQueryClient(client);
  const current = claimedEvent(input);
  if (!SAFE_ERROR_CATEGORIES.has(errorCategory)) {
    throw new TypeError("Unsupported staging outbox error category");
  }
  const retrySeconds = Math.min(
    STAGING_OUTBOX_LIMITS.retryBaseSeconds * (2 ** (current.attempt - 1)),
    STAGING_OUTBOX_LIMITS.retryMaxSeconds,
  );
  const result = await client.query(RETRY_SQL, [
    current.tenantId,
    current.id,
    current.attempt,
    errorCategory,
    retrySeconds,
  ]);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("stale staging outbox retry");
  }
  return Object.freeze({ scheduled: true, retrySeconds });
}

const BACKLOG_SQL = `
/* staging-outbox:backlog */
WITH synthetic_tenants AS (
  SELECT tenant.id
  FROM platform.tenants AS tenant
  WHERE tenant.code LIKE 'synthetic-%'
)
SELECT
  count(*)::bigint AS remaining,
  count(*) FILTER (WHERE outbox.attempts >= $1)::bigint AS exhausted,
  COALESCE(
    GREATEST(
      floor(EXTRACT(EPOCH FROM (clock_timestamp() - min(outbox.occurred_at))))::bigint,
      0::bigint
    ),
    0::bigint
  ) AS oldest_seconds
FROM platform.outbox_events AS outbox
WHERE outbox.tenant_id IN (SELECT id FROM synthetic_tenants)
  AND outbox.published_at IS NULL
`;

export async function inspectSyntheticOutboxBacklog(client, options = {}) {
  requireQueryClient(client);
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? STAGING_OUTBOX_LIMITS.maxAttempts,
    "maxAttempts",
    1,
    100,
  );
  const result = await client.query(BACKLOG_SQL, [maxAttempts]);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("Staging outbox backlog inspection did not return one aggregate row");
  }
  const row = result.rows[0];
  return Object.freeze({
    remaining: databaseInteger(row.remaining, "remaining"),
    exhausted: databaseInteger(row.exhausted, "exhausted"),
    oldestSeconds: databaseInteger(row.oldest_seconds, "oldest seconds"),
  });
}

export async function drainSyntheticOutbox(client, options = {}) {
  const batchSize = boundedInteger(
    options.batchSize ?? STAGING_OUTBOX_LIMITS.batchSize,
    "batchSize",
    1,
    STAGING_OUTBOX_LIMITS.maxBatchSize,
  );
  const maxEvents = boundedInteger(
    options.maxEvents ?? STAGING_OUTBOX_LIMITS.maxEventsPerRun,
    "maxEvents",
    1,
    STAGING_OUTBOX_LIMITS.maxEventsPerRun,
  );
  const leaseSeconds = boundedInteger(
    options.leaseSeconds ?? STAGING_OUTBOX_LIMITS.leaseSeconds,
    "leaseSeconds",
    1,
    3600,
  );
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? STAGING_OUTBOX_LIMITS.maxAttempts,
    "maxAttempts",
    1,
    100,
  );
  const claim = options.claim ?? claimSyntheticOutboxBatch;
  const deliver = options.deliver ?? recordSyntheticOutboxReceipt;
  const acknowledge = options.acknowledge ?? markSyntheticOutboxPublished;
  const retry = options.retry ?? scheduleSyntheticOutboxRetry;
  const inspect = options.inspect ?? inspectSyntheticOutboxBacklog;
  for (const [name, operation] of Object.entries({ claim, deliver, acknowledge, retry, inspect })) {
    if (typeof operation !== "function") throw new TypeError(`${name} must be a function`);
  }

  let batches = 0;
  let claimed = 0;
  let delivered = 0;
  let replayed = 0;
  let failed = 0;

  while (claimed < maxEvents) {
    const requested = Math.min(batchSize, maxEvents - claimed);
    const batch = await claim(client, { batchSize: requested, leaseSeconds, maxAttempts });
    if (!Array.isArray(batch)) throw new Error("Staging outbox claim must return an array");
    if (batch.length > requested) throw new Error("Staging outbox claim exceeded its requested batch size");
    if (batch.length === 0) break;
    batches += 1;

    for (const current of batch) {
      claimed += 1;
      try {
        const receipt = await deliver(client, current);
        if (!receipt || (receipt.delivered !== true && receipt.replayed !== true)) {
          throw new Error("Staging outbox consumer did not confirm delivery");
        }
        await acknowledge(client, current);
        delivered += receipt.delivered === true ? 1 : 0;
        replayed += receipt.replayed === true ? 1 : 0;
      } catch {
        failed += 1;
        try {
          await retry(client, current, "delivery_failed");
        } catch {
          // The bounded summary and post-drain backlog still fail the operability gate.
        }
      }
    }
  }

  const backlog = await inspect(client, { maxAttempts });
  return Object.freeze({
    schemaVersion: 1,
    consumer: STAGING_OUTBOX_CONSUMER,
    batches,
    claimed,
    delivered,
    replayed,
    failed,
    remaining: databaseInteger(backlog.remaining, "remaining"),
    exhausted: databaseInteger(backlog.exhausted, "exhausted"),
    oldestUnpublishedSeconds: databaseInteger(backlog.oldestSeconds, "oldest unpublished seconds"),
    payloadsPersistedInArtifacts: false,
    externalDelivery: false,
  });
}
