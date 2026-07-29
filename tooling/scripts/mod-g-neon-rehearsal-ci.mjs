import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";

const {
  GITHUB_RUN_ID,
  GITHUB_SHA,
  MOD_G_NEON_BRANCH_ID = "br-mute-band-axbhmsky",
  NEON_API_KEY,
  NEON_PROJECT_ID = "twilight-boat-26805962",
} = process.env;

if (!NEON_API_KEY) throw new Error("NEON_API_KEY is required for the MOD-G Neon rehearsal");

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDirectory = path.join(root, "artifacts", "mod-g");
const reportPath = path.join(artifactsDirectory, "neon-rehearsal.json");
const apiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const headers = { Authorization: `Bearer ${NEON_API_KEY}`, "Content-Type": "application/json" };
const advisoryLockName = `store-management-pos:mod-g-neon-rehearsal:${NEON_PROJECT_ID}:${MOD_G_NEON_BRANCH_ID}`;

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
  { name: "MOD-F-LOCALIZATION", manifest: "database/modules/localization/manifest.json" },
  { name: "MOD-G-REPORTING", manifest: "database/modules/reporting/manifest.json" },
  { name: "MOD-G-INTEGRATION", manifest: "database/modules/integrations/manifest.json" },
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
  branchId: MOD_G_NEON_BRANCH_ID,
  advisoryLockName,
  advisoryLockAcquired: false,
  migrationIds: [],
  reportingTables: 0,
  integrationTables: 0,
  forcedRlsTables: 0,
  runtimeWriteGrants: 0,
  publicExecuteGrants: 0,
  unsafeCredentialColumns: 0,
  failure: null,
};

let client;
let advisoryLockAcquired = false;

try {
  const branchResponse = await api(`/branches/${encodeURIComponent(MOD_G_NEON_BRANCH_ID)}`);
  const branch = branchResponse.branch || branchResponse;
  if (branch.name !== "dev/module-reporting-integrations") {
    throw new Error(`MOD-G branch identity mismatch: ${branch.name || "unknown"}`);
  }
  if (branch.default || branch.primary || !branch.parent_id) {
    throw new Error("MOD-G rehearsal branch must be an isolated non-default child branch");
  }

  const uriResponse = await api(`/connection_uri?branch_id=${encodeURIComponent(MOD_G_NEON_BRANCH_ID)}&database_name=neondb&role_name=neondb_owner`);
  const connectionString = uriResponse.uri;
  if (typeof connectionString !== "string") throw new Error("Neon API did not return a MOD-G connection URI");

  client = new Client({ connectionString });
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtextextended($1::text, 0))", [advisoryLockName]);
  advisoryLockAcquired = true;
  report.advisoryLockAcquired = true;
  console.log(`acquired MOD-G Neon rehearsal advisory lock ${advisoryLockName}`);

  await run("node", ["tooling/scripts/apply-migrations.mjs"], {
    ...process.env,
    DATABASE_URL: connectionString,
    MIGRATION_MODULES: migrationSources.map((source) => source.name).join(","),
  });

  const expectedIds = await expectedMigrationIds();
  const applied = await client.query(
    "SELECT migration_id FROM platform.schema_migrations WHERE migration_id = ANY($1::text[]) ORDER BY migration_id",
    [expectedIds],
  );
  const appliedIds = applied.rows.map((row) => row.migration_id);
  const missing = expectedIds.filter((id) => !appliedIds.includes(id));
  if (missing.length > 0) throw new Error(`MOD-G rehearsal is missing migrations: ${missing.join(", ")}`);

  const tables = await client.query(`
    SELECT n.nspname AS schema_name, count(*)::integer AS table_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('reporting','integration') AND c.relkind = 'r'
    GROUP BY n.nspname
  `);
  const counts = Object.fromEntries(tables.rows.map((row) => [row.schema_name, row.table_count]));
  const rls = await client.query(`
    SELECT count(*)::integer AS forced_rls_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('reporting','integration')
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  `);
  const writes = await client.query(`
    SELECT count(*)::integer AS runtime_write_grants
    FROM information_schema.role_table_grants
    WHERE grantee = 'store_app_runtime'
      AND table_schema IN ('reporting','integration')
      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')
  `);
  const publicExecution = await client.query(`
    SELECT count(*)::integer AS public_execute_grants
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('reporting','integration')
      AND has_function_privilege('public', p.oid, 'EXECUTE')
  `);
  const unsafeCredentials = await client.query(`
    SELECT count(*)::integer AS unsafe_credential_columns
    FROM information_schema.columns
    WHERE table_schema = 'integration'
      AND column_name ~ '(credential_secret|credential_value|api_key_value|access_token_value|refresh_token_value|password_value)'
  `);

  report.migrationIds = appliedIds;
  report.reportingTables = counts.reporting ?? 0;
  report.integrationTables = counts.integration ?? 0;
  report.forcedRlsTables = rls.rows[0]?.forced_rls_tables ?? 0;
  report.runtimeWriteGrants = writes.rows[0]?.runtime_write_grants ?? 0;
  report.publicExecuteGrants = publicExecution.rows[0]?.public_execute_grants ?? 0;
  report.unsafeCredentialColumns = unsafeCredentials.rows[0]?.unsafe_credential_columns ?? 0;
  const totalTables = report.reportingTables + report.integrationTables;
  if (report.reportingTables === 0 || report.integrationTables === 0) throw new Error("MOD-G rehearsal found no reporting or integration tables");
  if (report.forcedRlsTables !== totalTables) throw new Error("Not every MOD-G table has forced RLS");
  if (report.runtimeWriteGrants !== 0) throw new Error("store_app_runtime has direct MOD-G table write grants");
  if (report.publicExecuteGrants !== 0) throw new Error("PUBLIC execute privilege remains on a MOD-G function");
  if (report.unsafeCredentialColumns !== 0) throw new Error("MOD-G schema contains unsafe credential-value columns");

  report.status = "passed";
  console.log(`MOD-G Neon rehearsal passed on ${MOD_G_NEON_BRANCH_ID}`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (client) {
    if (advisoryLockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", [advisoryLockName]);
        console.log(`released MOD-G Neon rehearsal advisory lock ${advisoryLockName}`);
      } catch (unlockError) {
        const message = unlockError instanceof Error ? unlockError.message : String(unlockError);
        report.failure = `${report.failure ? `${report.failure}; ` : ""}advisory unlock: ${message}`;
        process.exitCode = 1;
      }
    }
    await client.end().catch((endError) => {
      const message = endError instanceof Error ? endError.message : String(endError);
      report.failure = `${report.failure ? `${report.failure}; ` : ""}client close: ${message}`;
      process.exitCode = 1;
    });
  }
  report.generatedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
