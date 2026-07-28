import { neon, Client } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 10);
if (!Number.isInteger(iterations) || iterations < 3 || iterations > 100) throw new Error("BENCHMARK_ITERATIONS must be an integer from 3 to 100");

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
async function measure(work) {
  const start = performance.now();
  await work();
  return performance.now() - start;
}

const sql = neon(connectionString);
const httpOneShot = [];
const httpBatch = [];
const websocketTransaction = [];
for (let index = 0; index < iterations; index += 1) {
  httpOneShot.push(await measure(async () => { await sql`SELECT 1 AS ok`; }));
  httpBatch.push(await measure(async () => {
    await sql.transaction([sql`SELECT 1 AS first`, sql`SELECT 2 AS second`]);
  }));
  websocketTransaction.push(await measure(async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT 1");
      await client.query("COMMIT");
    } finally {
      await client.end();
    }
  }));
}
const result = Object.fromEntries(Object.entries({ httpOneShot, httpBatch, websocketTransaction }).map(([name, values]) => [name, {
  iterations,
  p50Ms: Number(percentile(values, 0.5).toFixed(2)),
  p95Ms: Number(percentile(values, 0.95).toFixed(2)),
  maxMs: Number(Math.max(...values).toFixed(2)),
}]));
console.log(JSON.stringify(result, null, 2));
