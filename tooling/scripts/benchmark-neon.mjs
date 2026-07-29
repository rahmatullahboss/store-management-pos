import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { neon, Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 30);
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? 20);
const websocketRetryLimit = Number(process.env.BENCHMARK_WEBSOCKET_RETRIES ?? 2);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 200) {
  throw new Error("BENCHMARK_ITERATIONS must be an integer from 10 to 200");
}
if (!Number.isInteger(concurrency) || concurrency < 2 || concurrency > 50) {
  throw new Error("BENCHMARK_CONCURRENCY must be an integer from 2 to 50");
}
if (!Number.isInteger(websocketRetryLimit) || websocketRetryLimit < 0 || websocketRetryLimit > 5) {
  throw new Error("BENCHMARK_WEBSOCKET_RETRIES must be an integer from 0 to 5");
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const reportPath = process.env.BENCHMARK_REPORT_PATH || path.join(root, "artifacts", "foundation", "neon-benchmark-report.json");
let websocketRetryCount = 0;

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summary(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minMs: Number(Math.min(...values).toFixed(2)),
    meanMs: Number((total / values.length).toFixed(2)),
    p50Ms: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
    p99Ms: Number(percentile(values, 0.99).toFixed(2)),
    maxMs: Number(Math.max(...values).toFixed(2))
  };
}

async function measure(work) {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /connection terminated unexpectedly|econnreset|socket hang up|websocket.*closed|fetch failed/i.test(message);
}

async function websocketTransaction() {
  let lastError = null;
  for (let attempt = 0; attempt <= websocketRetryLimit; attempt += 1) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query("BEGIN");
      await client.query("SELECT 1");
      await client.query("COMMIT");
      return;
    } catch (error) {
      lastError = error;
      await client.query("ROLLBACK").catch(() => undefined);
      if (!isTransientConnectionError(error) || attempt === websocketRetryLimit) throw error;
      websocketRetryCount += 1;
      console.warn(`retrying transient Neon websocket benchmark failure (${attempt + 1}/${websocketRetryLimit})`);
      await sleep(250 * (attempt + 1));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw lastError || new Error("Neon websocket transaction failed without an error");
}

const sql = neon(connectionString);
await sql`SELECT 1 AS warmup`;

const serverRows = await sql`
  SELECT
    current_setting('server_version') AS server_version,
    current_setting('server_version_num') AS server_version_num,
    pg_postmaster_start_time()::text AS postmaster_started_at,
    now()::text AS observed_at
`;

const httpOneShot = [];
const httpBatch = [];
const websocketSequential = [];
for (let index = 0; index < iterations; index += 1) {
  httpOneShot.push(await measure(async () => { await sql`SELECT 1 AS ok`; }));
  httpBatch.push(await measure(async () => {
    await sql.transaction([sql`SELECT 1 AS first`, sql`SELECT 2 AS second`]);
  }));
  websocketSequential.push(await measure(websocketTransaction));
}

const httpConcurrentValues = await Promise.all(Array.from({ length: concurrency }, () => measure(async () => {
  await sql`SELECT pg_sleep(0), 1 AS ok`;
})));
const websocketConcurrency = Math.min(concurrency, 10);
const websocketConcurrentValues = await Promise.all(Array.from({ length: websocketConcurrency }, () => measure(websocketTransaction)));

const rollbackClient = new Client({ connectionString });
await rollbackClient.connect();
let rollbackRecoveryMs;
try {
  const started = performance.now();
  await rollbackClient.query("BEGIN");
  try {
    await rollbackClient.query("SELECT 1 / 0");
    throw new Error("intentional failure did not fail");
  } catch {
    await rollbackClient.query("ROLLBACK");
  }
  const recovery = await rollbackClient.query("SELECT 1 AS ok");
  if (recovery.rows[0]?.ok !== 1) throw new Error("connection did not recover after rollback");
  rollbackRecoveryMs = performance.now() - started;
} finally {
  await rollbackClient.end();
}

const initialConnectMs = Number(process.env.BENCHMARK_INITIAL_CONNECT_MS || "NaN");
const coldWakeMs = Number(process.env.BENCHMARK_COLD_WAKE_MS || "NaN");
const result = {
  schemaVersion: 2,
  status: "passed",
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  iterations,
  concurrency,
  initialComputeConnectMs: Number.isFinite(initialConnectMs) ? Number(initialConnectMs.toFixed(2)) : null,
  coldWake: Number.isFinite(coldWakeMs) ? {
    kind: "scale-to-zero",
    firstQueryMs: Number(coldWakeMs.toFixed(2))
  } : null,
  websocketResilience: {
    retryLimit: websocketRetryLimit,
    retriesUsed: websocketRetryCount
  },
  sequential: {
    httpOneShot: summary(httpOneShot),
    httpBatch: summary(httpBatch),
    websocketTransaction: summary(websocketSequential)
  },
  concurrent: {
    httpOneShot: summary(httpConcurrentValues),
    websocketTransaction: summary(websocketConcurrentValues)
  },
  rollbackRecovery: {
    passed: true,
    elapsedMs: Number(rollbackRecoveryMs.toFixed(2))
  },
  server: serverRows[0]
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
