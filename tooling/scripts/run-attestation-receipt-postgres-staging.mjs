import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import {
  runProductionAttestationReceiptPostgresEvidence,
} from "./staging-attestation-receipt-postgres-evidence.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactPath = path.join(
  root,
  "artifacts",
  "staging",
  "attestation-receipt-postgres.json",
);
const projectId = "morning-flower-46531465";
const branchId = "br-empty-sound-afkx5vkj";
const databaseName = "neondb";
const roleName = "neondb_owner";
const { NEON_API_KEY, GITHUB_RUN_ID } = process.env;

async function inspectMetadataSizeCatalog(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const functions = await client.query(`
      SELECT
        p.oid::regprocedure::text AS identity,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE (n.nspname = 'pg_catalog' AND p.proname IN (
          'jsonb_object_length',
          'jsonb_object_keys',
          'jsonb_array_length'
        ))
         OR (n.nspname = 'platform' AND p.proname IN (
          'enforce_metadata_size_limit',
          'jsonb_object_length'
        ))
      ORDER BY identity`);
    const triggers = await client.query(`
      SELECT
        trigger_table.oid::regclass::text AS table_identity,
        pg_get_triggerdef(trigger_row.oid, true) AS definition
      FROM pg_trigger AS trigger_row
      JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
      JOIN pg_namespace AS function_namespace
        ON function_namespace.oid = trigger_function.pronamespace
      JOIN pg_class AS trigger_table ON trigger_table.oid = trigger_row.tgrelid
      WHERE NOT trigger_row.tgisinternal
        AND function_namespace.nspname = 'platform'
        AND trigger_function.proname = 'enforce_metadata_size_limit'
      ORDER BY table_identity, definition`);
    console.log(
      `metadata size compatibility catalog ${JSON.stringify({
        functions: functions.rows,
        triggers: triggers.rows,
      })}`,
    );
  } finally {
    await client.end();
  }
}

if (!NEON_API_KEY) {
  throw new Error("NEON_API_KEY is required for attestation receipt Postgres evidence");
}

const response = await fetch(
  `https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`,
  { headers: { Authorization: `Bearer ${NEON_API_KEY}` } },
);
const body = await response.json();
if (!response.ok || typeof body?.uri !== "string") {
  throw new Error(
    `Attestation receipt Postgres connection failed with HTTP ${response.status}`,
  );
}

await inspectMetadataSizeCatalog(body.uri);
const report = await runProductionAttestationReceiptPostgresEvidence({
  connectionString: body.uri,
  runId: GITHUB_RUN_ID,
});
await mkdir(path.dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `production attestation receipt Postgres evidence ${report.status}; transaction rollback verified`,
);
