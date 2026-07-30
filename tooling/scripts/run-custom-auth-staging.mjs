import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, neon } from "@neondatabase/serverless";

const root = fileURLToPath(new URL("../..", import.meta.url));
const deployPath = path.join(
  root,
  "tooling",
  "scripts",
  "deploy-custom-auth-staging.mjs",
);
const originalDeploy = await readFile(deployPath, "utf8");
const redactNeedle =
  '.replaceAll(connectionString, "[REDACTED_DATABASE_URL]")';
const mainNeedle = 'main: "apps/api/src/staging.ts"';
const baseUrlNeedle = "  const baseUrl = await resolveWorkerUrl();";
const contextProbeNeedle = `  probes.push(await probe(baseUrl, "/auth/session", '"authenticated":true', 200, authenticated));`;
const scenarioNeedle = `    for (const scenario of [
      {
        id: "admin-inventory-desktop",
        pathname: "/admin/inventory",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },`;
const loginPageNeedle = "    const loginPage = await browser.newPage();";
const sessionPageNeedle = "    const sessionPage = await browser.newPage();";
for (const [label, needle] of [
  ["redaction", redactNeedle],
  ["Worker entry", mainNeedle],
  ["secret upload", baseUrlNeedle],
  ["context probe", contextProbeNeedle],
  ["browser scenarios", scenarioNeedle],
  ["login CSP bypass", loginPageNeedle],
  ["session CSP bypass", sessionPageNeedle],
]) {
  if (!originalDeploy.includes(needle)) {
    throw new Error(`Custom staging ${label} patch target is missing`);
  }
}

const { NEON_API_KEY, GITHUB_RUN_ID } = process.env;
if (!NEON_API_KEY) throw new Error("NEON_API_KEY is required");
const projectId = "morning-flower-46531465";
const branchId = "br-empty-sound-afkx5vkj";
const databaseName = "neondb";
const roleName = "neondb_owner";

async function connectionString() {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${NEON_API_KEY}` } },
  );
  const body = await response.json();
  if (!response.ok || typeof body?.uri !== "string") {
    throw new Error(
      `Custom auth preflight connection failed with HTTP ${response.status}`,
    );
  }
  return body.uri;
}

async function readContextMigrationExists(uri) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT EXISTS(SELECT 1 FROM platform.schema_migrations WHERE migration_id = 'FND-0008') AS exists",
    );
    return result.rows[0]?.exists === true;
  } finally {
    await client.end();
  }
}

async function httpDriverPreflight(uri) {
  const suffix = `${GITHUB_RUN_ID || Date.now()}-${randomBytes(5).toString("hex")}`;
  const email = `staging-http-preflight-${suffix}@example.com`;
  const password = `Preflight-${randomBytes(24).toString("base64url")}!9a`;
  const registerTokenHash = randomBytes(32).toString("base64url");
  const loginTokenHash = randomBytes(32).toString("base64url");
  const rateKey = randomBytes(32).toString("base64url");
  const ipHash = randomBytes(32).toString("base64url");
  const userAgentHash = randomBytes(32).toString("base64url");
  const query = neon(uri);
  let userId = "";
  try {
    const registered = await query.query(
      `SELECT r.*, t.display_name AS tenant_name
       FROM platform.custom_auth_register(
         $1::text,$2::text,$3::text,$4::text,$5::text,$6::timestamptz,$7::text,$8::text,$9::text
       ) r
       JOIN platform.tenants t ON t.id = r.tenant_id`,
      [
        email,
        "HTTP Preflight User",
        password,
        "synthetic-beta",
        registerTokenHash,
        new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        ipHash,
        userAgentHash,
        `custom-auth-http-register-${suffix}`,
      ],
    );
    if (
      registered.length !== 1 ||
      typeof registered[0]?.user_id !== "string"
    ) {
      throw new Error("Custom auth registration preflight returned an invalid row");
    }
    userId = registered[0].user_id;

    const signedIn = await query.query(
      `SELECT r.*, t.display_name AS tenant_name
       FROM platform.custom_auth_login(
         $1::text,$2::text,$3::text,$4::text,$5::text,$6::timestamptz,$7::text,$8::text,$9::text
       ) r
       JOIN platform.tenants t ON t.id = r.tenant_id`,
      [
        email,
        password,
        "synthetic-beta",
        rateKey,
        loginTokenHash,
        new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        ipHash,
        userAgentHash,
        `custom-auth-http-login-${suffix}`,
      ],
    );
    if (
      signedIn.length !== 1 ||
      signedIn[0]?.user_id !== userId ||
      typeof signedIn[0]?.session_id !== "string"
    ) {
      throw new Error("Custom auth login preflight returned an invalid row");
    }

    const contexts = await query.query(
      "SELECT * FROM platform.custom_auth_resolve_context($1::text)",
      [loginTokenHash],
    );
    const context = contexts[0];
    const permissions = Array.isArray(context?.permissions)
      ? context.permissions
      : [];
    if (
      contexts.length !== 1 ||
      context?.user_id !== userId ||
      context?.role_code !== "staging-read-only" ||
      permissions.length !== 16 ||
      permissions.some(
        (permission) =>
          typeof permission !== "string" ||
          !(
            permission.endsWith(".read") ||
            permission === "pricing.price_tax.calculate"
          ),
      )
    ) {
      throw new Error("Custom auth read-context preflight returned unsafe scope");
    }
    console.log(
      "custom auth registration, login and read-context preflight passed",
    );
  } catch (error) {
    const record =
      typeof error === "object" && error !== null
        ? error
        : { message: String(error) };
    console.error(
      "custom auth Neon HTTP preflight failed",
      JSON.stringify({
        name: record.name ?? null,
        code: record.code ?? null,
        message: record.message ?? null,
        detail: record.detail ?? null,
        constraint: record.constraint ?? null,
        routine: record.routine ?? null,
      }),
    );
    throw error;
  } finally {
    const client = new Client({ connectionString: uri });
    await client.connect();
    try {
      await client.query("BEGIN");
      if (userId) {
        await client.query(
          "DELETE FROM platform.memberships WHERE user_id = $1::uuid",
          [userId],
        );
        await client.query("DELETE FROM platform.users WHERE id = $1::uuid", [
          userId,
        ]);
      } else {
        const users = await client.query(
          "SELECT id FROM platform.users WHERE email_normalized = $1 FOR UPDATE",
          [email],
        );
        for (const row of users.rows) {
          await client.query(
            "DELETE FROM platform.memberships WHERE user_id = $1::uuid",
            [row.id],
          );
          await client.query("DELETE FROM platform.users WHERE id = $1::uuid", [
            row.id,
          ]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  }
}

const uri = await connectionString();
if (await readContextMigrationExists(uri)) {
  await httpDriverPreflight(uri);
} else {
  console.log("custom auth read-context preflight deferred until FND-0008 is applied");
}

const expandedScenario = `    for (const scenario of [
      {
        id: "admin-dashboard-desktop",
        pathname: "/admin",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },
      {
        id: "admin-catalog-mobile",
        pathname: "/admin/catalog",
        kind: "admin",
        viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      },
      {
        id: "admin-inventory-desktop",
        pathname: "/admin/inventory",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },`;

const expandedProbes = `${contextProbeNeedle}
  probes.push(await probe(baseUrl, "/auth/context", '"database-resolved-read-only"', 200, authenticated));
  probes.push(await probe(baseUrl, "/admin", "Run the store from evidence", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/catalog", "Database-backed catalog", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/customers", "Ayesha Rahman", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/sales", "SO-STG-0001", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/inventory/availability?variantId=018f1000-0000-7000-8000-000000000201&warehouseId=018f0000-0000-7000-8000-000000000402", '"available"', 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/inventory/movements?warehouseId=018f0000-0000-7000-8000-000000000402&limit=10", "STG-OPEN-001", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/procurement/suppliers?limit=10", "Northstar Distribution", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/procurement/purchase-orders?warehouseId=018f0000-0000-7000-8000-000000000402&limit=10", "PO-STG-0001", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/v1/inventory/movements?warehouseId=018f0000-0000-7000-8000-000000000401", '"PERMISSION_DENIED"', 403, authenticated));`;

const secretUpload = [
  "  const internalTokenSecret = process.env.STAGING_INTERNAL_TOKEN_SECRET;",
  '  if (!internalTokenSecret || internalTokenSecret.length < 43) throw new Error("STAGING_INTERNAL_TOKEN_SECRET is required");',
  '  await run("npx", [',
  '    "--yes",',
  '    `wrangler@${WRANGLER_VERSION}`,',
  '    "secret",',
  '    "put",',
  '    "STAGING_INTERNAL_TOKEN_SECRET",',
  '    "--config",',
  '    configPath,',
  '    "--name",',
  '    WORKER_NAME,',
  '  ], { input: internalTokenSecret + "\\n", secret: internalTokenSecret });',
  baseUrlNeedle,
].join("\n");

const patchedDeploy = originalDeploy
  .replace(
    redactNeedle,
    '.replaceAll(connectionString || "postgresql://__never__", "[REDACTED_DATABASE_URL]")',
  )
  .replace(mainNeedle, 'main: "apps/api/src/staging-entry.ts"')
  .replace(baseUrlNeedle, secretUpload)
  .replace(contextProbeNeedle, expandedProbes)
  .replace(scenarioNeedle, expandedScenario)
  .replace(
    loginPageNeedle,
    `${loginPageNeedle}\n    await loginPage.setBypassCSP(true);`,
  )
  .replace(
    sessionPageNeedle,
    `${sessionPageNeedle}\n    await sessionPage.setBypassCSP(true);`,
  );

process.env.STAGING_INTERNAL_TOKEN_SECRET = randomBytes(48).toString("base64url");
await writeFile(deployPath, patchedDeploy, "utf8");
try {
  await import("./deploy-custom-auth-staging.mjs");
} finally {
  delete process.env.STAGING_INTERNAL_TOKEN_SECRET;
  await writeFile(deployPath, originalDeploy, "utf8");
}
