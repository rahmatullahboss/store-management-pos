import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, neon } from "@neondatabase/serverless";

const root = fileURLToPath(new URL("../..", import.meta.url));
const entryPath = path.join(root, "apps", "api", "src", "staging.ts");
const deployPath = path.join(
  root,
  "tooling",
  "scripts",
  "deploy-custom-auth-staging.mjs",
);
const originalEntry = await readFile(entryPath, "utf8");
const originalDeploy = await readFile(deployPath, "utf8");
const legacyMarker = '"neon-auth-required"';
const customMarker = '"custom-auth-required"';
const markerOccurrences = originalEntry.split(legacyMarker).length - 1;
if (markerOccurrences !== 1) {
  throw new Error(
    `Expected exactly one legacy staging auth marker, found ${markerOccurrences}`,
  );
}
const redactNeedle =
  '.replaceAll(connectionString, "[REDACTED_DATABASE_URL]")';
if (!originalDeploy.includes(redactNeedle)) {
  throw new Error("Custom staging redaction patch target is missing");
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

async function customAuthMigrationExists(uri) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT EXISTS(SELECT 1 FROM platform.schema_migrations WHERE migration_id = 'FND-0007') AS exists",
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
    console.log("custom auth Neon HTTP registration and login preflight passed");
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
if (await customAuthMigrationExists(uri)) {
  await httpDriverPreflight(uri);
} else {
  console.log("custom auth HTTP preflight deferred until FND-0007 is applied");
}

await writeFile(
  entryPath,
  originalEntry.replace(legacyMarker, customMarker),
  "utf8",
);
await writeFile(
  deployPath,
  originalDeploy.replace(
    redactNeedle,
    '.replaceAll(connectionString || "postgresql://__never__", "[REDACTED_DATABASE_URL]")',
  ),
  "utf8",
);
try {
  await import("./deploy-custom-auth-staging.mjs");
} finally {
  await writeFile(entryPath, originalEntry, "utf8");
  await writeFile(deployPath, originalDeploy, "utf8");
}
