import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const WRANGLER_VERSION = "4.114.0";
const WORKER_NAME = "store-pos-staging";
const NEON_PROJECT_ID = "morning-flower-46531465";
const NEON_BRANCH_ID = "br-empty-sound-afkx5vkj";
const NEON_DATABASE = "neondb";
const NEON_ROLE = "neondb_owner";
const {
  NEON_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  GITHUB_SHA,
  GITHUB_RUN_ID,
} = process.env;

if (!NEON_API_KEY || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error(
    "NEON_API_KEY, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for persistent staging deployment",
  );
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "staging");
const reportPath = path.join(artifactsDir, "persistent-staging-report.json");
const configPath = path.join(root, ".wrangler-persistent-staging.json");
const neonApiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const cloudflareApiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
const gitSha = GITHUB_SHA || "manual";

function redact(value, connectionString = "") {
  return String(value || "")
    .replaceAll(NEON_API_KEY, "[REDACTED_NEON_TOKEN]")
    .replaceAll(CLOUDFLARE_API_TOKEN, "[REDACTED_CLOUDFLARE_TOKEN]")
    .replaceAll(CLOUDFLARE_ACCOUNT_ID, "[REDACTED_CLOUDFLARE_ACCOUNT]")
    .replaceAll(connectionString, "[REDACTED_DATABASE_URL]")
    .replace(/postgresql:\/\/[^\s"']+/gu, "[REDACTED_DATABASE_URL]")
    .replace(/\u001b\[[0-9;]*m/gu, "");
}

async function neonApi(pathname) {
  const response = await fetch(`${neonApiBase}${pathname}`, {
    headers: {
      Authorization: `Bearer ${NEON_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Neon API ${response.status}: ${redact(text)}`);
  }
  return payload;
}

async function cloudflareApi(pathname, init = {}) {
  const response = await fetch(`${cloudflareApiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.success === false) {
    throw new Error(`Cloudflare API ${response.status}: ${redact(text)}`);
  }
  return payload?.result;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: options.input === undefined ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    let output = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        process.stdout.write(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
        process.stderr.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with code ${code}: ${redact(output, options.secret)}`));
    });
    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input);
    }
  });
}

async function fetchConnectionString() {
  const response = await neonApi(
    `/connection_uri?branch_id=${encodeURIComponent(NEON_BRANCH_ID)}&database_name=${encodeURIComponent(NEON_DATABASE)}&role_name=${encodeURIComponent(NEON_ROLE)}`,
  );
  if (typeof response?.uri !== "string" || !response.uri.startsWith("postgresql://")) {
    throw new Error("Neon API did not return the dedicated staging connection URI");
  }
  return response.uri;
}

async function migrationSummary(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const migrations = await client.query(
      "SELECT count(*)::int AS count FROM platform.schema_migrations",
    );
    const tenants = await client.query(
      "SELECT count(*)::int AS count FROM platform.tenants WHERE code LIKE 'synthetic-%'",
    );
    return {
      migrations: migrations.rows[0]?.count ?? 0,
      syntheticTenants: tenants.rows[0]?.count ?? 0,
    };
  } finally {
    await client.end();
  }
}

async function resolveWorkerUrl() {
  await cloudflareApi(`/workers/scripts/${encodeURIComponent(WORKER_NAME)}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  const subdomain = await cloudflareApi("/workers/subdomain");
  if (typeof subdomain?.subdomain !== "string" || subdomain.subdomain.length === 0) {
    throw new Error("Cloudflare Workers subdomain is unavailable");
  }
  return `https://${WORKER_NAME}.${subdomain.subdomain}.workers.dev`;
}

async function probe(baseUrl, pathname, expectedMarker, expectedStatus = 200) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        redirect: "manual",
        headers: { "x-staging-smoke": GITHUB_RUN_ID || "manual" },
      });
      const body = await response.text();
      if (response.status !== expectedStatus) {
        throw new Error(`${pathname} returned HTTP ${response.status}`);
      }
      if (expectedMarker && !body.includes(expectedMarker)) {
        throw new Error(`${pathname} did not include the expected marker`);
      }
      return { pathname, status: response.status, marker: expectedMarker };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }
  throw lastError ?? new Error(`${pathname} staging probe failed`);
}

await mkdir(artifactsDir, { recursive: true });
await rm(reportPath, { force: true });
let connectionString = "";
let report;
try {
  connectionString = await fetchConnectionString();
  await run("npm", ["run", "db:migrate"], {
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      LOAD_SYNTHETIC_SEED: "1",
    },
    secret: connectionString,
  });
  const database = await migrationSummary(connectionString);

  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        name: WORKER_NAME,
        main: "apps/api/src/staging.ts",
        compatibility_date: "2026-07-27",
        compatibility_flags: ["nodejs_compat"],
        workers_dev: true,
        preview_urls: false,
        observability: {
          enabled: true,
          logs: { invocation_logs: true, head_sampling_rate: 1 },
        },
        vars: {
          APP_ENV: "staging",
          REGION: "cloudflare-global",
          STAGING_GIT_SHA: gitSha,
          OIDC_ISSUER: "https://staging-identity.invalid",
          OIDC_AUDIENCE: "store-management-api-staging",
          OIDC_JWKS_URI: "https://staging-identity.invalid/.well-known/jwks.json",
          OIDC_MFA_ACR_VALUES: "urn:staging:mfa",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await run("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "deploy",
    "--config",
    configPath,
    "--name",
    WORKER_NAME,
    "--minify",
    "--message",
    `Persistent Admin/POS staging ${gitSha}`,
  ]);

  await run(
    "npx",
    [
      "--yes",
      `wrangler@${WRANGLER_VERSION}`,
      "secret",
      "put",
      "DATABASE_URL",
      "--config",
      configPath,
      "--name",
      WORKER_NAME,
    ],
    { input: `${connectionString}\n`, secret: connectionString },
  );

  const baseUrl = await resolveWorkerUrl();
  const probes = [];
  probes.push(await probe(baseUrl, "/", "", 302));
  probes.push(await probe(baseUrl, "/admin", "Persistent staging"));
  probes.push(await probe(baseUrl, "/admin/inventory", "Inventory"));
  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement"));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS"));
  probes.push(await probe(baseUrl, "/api/health", '"status":"healthy"'));
  probes.push(await probe(baseUrl, "/staging/status", '"persistent-admin-pos-staging"'));

  report = {
    schemaVersion: 1,
    status: "passed",
    workerName: WORKER_NAME,
    baseUrl,
    gitSha,
    runId: GITHUB_RUN_ID || null,
    neon: {
      projectId: NEON_PROJECT_ID,
      branchId: NEON_BRANCH_ID,
      database: NEON_DATABASE,
      ...database,
    },
    probes,
    persistent: true,
    syntheticOnly: true,
    authoritativeBrowserWritesEnabled: false,
  };
  console.log(`Persistent staging deployment passed at ${baseUrl}`);
} catch (error) {
  report = {
    schemaVersion: 1,
    status: "failed",
    workerName: WORKER_NAME,
    gitSha,
    runId: GITHUB_RUN_ID || null,
    error: redact(error instanceof Error ? error.message : error, connectionString),
  };
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rm(configPath, { force: true });
}
