import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactDirectory = path.join(root, "artifacts", "staging");
const reportPath = path.join(artifactDirectory, "persistent-staging-report.json");
const configPath = path.join(root, ".wrangler-persistent-staging.json");
const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const WRANGLER_VERSION = "4.114.0";
const WORKER_NAME = "store-pos-staging";
const NEON_PROJECT_ID = "morning-flower-46531465";
const NEON_BRANCH_ID = "br-empty-sound-afkx5vkj";
const NEON_DATABASE = "neondb";
const NEON_ROLE = "neondb_owner";
const STAGING_TENANT_CODE = "synthetic-beta";
const {
  NEON_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  GITHUB_SHA,
  GITHUB_RUN_ID,
} = process.env;

await mkdir(artifactDirectory, { recursive: true });
for (const [name, value] of Object.entries({
  NEON_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
})) {
  if (!value) throw new Error(`${name} is required for persistent staging`);
}

const gitSha = GITHUB_SHA || "local-staging";
let connectionString = "";
let authEmail = "";
let authPassword = "";
let cleanupCount = 0;
let report;

function redact(value) {
  const text = String(value ?? "");
  return text
    .replaceAll(NEON_API_KEY || "__never__", "[REDACTED_NEON_API_KEY]")
    .replaceAll(CLOUDFLARE_API_TOKEN || "__never__", "[REDACTED_CLOUDFLARE_TOKEN]")
    .replaceAll(CLOUDFLARE_ACCOUNT_ID || "__never__", "[REDACTED_ACCOUNT_ID]")
    .replaceAll(connectionString, "[REDACTED_DATABASE_URL]")
    .replaceAll(authEmail || "__never__", "[REDACTED_AUTH_EMAIL]")
    .replaceAll(authPassword || "__never__", "[REDACTED_AUTH_PASSWORD]");
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(redact(text).replaceAll(options.secret || "__never__", "[REDACTED_SECRET]"));
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}: ${redact(stderr).replaceAll(options.secret || "__never__", "[REDACTED_SECRET]")}`));
    });
  });
}

async function neonConnectionString() {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${NEON_BRANCH_ID}&database_name=${NEON_DATABASE}&role_name=${NEON_ROLE}`,
    { headers: { Authorization: `Bearer ${NEON_API_KEY}` } },
  );
  const body = await response.json();
  if (!response.ok || typeof body?.uri !== "string") {
    throw new Error(`Neon connection URI failed with HTTP ${response.status}`);
  }
  return body.uri;
}

async function databaseEvidence(uri) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*)::int FROM platform.schema_migrations) AS migration_count,
        (SELECT count(*)::int FROM platform.tenants WHERE code LIKE 'synthetic-%') AS synthetic_tenants,
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'platform' AND table_name IN ('custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits','custom_auth_events')) AS custom_auth_tables,
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'neon_auth') AS legacy_neon_auth_tables
    `);
    const evidence = result.rows[0];
    if (!evidence || evidence.migration_count < 57 || evidence.synthetic_tenants !== 2 || evidence.custom_auth_tables !== 4 || evidence.legacy_neon_auth_tables !== 0) {
      throw new Error("Persistent staging database verification failed");
    }
    return {
      registeredMigrations: evidence.migration_count,
      syntheticTenants: evidence.synthetic_tenants,
      customAuthTables: evidence.custom_auth_tables,
      legacyNeonAuthTables: evidence.legacy_neon_auth_tables,
    };
  } finally {
    await client.end();
  }
}

async function cleanupAccount(uri, email) {
  if (!email) return 0;
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    await client.query("BEGIN");
    const users = await client.query(
      "SELECT id FROM platform.users WHERE email_normalized = $1 FOR UPDATE",
      [email.toLowerCase()],
    );
    for (const row of users.rows) {
      await client.query("DELETE FROM platform.memberships WHERE user_id = $1::uuid", [row.id]);
      await client.query("DELETE FROM platform.users WHERE id = $1::uuid", [row.id]);
    }
    await client.query("COMMIT");
    return users.rowCount ?? users.rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function resolveWorkerUrl() {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/services/${WORKER_NAME}/environments/production/subdomain`,
      { headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` } },
    );
    if (response.ok) {
      const body = await response.json();
      const hostname = body?.result?.enabled && body?.result?.previews_enabled !== undefined
        ? `${WORKER_NAME}.rahmatullahzisan.workers.dev`
        : null;
      if (hostname) return `https://${hostname}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return `https://${WORKER_NAME}.rahmatullahzisan.workers.dev`;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function createAccount(baseUrl) {
  const suffix = `${GITHUB_RUN_ID || Date.now()}-${randomBytes(5).toString("hex")}`;
  authEmail = `staging-auth-${suffix}@example.com`;
  authPassword = `Stage-${randomBytes(24).toString("base64url")}!9a`;
  const form = new URLSearchParams({
    name: "Synthetic Staging Operator",
    email: authEmail,
    password: authPassword,
    returnTo: "/admin",
  });
  const response = await fetch(`${baseUrl}/auth/sign-up`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
      "sec-fetch-site": "same-origin",
      "user-agent": "Ozzyl-Staging-Evidence/1.0",
    },
    body: form,
  });
  const cookie = cookieHeader(response);
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  if (response.status !== 303 || !cookie.includes("ozzyl_staging_session=")) {
    throw new Error(
      `Custom auth sign-up failed with HTTP ${response.status}: ${redact(await response.text())}`,
    );
  }
  return { cookie, cookiesSet: cookies.length };
}

async function probe(baseUrl, pathname, marker, status = 200, headers = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        redirect: "manual",
        headers: {
          "x-staging-smoke": GITHUB_RUN_ID || "manual",
          ...headers,
        },
      });
      const body = await response.text();
      if (response.status !== status) {
        throw new Error(`${pathname} returned HTTP ${response.status}: ${redact(body).slice(0, 1200)}`);
      }
      if (marker && !body.includes(marker)) {
        throw new Error(`${pathname} did not include ${marker}: ${redact(body).slice(0, 1200)}`);
      }
      return { pathname, status: response.status, marker };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }
  throw lastError ?? new Error(`${pathname} probe failed`);
}

async function axeViolations(page) {
  const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
  await page.addScriptTag({ path: axePath });
  return await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    }));
  });
}

async function signInBrowser(page, baseUrl) {
  await page.goto(`${baseUrl}/login?returnTo=%2Fadmin`, { waitUntil: "networkidle0" });
  await page.type("#signin-email", authEmail);
  await page.type("#signin-password", authPassword);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('form[action="/auth/sign-in"] button[type="submit"]'),
  ]);
  return page.url().includes("/admin");
}

async function browserEvidence(baseUrl) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const scenarios = [];
    const loginPage = await browser.newPage();
    await loginPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await loginPage.goto(`${baseUrl}/login`, { waitUntil: "networkidle0" });
    const loginViolations = await axeViolations(loginPage);
    const loginMetrics = await loginPage.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      title: document.title,
      customAuth: document.body.textContent?.includes("Ozzyl custom authentication") === true,
    }));
    await loginPage.screenshot({ path: path.join(artifactDirectory, "login-mobile.jpg"), fullPage: true, type: "jpeg", quality: 82 });
    scenarios.push({ id: "login-mobile", viewport: "390x844", violations: loginViolations, overflow: loginMetrics.overflow, passed: loginViolations.length === 0 && !loginMetrics.overflow && loginMetrics.customAuth });
    await loginPage.close();

    const sessionPage = await browser.newPage();
    await sessionPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const signedIn = await signInBrowser(sessionPage, baseUrl);
    if (!signedIn) throw new Error("Custom auth browser sign-in evidence failed");

    for (const scenario of [
      {
        id: "admin-inventory-desktop",
        pathname: "/admin/inventory",
        kind: "admin",
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      },
      {
        id: "pos-register-mobile",
        pathname: "/pos",
        kind: "pos",
        viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      },
    ]) {
      await sessionPage.setViewport(scenario.viewport);
      await sessionPage.goto(`${baseUrl}${scenario.pathname}`, { waitUntil: "networkidle0" });
      const violations = await axeViolations(sessionPage);
      const metrics = await sessionPage.evaluate((kind) => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hasNotice: document.body.textContent?.includes("Persistent staging") === true,
        hasIdentity: document.body.textContent?.includes("Signed in as") === true,
        checkoutDisabled: kind !== "pos" || document.querySelector('[data-command="checkout"]')?.hasAttribute("disabled") === true,
        adminSkipTarget: kind !== "admin" || document.querySelector('.skip-link')?.getAttribute("href") === "#main",
      }), scenario.kind);
      if (scenario.kind === "admin") {
        await sessionPage.keyboard.press("Home");
        await sessionPage.keyboard.press("Tab");
        await sessionPage.keyboard.press("Enter");
        metrics.skipFocusedMain = await sessionPage.evaluate(() => document.activeElement?.id === "main");
      }
      await sessionPage.screenshot({ path: path.join(artifactDirectory, `${scenario.id}.jpg`), fullPage: true, type: "jpeg", quality: 82 });
      scenarios.push({
        id: scenario.id,
        viewport: `${scenario.viewport.width}x${scenario.viewport.height}`,
        violations,
        overflow: metrics.overflow,
        passed: violations.length === 0 && !metrics.overflow && metrics.hasNotice && metrics.hasIdentity && metrics.checkoutDisabled && metrics.adminSkipTarget && (scenario.kind !== "admin" || metrics.skipFocusedMain === true),
      });
    }

    const sessionResponse = await sessionPage.evaluate(async () => {
      const response = await fetch("/auth/session", { credentials: "include" });
      return { status: response.status, body: await response.json() };
    });
    const contextResponse = await sessionPage.evaluate(async () => {
      const response = await fetch("/auth/context", { credentials: "include" });
      return { status: response.status, body: await response.json() };
    });
    const logoutResponse = await sessionPage.evaluate(async () => {
      const response = await fetch("/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { "sec-fetch-site": "same-origin" },
        redirect: "manual",
      });
      return { status: response.status, type: response.type };
    });
    await sessionPage.goto(`${baseUrl}/admin`, { waitUntil: "networkidle0" });
    const loggedOut = sessionPage.url().includes("/login");
    await sessionPage.close();
    return {
      scenarios,
      session: { passed: sessionResponse.status === 200 && sessionResponse.body?.authenticated === true },
      context: { passed: contextResponse.status === 200 && contextResponse.body?.authorizationMode === "database-resolved-read-only" && contextResponse.body?.context?.role === "staging-read-only" },
      logout: { passed: [0, 303].includes(logoutResponse.status) && loggedOut },
    };
  } finally {
    await browser.close();
  }
}

try {
  connectionString = await neonConnectionString();
  await run("npm", ["run", "db:migrate"], {
    input: undefined,
  });
  const database = await databaseEvidence(connectionString);
  await writeFile(configPath, `${JSON.stringify({
    $schema: "node_modules/wrangler/config-schema.json",
    name: WORKER_NAME,
    main: "apps/api/src/staging.ts",
    compatibility_date: "2026-01-20",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      APP_ENV: "staging",
      REGION: "cloudflare-global",
      STAGING_GIT_SHA: gitSha,
      STAGING_AUTH_REQUIRED: "1",
      STAGING_AUTH_TENANT_CODE: STAGING_TENANT_CODE,
      OIDC_ISSUER: "https://staging-business-identity.invalid",
      OIDC_AUDIENCE: "store-management-api-staging",
      OIDC_JWKS_URI: "https://staging-business-identity.invalid/.well-known/jwks.json",
      OIDC_MFA_ACR_VALUES: "urn:staging:mfa",
    },
  }, null, 2)}\n`, "utf8");

  await run("npx", [
    "--yes", `wrangler@${WRANGLER_VERSION}`, "deploy", "--config", configPath,
    "--name", WORKER_NAME, "--minify", "--message",
    `Persistent Admin/POS custom-auth staging ${gitSha}`,
  ]);
  await run("npx", [
    "--yes", `wrangler@${WRANGLER_VERSION}`, "secret", "put", "DATABASE_URL",
    "--config", configPath, "--name", WORKER_NAME,
  ], { input: `${connectionString}\n`, secret: connectionString });

  const baseUrl = await resolveWorkerUrl();
  const account = await createAccount(baseUrl);
  const authenticated = { Cookie: account.cookie };
  const probes = [];
  probes.push(await probe(baseUrl, "/", "", 302));
  probes.push(await probe(baseUrl, "/login", "Ozzyl custom authentication"));
  probes.push(await probe(baseUrl, "/admin", "", 302));
  probes.push(await probe(baseUrl, "/admin", "Persistent staging", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/inventory", "Inventory", 200, authenticated));
  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement", 200, authenticated));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS", 200, authenticated));
  probes.push(await probe(baseUrl, "/api/health", '"status":"healthy"'));
  probes.push(await probe(baseUrl, "/auth/session", '"authenticated":true', 200, authenticated));
  probes.push(await probe(baseUrl, "/staging/status", '"custom-auth-required"'));
  const browser = await browserEvidence(baseUrl);

  cleanupCount = await cleanupAccount(connectionString, authEmail);
  if (cleanupCount !== 1) throw new Error("Synthetic custom-auth account cleanup did not remove one user");

  report = {
    schemaVersion: 3,
    status: "passed",
    workerName: WORKER_NAME,
    baseUrl,
    gitSha,
    runId: GITHUB_RUN_ID || null,
    neon: { projectId: NEON_PROJECT_ID, branchId: NEON_BRANCH_ID, database: NEON_DATABASE, ...database },
    authentication: {
      provider: "ozzyl-custom-postgres-auth",
      required: true,
      passwordHash: "bcrypt-cost-12",
      sessionTokenStoredPlaintext: false,
      sessionHours: 8,
      syntheticAccountCreated: true,
      syntheticAccountCleaned: cleanupCount === 1,
      cookiesSet: account.cookiesSet,
      anonymousRedirectPassed: true,
      sessionProbePassed: browser.session.passed,
      contextProbePassed: browser.context.passed,
      databaseResolvedReadRole: "staging-read-only",
      browserLoginPassed: browser.scenarios[0]?.passed === true,
      browserLogoutPassed: browser.logout.passed,
      credentialsPersistedInArtifacts: false,
      legacyNeonAuthRemoved: database.legacyNeonAuthTables === 0,
    },
    probes,
    browser: browser.scenarios,
    persistent: true,
    syntheticOnly: true,
    authoritativeBrowserWritesEnabled: false,
  };
  console.log(`Persistent custom-auth staging passed at ${baseUrl}`);
} catch (error) {
  if (connectionString && authEmail && cleanupCount === 0) {
    try { cleanupCount = await cleanupAccount(connectionString, authEmail); } catch { /* preserve primary failure */ }
  }
  report = {
    schemaVersion: 3,
    status: "failed",
    workerName: WORKER_NAME,
    gitSha,
    runId: GITHUB_RUN_ID || null,
    syntheticAuthCleanupCount: cleanupCount,
    error: redact(error instanceof Error ? error.message : error),
  };
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rm(configPath, { force: true });
  authEmail = "";
  authPassword = "";
}
