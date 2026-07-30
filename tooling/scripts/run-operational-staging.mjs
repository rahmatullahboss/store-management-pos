import { spawn } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import { drainSyntheticOutbox } from "./staging-outbox-publisher.mjs";
import {
  collectStagingDatabaseSignals,
  deriveStagingOperabilitySignals,
  evaluateStagingOperability,
} from "./staging-operability.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const seedPath = path.join(root, "tooling", "fixtures", "staging-operational-seed.sql");
const deployPath = path.join(root, "tooling", "scripts", "deploy-custom-auth-staging.mjs");
const operabilityReportPath = path.join(root, "artifacts", "staging", "persistent-staging-report.json");
const operabilityReportTemporaryPath = path.join(root, "artifacts", "staging", "persistent-staging-report.json.tmp");
const projectId = "morning-flower-46531465";
const branchId = "br-empty-sound-afkx5vkj";
const databaseName = "neondb";
const roleName = "neondb_owner";
const { NEON_API_KEY } = process.env;
const expected = {
  products: 5,
  variants: 5,
  suppliers: 3,
  purchase_orders: 3,
  customers: 4,
  sales_orders: 3,
  ledger_entries: 5,
  stock_balances: 5,
};

if (!NEON_API_KEY) throw new Error("NEON_API_KEY is required");

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function connectionString() {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${NEON_API_KEY}` } },
  );
  const body = await response.json();
  if (!response.ok || typeof body?.uri !== "string") {
    throw new Error(`Operational staging connection failed with HTTP ${response.status}`);
  }
  return body.uri;
}

async function evidence(client) {
  const result = await client.query(`
    WITH ledger AS (
      SELECT variant_id,
             sum(quantity_amount)::numeric AS quantity_amount,
             sum(coalesce(value_delta_minor, 0))::numeric AS value_minor
      FROM inventory.stock_ledger_entries
      WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid
        AND source_document_type = 'staging_seed'
      GROUP BY variant_id
    ), balances AS (
      SELECT variant_id,
             sum(quantity_amount)::numeric AS quantity_amount,
             sum(value_minor)::numeric AS value_minor
      FROM inventory.stock_balances
      WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid
        AND warehouse_id = '018f0000-0000-7000-8000-000000000402'::uuid
      GROUP BY variant_id
    )
    SELECT
      (SELECT count(*)::int FROM catalog.products WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND code LIKE 'DEMO-%') AS products,
      (SELECT count(*)::int FROM catalog.variants WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND sku IN ('TSHIRT-NAVY-M','RICE-AROMA-5KG','HEADPHONE-BLK','BAG-OLIVE','PAPER-80')) AS variants,
      (SELECT count(*)::int FROM procurement.suppliers WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND code LIKE 'SUP-%') AS suppliers,
      (SELECT count(*)::int FROM procurement.purchase_orders WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND order_number LIKE 'PO-STG-%') AS purchase_orders,
      (SELECT count(*)::int FROM customer.customers WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND id::text LIKE '018f1000-%') AS customers,
      (SELECT count(*)::int FROM sales.orders WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND document_number LIKE 'SO-STG-%') AS sales_orders,
      (SELECT count(*)::int FROM inventory.stock_ledger_entries WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND source_document_type = 'staging_seed') AS ledger_entries,
      (SELECT count(*)::int FROM inventory.stock_balances WHERE tenant_id = '018f0000-0000-7000-8000-000000000002'::uuid AND warehouse_id = '018f0000-0000-7000-8000-000000000402'::uuid) AS stock_balances,
      NOT EXISTS (
        SELECT 1
        FROM ledger
        FULL JOIN balances USING (variant_id)
        WHERE ledger.quantity_amount IS DISTINCT FROM balances.quantity_amount
           OR ledger.value_minor IS DISTINCT FROM balances.value_minor
      ) AS inventory_reconciled
  `);
  return result.rows[0] ?? {};
}

function countState(row) {
  const counts = Object.keys(expected).map((key) => Number(row[key] ?? 0));
  const complete = Object.entries(expected).every(
    ([key, value]) => Number(row[key] ?? 0) === value,
  );
  const empty = counts.every((value) => value === 0);
  return { complete, empty };
}

function verify(row) {
  for (const [key, value] of Object.entries(expected)) {
    if (Number(row[key] ?? 0) !== value) {
      throw new Error(`Operational staging ${key} verification failed`);
    }
  }
  if (row.inventory_reconciled !== true) {
    throw new Error("Operational staging inventory ledger reconciliation failed");
  }
}

async function loadAndVerify(uri) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('store-management-staging-operational-loader-v1'))");
    const before = await evidence(client);
    const state = countState(before);
    if (state.complete) {
      verify(before);
      console.log("operational staging dataset already complete; immutable seed replay skipped");
      return;
    }
    if (!state.empty) {
      throw new Error("Operational staging dataset is partial; refusing an unsafe immutable seed replay");
    }
    const seedSql = await readFile(seedPath, "utf8");
    await client.query(seedSql);
    const after = await evidence(client);
    verify(after);
    console.log("operational staging seed and inventory reconciliation passed");
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('store-management-staging-operational-loader-v1'))");
    } catch {
      // Connection close releases the lock if the unlock cannot be observed.
    }
    await client.end();
  }
}

async function persistOperabilityEvidence(uri) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  let databaseSignals;
  let outboxPublisher;
  try {
    outboxPublisher = await drainSyntheticOutbox(client);
    databaseSignals = await collectStagingDatabaseSignals(client);
  } finally {
    await client.end();
  }

  const report = JSON.parse(await readFile(operabilityReportPath, "utf8"));
  const reportWithPublisher = { ...report, outboxPublisher };
  const signals = deriveStagingOperabilitySignals(reportWithPublisher, databaseSignals);
  const operability = evaluateStagingOperability(signals);
  const enrichedReport = {
    ...reportWithPublisher,
    schemaVersion: 7,
    operability,
  };
  try {
    await writeFile(
      operabilityReportTemporaryPath,
      `${JSON.stringify(enrichedReport, null, 2)}\n`,
      "utf8",
    );
    await rename(operabilityReportTemporaryPath, operabilityReportPath);
  } catch (error) {
    await rm(operabilityReportTemporaryPath, { force: true });
    throw error;
  }

  if (operability.launchGate === "blocked") {
    const alertIds = operability.alerts
      .filter((alert) => alert.severity === "critical")
      .map((alert) => alert.alertId)
      .join(", ");
    throw new Error(`Persistent staging operability gate blocked: ${alertIds}`);
  }
  console.log(
    `persistent staging operability evidence ${operability.status}; launch gate ${operability.launchGate}`,
  );
}

const uri = await connectionString();
await run("npm", ["run", "db:migrate"], {
  ...process.env,
  DATABASE_URL: uri,
  LOAD_SYNTHETIC_SEED: "1",
});
await loadAndVerify(uri);
const originalDeploy = await readFile(deployPath, "utf8");
const legacyRelationList = "'custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits','custom_auth_events'";
const actualRelationList = "'auth_credentials','auth_sessions','auth_rate_limits','auth_events'";
if (!originalDeploy.includes(legacyRelationList)) {
  throw new Error("Custom auth evidence relation patch target is missing");
}
await writeFile(
  deployPath,
  originalDeploy.replace(legacyRelationList, actualRelationList),
  "utf8",
);
process.env.DATABASE_URL = uri;
try {
  await import("./run-custom-auth-staging.mjs");
  await persistOperabilityEvidence(uri);
} finally {
  delete process.env.DATABASE_URL;
  await writeFile(deployPath, originalDeploy, "utf8");
}
