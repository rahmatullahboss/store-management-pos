import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client } from "@neondatabase/serverless";

const { NEON_API_KEY, NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID, GITHUB_HEAD_REF, GITHUB_RUN_ID } = process.env;
if (!NEON_API_KEY || !NEON_PROJECT_ID || !NEON_PARENT_BRANCH_ID) {
  throw new Error("NEON_API_KEY, NEON_PROJECT_ID and NEON_PARENT_BRANCH_ID are required for Foundation preview CI");
}
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const safeRef = (GITHUB_HEAD_REF || "manual").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 36);
const branchName = `preview/pr-${safeRef}-${GITHUB_RUN_ID || Date.now()}`;
const apiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const headers = { Authorization: `Bearer ${NEON_API_KEY}`, "Content-Type": "application/json" };
async function api(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, { ...init, headers });
  if (!response.ok) throw new Error(`Neon API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : await response.json();
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve(undefined) : reject(new Error(`${command} exited with ${code}`)));
  });
}
let branchId;
try {
  const created = await api("/branches", { method: "POST", body: JSON.stringify({ branch: { name: branchName, parent_id: NEON_PARENT_BRANCH_ID }, endpoints: [{ type: "read_write" }] }) });
  branchId = created.branch.id;
  const uriResponse = await api(`/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=neondb&role_name=neondb_owner`);
  const connectionString = uriResponse.uri;
  if (typeof connectionString !== "string") throw new Error("Neon API did not return a connection URI");
  const manifest = JSON.parse(await readFile(path.join(root, "database/foundation/manifest.json"), "utf8"));
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const migration of manifest.migrations) {
      const migrationSql = await readFile(path.join(root, "database/foundation/migrations", migration.file), "utf8");
      const digest = createHash("sha256").update(migrationSql).digest("hex");
      if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match the manifest`);
      await client.query(migrationSql);
    }
    await client.query(await readFile(path.join(root, "database/foundation/seeds/dev.sql"), "utf8"));
  } finally {
    await client.end();
  }
  await run("npm", ["run", "test:integration"], { ...process.env, DATABASE_URL: connectionString, FND_NEON_INTEGRATION: "1" });
  await run("npm", ["run", "benchmark:neon"], { ...process.env, DATABASE_URL: connectionString, BENCHMARK_ITERATIONS: "10" });
  console.log(`Neon preview branch ${branchName} passed migrations and integration tests`);
} finally {
  if (branchId) {
    await api(`/branches/${branchId}`, { method: "DELETE" });
    console.log(`deleted Neon preview branch ${branchName}`);
  }
}
