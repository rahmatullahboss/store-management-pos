import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import puppeteer from "puppeteer-core";

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
  CHROME_PATH,
} = process.env;

if (!NEON_API_KEY || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error(
    "NEON_API_KEY, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required",
  );
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "staging");
const browserDir = path.join(artifactsDir, "browser");
const reportPath = path.join(artifactsDir, "persistent-staging-report.json");
const configPath = path.join(root, ".wrangler-persistent-staging.json");
const neonApiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const cloudflareApiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
const gitSha = GITHUB_SHA || "manual";
let authEmail = "";
let authPassword = "";

function redact(value, connectionString = "") {
  let output = String(value || "")
    .replaceAll(NEON_API_KEY, "[REDACTED_NEON_TOKEN]")
    .replaceAll(CLOUDFLARE_API_TOKEN, "[REDACTED_CLOUDFLARE_TOKEN]")
    .replaceAll(CLOUDFLARE_ACCOUNT_ID, "[REDACTED_CLOUDFLARE_ACCOUNT]")
    .replaceAll(connectionString, "[REDACTED_DATABASE_URL]")
    .replace(/postgresql:\/\/[^\s"']+/gu, "[REDACTED_DATABASE_URL]")
    .replace(/\u001b\[[0-9;]*m/gu, "");
  if (authEmail) output = output.replaceAll(authEmail, "[REDACTED_AUTH_EMAIL]");
  if (authPassword) {
    output = output.replaceAll(authPassword, "[REDACTED_AUTH_PASSWORD]");
  }
  return output;
}

async function neonApi(pathname) {
  const response = await fetch(`${neonApiBase}${pathname}`, {
    headers: {
      Authorization: `Bearer ${NEON_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Neon API ${response.status}: ${redact(text)}`);
  return text ? JSON.parse(text) : null;
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
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else {
        reject(
          new Error(
            `${command} exited with code ${code}: ${redact(output, options.secret)}`,
          ),
        );
      }
    });
    if (options.input !== undefined && child.stdin) child.stdin.end(options.input);
  });
}

async function connectionString() {
  const response = await neonApi(
    `/connection_uri?branch_id=${encodeURIComponent(NEON_BRANCH_ID)}&database_name=${encodeURIComponent(NEON_DATABASE)}&role_name=${encodeURIComponent(NEON_ROLE)}`,
  );
  if (typeof response?.uri !== "string" || !response.uri.startsWith("postgresql://")) {
    throw new Error("Neon API did not return the staging connection URI");
  }
  return response.uri;
}

async function withDatabase(uri, work) {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function prepareDatabase(uri) {
  return await withDatabase(uri, async (client) => {
    await client.query("DROP SCHEMA IF EXISTS neon_auth CASCADE");
    const migrations = await client.query(
      "SELECT count(*)::int AS count FROM platform.schema_migrations",
    );
    const tenants = await client.query(
      "SELECT count(*)::int AS count FROM platform.tenants WHERE code LIKE 'synthetic-%'",
    );
    const customTables = await client.query(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'platform'
         AND table_name IN ('auth_credentials','auth_sessions','auth_rate_limits','auth_events')`,
    );
    const legacy = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'neon_auth'",
    );
    return {
      migrations: migrations.rows[0]?.count ?? 0,
      syntheticTenants: tenants.rows[0]?.count ?? 0,
      customAuthTables: customTables.rows[0]?.count ?? 0,
      legacyNeonAuthTables: legacy.rows[0]?.count ?? 0,
    };
  });
}

async function cleanupAccount(uri, email) {
  if (!email) return 0;
  return await withDatabase(uri, async (client) => {
    await client.query("BEGIN");
    try {
      const users = await client.query(
        `SELECT id FROM platform.users
         WHERE email_normalized = $1
           AND email_normalized LIKE 'staging-smoke-%@example.com'
         FOR UPDATE`,
        [email],
      );
      if (users.rowCount !== 1) {
        await client.query("ROLLBACK");
        return 0;
      }
      const userId = users.rows[0].id;
      await client.query("DELETE FROM platform.memberships WHERE user_id = $1", [userId]);
      const deleted = await client.query(
        "DELETE FROM platform.users WHERE id = $1 RETURNING id",
        [userId],
      );
      await client.query("COMMIT");
      return deleted.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function resolveWorkerUrl() {
  await cloudflareApi(`/workers/scripts/${encodeURIComponent(WORKER_NAME)}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  const subdomain = await cloudflareApi("/workers/subdomain");
  if (typeof subdomain?.subdomain !== "string" || !subdomain.subdomain) {
    throw new Error("Cloudflare Workers subdomain is unavailable");
  }
  return `https://${WORKER_NAME}.${subdomain.subdomain}.workers.dev`;
}

function setCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length > 0) return values;
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookieHeader(cookies) {
  return cookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function createAccount(baseUrl) {
  const suffix = `${GITHUB_RUN_ID || Date.now()}-${randomBytes(5).toString("hex")}`;
  authEmail = `staging-smoke-${suffix}@example.com`;
  authPassword = `Stg-${randomBytes(24).toString("base64url")}!9a`;
  const response = await fetch(`${baseUrl}/auth/sign-up`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Ozzyl-Custom-Auth-Smoke",
    },
    body: new URLSearchParams({
      name: "Staging Smoke User",
      email: authEmail,
      password: authPassword,
      returnTo: "/admin",
    }),
  });
  const cookies = setCookies(response);
  const cookie = cookieHeader(cookies);
  if (response.status !== 303 || !cookie) {
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
        throw new Error(`${pathname} returned HTTP ${response.status}`);
      }
      if (marker && !body.includes(marker)) {
        throw new Error(`${pathname} did not include ${marker}`);
      }
      return { pathname, status: response.status, marker };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }
  throw lastError ?? new Error(`${pathname} probe failed`);
}

async function axeResult(page, axeSource) {
  await page.addScriptTag({ content: axeSource });
  return await page.evaluate(async () =>
    globalThis.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa"],
      },
    }),
  );
}

async function loginScenario(browser, axeSource, baseUrl) {
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  try {
    const response = await page.goto(`${baseUrl}/login?returnTo=%2Fadmin`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    if (!response || response.status() !== 200) throw new Error("Login page failed");
    const accessibility = await axeResult(page, axeSource);
    const layout = await page.evaluate(() => ({
      mainCount: document.querySelectorAll("main").length,
      h1Count: document.querySelectorAll("h1").length,
      customAuth: (document.body.textContent ?? "").includes(
        "Ozzyl custom authentication",
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 2,
    }));
    const screenshot = path.join(browserDir, "login-mobile.jpg");
    await page.screenshot({ path: screenshot, type: "jpeg", quality: 82, fullPage: true });
    await page.type("#signin-email", authEmail);
    await page.type("#signin-password", authPassword);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60_000 }),
      page.click('form[action="/auth/sign-in"] button[type="submit"]'),
    ]);
    const signedIn =
      new URL(page.url()).pathname === "/admin" &&
      (await page.evaluate(() =>
        (document.body.textContent ?? "").includes("Signed in as"),
      ));
    const passed =
      accessibility.violations.length === 0 &&
      layout.mainCount === 1 &&
      layout.h1Count === 1 &&
      layout.customAuth &&
      !layout.horizontalOverflow &&
      signedIn;
    if (!passed) throw new Error("Custom auth browser sign-in evidence failed");
    return {
      id: "login-mobile",
      pathname: "/login",
      viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      violations: accessibility.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.length,
      })),
      layout,
      signedIn,
      screenshot: path.relative(root, screenshot),
      passed,
    };
  } finally {
    await page.close();
  }
}

async function protectedScenario(browser, axeSource, baseUrl, scenario) {
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.setViewport(scenario.viewport);
  try {
    const response = await page.goto(`${baseUrl}${scenario.pathname}`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    if (!response || response.status() !== 200) {
      throw new Error(`${scenario.pathname} returned ${response?.status()}`);
    }
    const accessibility = await axeResult(page, axeSource);
    const layout = await page.evaluate((kind) => {
      const text = document.body.textContent ?? "";
      const checkout = document.querySelector(".modd-complete");
      return {
        mainCount: document.querySelectorAll("main").length,
        h1Count: document.querySelectorAll("h1").length,
        hasNotice: text.includes("Persistent staging"),
        hasIdentity: text.includes("Signed in as"),
        adminLink:
          kind === "admin"
            ? document.querySelector('a[href="/admin/inventory"]') !== null
            : null,
        checkoutDisabled:
          kind === "pos" && checkout instanceof HTMLButtonElement
            ? checkout.disabled
            : null,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 2,
        leakedDatabaseUrl: text.includes("postgresql://"),
      };
    }, scenario.kind);
    let keyboard = null;
    if (scenario.kind === "admin") {
      await page.keyboard.press("Tab");
      const firstFocus = await page.evaluate(() => ({
        className: document.activeElement?.className ?? "",
        outline: document.activeElement
          ? getComputedStyle(document.activeElement).outlineStyle
          : "none",
      }));
      await page.keyboard.press("Enter");
      keyboard = {
        firstFocus,
        skipTarget: await page.evaluate(() => document.activeElement?.id ?? ""),
      };
    }
    const screenshot = path.join(browserDir, `${scenario.id}.jpg`);
    await page.screenshot({ path: screenshot, type: "jpeg", quality: 82, fullPage: true });
    const passed =
      accessibility.violations.length === 0 &&
      layout.mainCount === 1 &&
      layout.h1Count >= 1 &&
      layout.hasNotice &&
      layout.hasIdentity &&
      !layout.horizontalOverflow &&
      !layout.leakedDatabaseUrl &&
      (scenario.kind !== "admin" ||
        (layout.adminLink === true &&
          keyboard?.firstFocus.className === "skip-link" &&
          keyboard?.firstFocus.outline !== "none" &&
          keyboard?.skipTarget === "main")) &&
      (scenario.kind !== "pos" || layout.checkoutDisabled === true);
    if (!passed) throw new Error(`${scenario.pathname} browser evidence failed`);
    return {
      ...scenario,
      violations: accessibility.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.length,
      })),
      layout,
      keyboard,
      screenshot: path.relative(root, screenshot),
      passed,
    };
  } finally {
    await page.close();
  }
}

async function browserEvidence(baseUrl) {
  const axeSource = await readFile(
    path.join(root, "node_modules", "axe-core", "axe.min.js"),
    "utf8",
  );
  await mkdir(browserDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const results = [await loginScenario(browser, axeSource, baseUrl)];
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
      results.push(await protectedScenario(browser, axeSource, baseUrl, scenario));
    }
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle0", timeout: 60_000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60_000 }),
      page.click('form[action="/auth/sign-out"] button[type="submit"]'),
    ]);
    const logoutDestination = new URL(page.url()).pathname;
    await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle0", timeout: 60_000 });
    const logout = {
      passed:
        logoutDestination === "/login" &&
        new URL(page.url()).pathname === "/login",
    };
    await page.close();
    if (!logout.passed) throw new Error("Custom auth browser logout evidence failed");
    return { scenarios: results, logout };
  } finally {
    await browser.close();
  }
}

await mkdir(artifactsDir, { recursive: true });
await rm(reportPath, { force: true });
let uri = "";
let cleanupCount = 0;
let report;
try {
  uri = await connectionString();
  await run("npm", ["run", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: uri, LOAD_SYNTHETIC_SEED: "1" },
    secret: uri,
  });
  const database = await prepareDatabase(uri);
  if (database.customAuthTables !== 4 || database.legacyNeonAuthTables !== 0) {
    throw new Error("Custom auth schema verification failed");
  }

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
          STAGING_AUTH_REQUIRED: "1",
          STAGING_AUTH_TENANT_CODE: "synthetic-beta",
          OIDC_ISSUER: "https://staging-business-identity.invalid",
          OIDC_AUDIENCE: "store-management-api-staging",
          OIDC_JWKS_URI:
            "https://staging-business-identity.invalid/.well-known/jwks.json",
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
    `Persistent Admin/POS custom-auth staging ${gitSha}`,
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
    { input: `${uri}\n`, secret: uri },
  );

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

  cleanupCount = await cleanupAccount(uri, authEmail);
  if (cleanupCount !== 1) {
    throw new Error("Synthetic custom-auth account cleanup did not remove one user");
  }

  report = {
    schemaVersion: 3,
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
      sessionProbePassed: true,
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
  if (uri && authEmail && cleanupCount === 0) {
    try {
      cleanupCount = await cleanupAccount(uri, authEmail);
    } catch {
      // Preserve the primary failure.
    }
  }
  report = {
    schemaVersion: 3,
    status: "failed",
    workerName: WORKER_NAME,
    gitSha,
    runId: GITHUB_RUN_ID || null,
    syntheticAuthCleanupCount: cleanupCount,
    error: redact(error instanceof Error ? error.message : error, uri),
  };
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rm(configPath, { force: true });
  authEmail = "";
  authPassword = "";
}
