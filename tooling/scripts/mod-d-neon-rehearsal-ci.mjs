import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";

const {
  GITHUB_RUN_ID,
  GITHUB_SHA,
  MOD_D_NEON_BRANCH_ID = "br-rapid-river-axoz0rfs",
  NEON_API_KEY,
  NEON_PROJECT_ID = "twilight-boat-26805962",
} = process.env;

if (!NEON_API_KEY) throw new Error("NEON_API_KEY is required for the MOD-D Neon rehearsal");

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDirectory = path.join(root, "artifacts", "mod-d");
const reportPath = path.join(artifactsDirectory, "neon-rehearsal.json");
const apiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const headers = { Authorization: `Bearer ${NEON_API_KEY}`, "Content-Type": "application/json" };

const migrationSources = [
  { name: "FOUNDATION", manifest: "database/foundation/manifest.json" },
  { name: "MOD-A-CATALOG", manifest: "database/migrations/catalog/manifest.json" },
  { name: "MOD-A-PRICING", manifest: "database/migrations/pricing/manifest.json" },
  { name: "MOD-A-TAX", manifest: "database/migrations/tax/manifest.json" },
  { name: "MOD-B-INVENTORY", manifest: "database/modules/inventory/manifest.json" },
  { name: "MOD-B-PROCUREMENT", manifest: "database/modules/procurement/manifest.json" },
  { name: "MOD-C-CUSTOMER", manifest: "database/modules/customer/manifest.json" },
  { name: "MOD-C-SALES", manifest: "database/modules/sales/manifest.json" },
  { name: "MOD-C-FULFILLMENT", manifest: "database/modules/fulfillment/manifest.json" },
  { name: "MOD-E-PAYMENT", manifest: "database/modules/payments/manifest.json" },
  { name: "MOD-E-ACCOUNTING", manifest: "database/modules/accounting/manifest.json" },
  { name: "MOD-E-BANKING", manifest: "database/modules/banking/manifest.json" },
  { name: "MOD-D-POS", manifest: "database/modules/pos/manifest.json" },
  { name: "MOD-D-CASH", manifest: "database/modules/cash/manifest.json" },
];

async function api(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, { headers });
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

async function expectedMigrationIds() {
  const ids = [];
  for (const source of migrationSources) {
    const manifest = JSON.parse(await readFile(path.join(root, source.manifest), "utf8"));
    if (manifest.module !== source.name) throw new Error(`${source.manifest} module identity does not match ${source.name}`);
    ids.push(...manifest.migrations.map((migration) => migration.id));
  }
  return ids;
}

await mkdir(artifactsDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  status: "failed",
  generatedAt: new Date().toISOString(),
  gitSha: GITHUB_SHA || null,
  runId: GITHUB_RUN_ID || null,
  projectId: NEON_PROJECT_ID,
  branchId: MOD_D_NEON_BRANCH_ID,
  migrationIds: [],
  forcedRlsTables: 0,
  runtimeWriteGrants: 0,
  failure: null,
};

try {
  const branchResponse = await api(`/branches/${encodeURIComponent(MOD_D_NEON_BRANCH_ID)}`);
  const branch = branchResponse.branch || branchResponse;
  if (branch.name !== "dev/module-pos-cash-offline") {
    throw new Error(`MOD-D branch identity mismatch: ${branch.name || "unknown"}`);
  }
  if (branch.default || branch.primary || !branch.parent_id) {
    throw new Error("MOD-D rehearsal branch must be an isolated non-default child branch");
  }

  const uriResponse = await api(`/connection_uri?branch_id=${encodeURIComponent(MOD_D_NEON_BRANCH_ID)}&database_name=neondb&role_name=neondb_owner`);
  const connectionString = uriResponse.uri;
  if (typeof connectionString !== "string") throw new Error("Neon API did not return a MOD-D connection URI");

  await run("node", ["tooling/scripts/apply-migrations.mjs"], {
    ...process.env,
    DATABASE_URL: connectionString,
    MIGRATION_MODULES: migrationSources.map((source) => source.name).join(","),
  });

  const expectedIds = await expectedMigrationIds();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const applied = await client.query(
      "SELECT migration_id FROM platform.schema_migrations WHERE migration_id = ANY($1::text[]) ORDER BY migration_id",
      [expectedIds],
    );
    const appliedIds = applied.rows.map((row) => row.migration_id);
    const missing = expectedIds.filter((id) => !appliedIds.includes(id));
    if (missing.length > 0) throw new Error(`MOD-D rehearsal is missing migrations: ${missing.join(", ")}`);

    const rls = await client.query(`
      SELECT count(*)::integer AS forced_rls_tables
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('pos','cash')
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND c.relforcerowsecurity
    `);
    const writes = await client.query(`
      SELECT count(*)::integer AS runtime_write_grants
      FROM information_schema.role_table_grants
      WHERE grantee = 'store_app_runtime'
        AND table_schema IN ('pos','cash')
        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')
    `);
    report.migrationIds = appliedIds;
    report.forcedRlsTables = rls.rows[0]?.forced_rls_tables ?? 0;
    report.runtimeWriteGrants = writes.rows[0]?.runtime_write_grants ?? 0;
    if (report.forcedRlsTables === 0) throw new Error("MOD-D rehearsal found no forced-RLS tables");
    if (report.runtimeWriteGrants !== 0) throw new Error("store_app_runtime has direct MOD-D table write grants");
  } finally {
    await client.end();
  }

  report.status = "passed";
  console.log(`MOD-D Neon rehearsal passed on ${MOD_D_NEON_BRANCH_ID}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  report.generatedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
