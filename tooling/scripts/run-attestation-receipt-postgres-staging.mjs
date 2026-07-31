import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const report = await runProductionAttestationReceiptPostgresEvidence({
  connectionString: body.uri,
  runId: GITHUB_RUN_ID,
});
await mkdir(path.dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `production attestation receipt Postgres evidence ${report.status}; transaction rollback verified`,
);
