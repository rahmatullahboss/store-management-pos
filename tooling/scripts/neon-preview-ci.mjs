import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { neon, Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";
import { discoverMigrationManifests } from "./migration-manifests.mjs";

const { NEON_API_KEY, NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID, GITHUB_HEAD_REF, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
if (!NEON_API_KEY || !NEON_PROJECT_ID || !NEON_PARENT_BRANCH_ID) {
  throw new Error("NEON_API_KEY, NEON_PROJECT_ID and NEON_PARENT_BRANCH_ID are required for preview CI");
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "foundation");
const benchmarkReportPath = path.join(artifactsDir, "neon-benchmark-report.json");
const lifecycleReportPath = path.join(artifactsDir, "neon-preview-lifecycle.json");
const safeRef = (GITHUB_HEAD_REF || "manual").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 36);
const branchName = `preview/pr-${safeRef}-${GITHUB_RUN_ID || Date.now()}`;
const apiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const headers = { Authorization: `Bearer ${NEON_API_KEY}`, "Content-Type": "application/json" };

async function api(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Neon API ${response.status}: ${text}`);
  return payload;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cleanupStalePreviewBranches() {
  const response = await api("/branches");
  const branches = Array.isArray(response?.branches) ? response.branches : [];
  const stale = branches.filter((branch) => typeof branch?.name === "string" && branch.name.startsWith("preview/pr-") && branch.id !== NEON_PARENT_BRANCH_ID);
  for (const branch of stale) {
    await api(`/branches/${encodeURIComponent(branch.id)}`, { method: "DELETE" });
    console.log(`deleted stale Neon preview branch ${branch.name}`);
  }
}

async function waitForEndpointIdle(endpointId) {
  const started = Date.now();
  const timeoutMs = 420_000;
  while (Date.now() - started < timeoutMs) {
    const response = await api(`/endpoints/${encodeURIComponent(endpointId)}`);
    const endpoint = response.endpoint || response;
    if (endpoint.current_state === "idle") return new Date().toISOString();
    await sleep(10_000);
  }
  throw new Error(`Neon endpoint ${endpointId} did not scale to zero within ${timeoutMs}ms`);
}

await mkdir(artifactsDir, { recursive: true });
let branchId;
let endpointId;
let initialConnectMs = null;
let coldWakeMs = null;
let idleObservedAt = null;
let cleanupDeleted = false;
let status = "failed";
let failure = null;
let migrationIds = [];

try {
  await cleanupStalePreviewBranches();
  const created = await api("/branches", {
    method: "POST",
    body: JSON.stringify({
      branch: { name: branchName, parent_id: NEON_PARENT_BRANCH_ID },
      endpoints: [{ type: "read_write" }]
    })
  });
  branchId = created.branch.id;
  endpointId = created.endpoints?.[0]?.id;
  if (!endpointId) throw new Error("Neon API did not return a preview endpoint ID");

  const uriResponse = await api(`/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=neondb&role_name=neondb_owner`);
  const connectionString = uriResponse.uri;
  if (typeof connectionString !== "string") throw new Error("Neon API did not return a connection URI");

  const manifests = await discoverMigrationManifests(root);
  migrationIds = manifests.flatMap((manifest) => manifest.migrations.map((migration) => migration.id));
  const client = new Client({ connectionString });
  const connectStarted = performance.now();
  await client.connect();
  initialConnectMs = performance.now() - connectStarted;
  try {
    for (const manifest of manifests) {
      for (const migration of manifest.migrations) {
        const migrationSql = await readFile(path.join(manifest.migrationsDirectory, migration.file), "utf8");
        const digest = createHash("sha256").update(migrationSql).digest("hex");
        if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match the manifest`);
        await client.query(migrationSql);
      }
    }
    await client.query(await readFile(path.join(root, "database/foundation/seeds/dev.sql"), "utf8"));
  } finally {
    await client.end();
  }

  await run("npm", ["run", "test:integration"], {
    ...process.env,
    DATABASE_URL: connectionString,
    FND_NEON_INTEGRATION: "1",
    MOD_E_NEON_INTEGRATION: "1"
  });

  idleObservedAt = await waitForEndpointIdle(endpointId);
  const coldSql = neon(connectionString);
  const coldStarted = performance.now();
  const coldResult = await coldSql`SELECT 1 AS ok`;
  coldWakeMs = performance.now() - coldStarted;
  if (coldResult[0]?.ok !== 1) throw new Error("Neon cold-wake query did not return the expected result");

  await run("npm", ["run", "benchmark:neon"], {
    ...process.env,
    DATABASE_URL: connectionString,
    BENCHMARK_ITERATIONS: "30",
    BENCHMARK_CONCURRENCY: "20",
    BENCHMARK_INITIAL_CONNECT_MS: String(initialConnectMs),
    BENCHMARK_COLD_WAKE_MS: String(coldWakeMs),
    BENCHMARK_REPORT_PATH: benchmarkReportPath
  });

  status = "passed";
  console.log(`Neon preview branch ${branchName} passed platform migrations, integration, cold-wake and benchmark checks`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (branchId) {
    try {
      await api(`/branches/${encodeURIComponent(branchId)}`, { method: "DELETE" });
      cleanupDeleted = true;
      console.log(`deleted Neon preview branch ${branchName}`);
    } catch (cleanupError) {
      failure = `${failure ? `${failure}; ` : ""}cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      process.exitCode = 1;
    }
  }
  const lifecycle = {
    schemaVersion: 1,
    status,
    generatedAt: new Date().toISOString(),
    gitSha: GITHUB_SHA || null,
    runId: GITHUB_RUN_ID || null,
    projectId: NEON_PROJECT_ID,
    parentBranchId: NEON_PARENT_BRANCH_ID,
    branchName,
    branchId: branchId || null,
    endpointId: endpointId || null,
    migrationIds,
    initialComputeConnectMs: initialConnectMs === null ? null : Number(initialConnectMs.toFixed(2)),
    idleObservedAt,
    coldWakeMs: coldWakeMs === null ? null : Number(coldWakeMs.toFixed(2)),
    cleanupDeleted,
    failure
  };
  await writeFile(lifecycleReportPath, `${JSON.stringify(lifecycle, null, 2)}\n`, "utf8");
}
