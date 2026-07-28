import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";
import { discoverMigrationManifests } from "./migration-manifests.mjs";

const { NEON_API_KEY, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
if (!NEON_API_KEY) throw new Error("NEON_API_KEY is required for the Neon recovery drill");

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "foundation");
const reportPath = path.join(artifactsDir, "neon-recovery-report.json");
const apiBase = "https://console.neon.tech/api/v2";
const headers = { Authorization: `Bearer ${NEON_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
const suffix = String(GITHUB_RUN_ID || Date.now()).replace(/[^0-9]/g, "").slice(-12);
const projectName = `store-pos-fnd-recovery-${suffix}`.slice(0, 64);
const backupBranchName = `before-recovery-${suffix}`.slice(0, 63);
const markerName = `Foundation recovery marker ${suffix}`;
const markerIdempotencyKey = `recovery-${suffix}-marker`;
const markerRequestHash = createHash("sha256").update(markerName).digest("hex");
const markerRequestId = `recovery-${suffix}`;

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function api(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }
  if (!response.ok) throw new Error(`Neon API ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  return payload;
}

async function apiRetry(pathname, init, attempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await api(pathname, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(Math.min(15_000, attempt * 2_000));
    }
  }
  throw lastError;
}

async function connectionUri(projectId, branchId) {
  const response = await apiRetry(`/projects/${encodeURIComponent(projectId)}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=neondb&role_name=neondb_owner`);
  if (typeof response?.uri !== "string") throw new Error("Neon API did not return a recovery connection URI");
  return response.uri;
}

async function connectWithRetry(connectionString, attempts = 30) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      if (attempt === attempts) break;
      await sleep(Math.min(10_000, attempt * 1_000));
    }
  }
  throw lastError;
}

async function applyPlatformMigrations(client) {
  const manifests = await discoverMigrationManifests(root);
  for (const manifest of manifests) {
    for (const migration of manifest.migrations) {
      const migrationSql = await readFile(path.join(manifest.migrationsDirectory, migration.file), "utf8");
      const digest = createHash("sha256").update(migrationSql).digest("hex");
      if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match the manifest`);
      await client.query(migrationSql);
    }
  }
  await client.query(await readFile(path.join(root, "database/foundation/seeds/dev.sql"), "utf8"));
  return manifests.flatMap((manifest) => manifest.migrations.map((migration) => migration.id));
}

async function createRecoveryMarker(client) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE store_app_runtime");
    await client.query(
      "SELECT platform.set_request_context($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,$8)",
      [
        "018f0000-0000-7000-8000-000000000001",
        "018f0000-0000-7000-8000-000000000101",
        "018f0000-0000-7000-8000-000000000201",
        "018f0000-0000-7000-8000-000000000301",
        "018f0000-0000-7000-8000-000000000401",
        "018f0000-0000-7000-8000-000000000501",
        markerRequestId,
        markerRequestId
      ]
    );
    const created = await client.query(
      "SELECT * FROM platform.create_reference_record($1,$2,$3,$4)",
      [markerIdempotencyKey, markerRequestHash, markerName, markerRequestId]
    );
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function recoveryState(client, markerId) {
  await client.query("SET row_security = off");
  const result = await client.query(
    `SELECT
       (SELECT display_name FROM platform.tenants WHERE id = '018f0000-0000-7000-8000-000000000001') AS tenant_display_name,
       (SELECT count(*)::int FROM platform.reference_records WHERE id = $1) AS reference_count,
       (SELECT count(*)::int FROM platform.audit_events WHERE target_id = $1::text AND event_type = 'platform.reference.created.v1') AS audit_count,
       (SELECT count(*)::int FROM platform.outbox_events WHERE aggregate_id = $1::text AND event_type = 'platform.reference.created.v1') AS outbox_count,
       (SELECT count(*)::int FROM platform.idempotency_records WHERE idempotency_key = $2 AND status = 'completed') AS idempotency_count,
       (SELECT array_agg(migration_id ORDER BY migration_id) FROM platform.schema_migrations) AS migration_ids`,
    [markerId, markerIdempotencyKey]
  );
  return result.rows[0];
}

async function waitForRestoredBranches(projectId, rootName, attempts = 60) {
  let lastBranches = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await api(`/projects/${encodeURIComponent(projectId)}/branches`);
    lastBranches = response.branches || [];
    const rootBranch = lastBranches.find((branch) => branch.name === rootName && branch.current_state === "ready");
    const backup = lastBranches.find((branch) => branch.name === backupBranchName);
    if (rootBranch && backup) return { root: rootBranch, backup };
    await sleep(2_000);
  }
  throw new Error(`restored and backup branches did not become ready: ${JSON.stringify(lastBranches.map((branch) => ({ id: branch.id, name: branch.name, state: branch.current_state })))}`);
}

await mkdir(artifactsDir, { recursive: true });
let projectId;
let originalBranchId;
let restoredBranchId;
let backupBranchId;
let markerId;
let checkpointTimestamp;
let initialProjectConnectMs = null;
let cleanupDeleted = false;
let migrationIds = [];
let beforeMutation = null;
let corruptedState = null;
let restoredState = null;
let status = "failed";
let failure = null;

try {
  const created = await api("/projects", {
    method: "POST",
    body: JSON.stringify({
      project: {
        name: projectName,
        region_id: "aws-us-east-2",
        pg_version: 17,
        default_endpoint_settings: {
          autoscaling_limit_min_cu: 0.25,
          autoscaling_limit_max_cu: 0.25,
          suspend_timeout_seconds: 60
        }
      }
    })
  });
  projectId = created.project?.id;
  originalBranchId = created.branch?.id;
  if (!projectId || !originalBranchId) throw new Error("Neon project creation did not return project and root branch IDs");

  const initialUri = created.connection_uris?.[0]?.connection_uri || await connectionUri(projectId, originalBranchId);
  const initialConnectStarted = performance.now();
  let client = await connectWithRetry(initialUri);
  initialProjectConnectMs = performance.now() - initialConnectStarted;
  try {
    migrationIds = await applyPlatformMigrations(client);
    const marker = await createRecoveryMarker(client);
    markerId = marker.id;
    beforeMutation = await recoveryState(client, markerId);
    const checkpoint = await client.query("SELECT clock_timestamp() AS checkpoint_at");
    checkpointTimestamp = new Date(checkpoint.rows[0].checkpoint_at).toISOString();
    await sleep(2_000);

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL row_security = off");
      await client.query("UPDATE platform.tenants SET display_name = 'CORRUPTED DURING RECOVERY DRILL' WHERE id = '018f0000-0000-7000-8000-000000000001'");
      await client.query("DELETE FROM platform.reference_records WHERE id = $1", [markerId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    corruptedState = await recoveryState(client, markerId);
    if (corruptedState.reference_count !== 0 || corruptedState.tenant_display_name !== "CORRUPTED DURING RECOVERY DRILL") {
      throw new Error(`destructive recovery mutation was not observed: ${JSON.stringify(corruptedState)}`);
    }
  } finally {
    await client.end();
  }

  await apiRetry(`/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(originalBranchId)}/restore`, {
    method: "POST",
    body: JSON.stringify({
      source_branch_id: originalBranchId,
      source_timestamp: checkpointTimestamp,
      preserve_under_name: backupBranchName
    })
  });

  const branches = await waitForRestoredBranches(projectId, "main");
  restoredBranchId = branches.root.id;
  backupBranchId = branches.backup.id;
  const restoredUri = await connectionUri(projectId, restoredBranchId);
  client = await connectWithRetry(restoredUri);
  try {
    restoredState = await recoveryState(client, markerId);
  } finally {
    await client.end();
  }

  const exactMigrations = JSON.stringify(restoredState.migration_ids) === JSON.stringify(migrationIds);
  const reconciled = restoredState.tenant_display_name === "Synthetic Alpha Retail"
    && restoredState.reference_count === 1
    && restoredState.audit_count === 1
    && restoredState.outbox_count === 1
    && restoredState.idempotency_count === 1
    && exactMigrations;
  if (!reconciled) throw new Error(`PITR reconciliation failed: ${JSON.stringify(restoredState)}`);

  status = "passed";
  console.log(`Neon PITR recovery drill passed for disposable project ${projectName}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (projectId) {
    try {
      await api(`/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      cleanupDeleted = true;
      console.log(`deleted disposable Neon recovery project ${projectName}`);
    } catch (cleanupError) {
      failure = `${failure ? `${failure}; ` : ""}cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      process.exitCode = 1;
    }
  }

  const report = {
    schemaVersion: 1,
    status,
    generatedAt: new Date().toISOString(),
    gitSha: GITHUB_SHA || null,
    runId: GITHUB_RUN_ID || null,
    projectName,
    projectId: projectId || null,
    originalBranchId: originalBranchId || null,
    restoredBranchId: restoredBranchId || null,
    backupBranchName,
    backupBranchId: backupBranchId || null,
    markerId: markerId || null,
    checkpointTimestamp: checkpointTimestamp || null,
    initialProjectConnectMs: initialProjectConnectMs === null ? null : Number(initialProjectConnectMs.toFixed(2)),
    migrationIds,
    beforeMutation,
    corruptedState,
    restoredState,
    cleanupDeleted,
    failure
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
