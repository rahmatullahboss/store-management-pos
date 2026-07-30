import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const root = fileURLToPath(new URL("../..", import.meta.url));
const seedPath = path.join(root, "tooling", "fixtures", "staging-operational-seed.sql");
const projectId = "morning-flower-46531465";
const branchId = "br-empty-sound-afkx5vkj";
const databaseName = "neondb";
const roleName = "neondb_owner";
const { NEON_API_KEY } = process.env;

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

async function loadAndVerify(uri) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const seedSql = await readFile(seedPath, "utf8");
    await client.query(seedSql);
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
    const evidence = result.rows[0];
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
    for (const [key, value] of Object.entries(expected)) {
      if (Number(evidence?.[key]) !== value) {
        throw new Error(`Operational staging ${key} verification failed`);
      }
    }
    if (evidence?.inventory_reconciled !== true) {
      throw new Error("Operational staging inventory ledger reconciliation failed");
    }
    console.log("operational staging seed and inventory reconciliation passed");
  } finally {
    await client.end();
  }
}

const uri = await connectionString();
await run("npm", ["run", "db:migrate"], {
  ...process.env,
  DATABASE_URL: uri,
  LOAD_SYNTHETIC_SEED: "1",
});
await loadAndVerify(uri);
await import("./run-custom-auth-staging.mjs");
