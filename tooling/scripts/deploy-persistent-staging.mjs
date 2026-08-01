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
const NEON_AUTH_URL =
  "https://ep-floral-mud-afb4twms.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth";
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
    "NEON_API_KEY, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for persistent staging deployment",
  );
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "staging");
const browserArtifactsDir = path.join(artifactsDir, "browser");
const reportPath = path.join(artifactsDir, "persistent-staging-report.json");
const configPath = path.join(root, ".wrangler-persistent-staging.json");
const neonApiBase = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;
const cloudflareApiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
const gitSha = GITHUB_SHA || "manual";
let authPassword = "";
let authEmail = "";

function redact(value, connectionString = "") {
  let output = String(value || "")
    .replaceAll(NEON_API_KEY, "[REDACTED_NEON_TOKEN]")
    .replaceAll(CLOUDFLARE_API_TOKEN, "[REDACTED_CLOUDFLARE_TOKEN]")
    .replaceAll(CLOUDFLARE_ACCOUNT_ID, "[REDACTED_CLOUDFLARE_ACCOUNT]")
    .replaceAll(connectionString, "[REDACTED_DATABASE_URL]")
    .replace(/postgresql:\/\/[^\s"']+/gu, "[REDACTED_DATABASE_URL]")
    .replace(/\u001b\[[0-9;]*m/gu, "");
  if (authPassword) output = output.replaceAll(authPassword, "[REDACTED_AUTH_PASSWORD]");
  if (authEmail) output = output.replaceAll(authEmail, "[REDACTED_AUTH_EMAIL]");
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
      else {
        reject(
          new Error(
            `${command} exited with code ${code}: ${redact(output, options.secret)}`,
          ),
        );
      }
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
  if (
    typeof response?.uri !== "string" ||
    !response.uri.startsWith("postgresql://")
  ) {
    throw new Error("Neon API did not return the dedicated staging connection URI");
  }
  return response.uri;
}

async function withDatabase(connectionString, work) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function migrationSummary(connectionString) {
  return await withDatabase(connectionString, async (client) => {
    const migrations = await client.query(
      "SELECT count(*)::int AS count FROM platform.schema_migrations",
    );
    const tenants = await client.query(
      "SELECT count(*)::int AS count FROM platform.tenants WHERE code LIKE 'synthetic-%'",
    );
    const authTables = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'neon_auth'",
    );
    return {
      migrations: migrations.rows[0]?.count ?? 0,
      syntheticTenants: tenants.rows[0]?.count ?? 0,
      neonAuthTables: authTables.rows[0]?.count ?? 0,
    };
  });
}

async function configureTrustedOrigin(connectionString, baseUrl) {
  return await withDatabase(connectionString, async (client) => {
    const result = await client.query(
      `UPDATE neon_auth.project_config
       SET trusted_origins = jsonb_build_array($1::text), updated_at = now()
       WHERE endpoint_id = 'ep-floral-mud-afb4twms'
       RETURNING trusted_origins`,
      [baseUrl],
    );
    if (result.rowCount !== 1) {
      throw new Error("Neon Auth trusted origin could not be configured");
    }
    return true;
  });
}

async function cleanupAuthUser(connectionString, email) {
  if (!email) return 0;
  return await withDatabase(connectionString, async (client) => {
    const result = await client.query(
      `DELETE FROM neon_auth."user"
       WHERE email = $1
         AND email LIKE 'staging-smoke-%@example.com'
       RETURNING id`,
      [email],
    );
    return result.rowCount ?? 0;
  });
}

async function resolveWorkerUrl() {
  await cloudflareApi(`/workers/scripts/${encodeURIComponent(WORKER_NAME)}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  const subdomain = await cloudflareApi("/workers/subdomain");
  if (
    typeof subdomain?.subdomain !== "string" ||
    subdomain.subdomain.length === 0
  ) {
    throw new Error("Cloudflare Workers subdomain is unavailable");
  }
  return `https://${WORKER_NAME}.${subdomain.subdomain}.workers.dev`;
}

function responseSetCookies(response) {
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

async function createSyntheticAuthSession(baseUrl) {
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
      "User-Agent": "Ozzyl-Persistent-Staging-Smoke",
    },
    body: new URLSearchParams({
      name: "Staging Smoke User",
      email: authEmail,
      password: authPassword,
      returnTo: "/admin",
    }),
  });
  const cookies = responseSetCookies(response);
  const sessionCookie = cookieHeader(cookies);
  if (response.status !== 303 || !sessionCookie) {
    const body = await response.text();
    throw new Error(
      `Synthetic staging sign-up failed with HTTP ${response.status}: ${redact(body)}`,
    );
  }
  return {
    cookie: sessionCookie,
    cookiesSet: cookies.length,
    returnLocation: response.headers.get("location"),
  };
}

async function probe(
  baseUrl,
  pathname,
  expectedMarker,
  expectedStatus = 200,
  headers = {},
) {
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
      if (response.status !== expectedStatus) {
        throw new Error(`${pathname} returned HTTP ${response.status}`);
      }
      if (expectedMarker && !body.includes(expectedMarker)) {
        throw new Error(`${pathname} did not include the expected marker`);
      }
      return {
        pathname,
        status: response.status,
        marker: expectedMarker,
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
  }
  throw lastError ?? new Error(`${pathname} staging probe failed`);
}

async function loginBrowser(page, axeSource, baseUrl) {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const response = await page.goto(`${baseUrl}/login?returnTo=%2Fadmin`, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });
  if (!response || response.status() !== 200) {
    throw new Error(`Staging login page returned ${response?.status() ?? "no response"}`);
  }
  await page.addScriptTag({ content: axeSource });
  const accessibility = await page.evaluate(async () =>
    globalThis.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa"],
      },
    }),
  );
  const loginLayout = await page.evaluate(() => ({
    mainCount: document.querySelectorAll("main").length,
    h1Count: document.querySelectorAll("h1").length,
    horizontalOverflow:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 2,
    hasStagingNotice: (document.body.textContent ?? "").includes(
      "Persistent staging",
    ),
  }));
  const screenshotPath = path.join(browserArtifactsDir, "login-mobile.jpg");
  await page.screenshot({
    path: screenshotPath,
    type: "jpeg",
    quality: 82,
    fullPage: true,
  });
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
  const result = {
    id: "login-mobile",
    pathname: "/login",
    viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
    violations: accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    })),
    layout: loginLayout,
    signedIn,
    screenshot: path.relative(root, screenshotPath),
  };
  const passed =
    result.violations.length === 0 &&
    result.layout.mainCount === 1 &&
    result.layout.h1Count === 1 &&
    result.layout.hasStagingNotice &&
    !result.layout.horizontalOverflow &&
    result.signedIn;
  if (!passed) throw new Error("Live Neon Auth browser sign-in evidence failed");
  return { ...result, passed };
}

async function browserScenario(browser, axeSource, baseUrl, scenario) {
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.setViewport(scenario.viewport);
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    const response = await page.goto(`${baseUrl}${scenario.pathname}`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    if (!response || response.status() !== 200) {
      throw new Error(
        `${scenario.pathname} browser navigation returned ${response?.status() ?? "no response"}`,
      );
    }
    await page.addScriptTag({ content: axeSource });
    const accessibility = await page.evaluate(async () =>
      globalThis.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa"],
        },
      }),
    );
    const layout = await page.evaluate((kind) => {
      const bodyText = document.body.textContent ?? "";
      const documentElement = document.documentElement;
      const checkout = document.querySelector(".modd-complete");
      return {
        title: document.title,
        mainCount: document.querySelectorAll("main").length,
        h1Count: document.querySelectorAll("h1").length,
        hasStagingNotice: bodyText.includes("Persistent staging"),
        hasAuthenticatedIdentity: bodyText.includes("Signed in as"),
        hasAdminInventoryLink:
          kind === "admin"
            ? document.querySelector('a[href="/admin/inventory"]') !== null
            : null,
        checkoutDisabled:
          kind === "pos" && checkout instanceof HTMLButtonElement
            ? checkout.disabled
            : null,
        leakedDatabaseUrl: bodyText.includes("postgresql://"),
        horizontalOverflow:
          documentElement.scrollWidth > documentElement.clientWidth + 2,
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
      const skipTarget = await page.evaluate(
        () => document.activeElement?.id ?? "",
      );
      keyboard = { firstFocus, skipTarget };
    }

    const screenshotPath = path.join(browserArtifactsDir, `${scenario.id}.jpg`);
    await page.screenshot({
      path: screenshotPath,
      type: "jpeg",
      quality: 82,
      fullPage: true,
    });

    const result = {
      id: scenario.id,
      pathname: scenario.pathname,
      viewport: scenario.viewport,
      violations: accessibility.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
      layout,
      keyboard,
      screenshot: path.relative(root, screenshotPath),
    };

    const passed =
      result.violations.length === 0 &&
      result.layout.mainCount === 1 &&
      result.layout.h1Count >= 1 &&
      result.layout.hasStagingNotice &&
      result.layout.hasAuthenticatedIdentity &&
      !result.layout.leakedDatabaseUrl &&
      !result.layout.horizontalOverflow &&
      (scenario.kind !== "admin" ||
        (result.layout.hasAdminInventoryLink === true &&
          result.keyboard?.firstFocus.className === "skip-link" &&
          result.keyboard?.firstFocus.outline !== "none" &&
          result.keyboard?.skipTarget === "main")) &&
      (scenario.kind !== "pos" || result.layout.checkoutDisabled === true);

    if (!passed) {
      throw new Error(`${scenario.pathname} live browser evidence failed`);
    }
    return { ...result, passed };
  } finally {
    await page.close();
  }
}

async function verifyBrowserLogout(browser, baseUrl) {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/admin`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60_000 }),
      page.click('form[action="/auth/sign-out"] button[type="submit"]'),
    ]);
    const logoutDestination = new URL(page.url()).pathname;
    await page.goto(`${baseUrl}/admin`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    return {
      passed:
        logoutDestination === "/login" &&
        new URL(page.url()).pathname === "/login",
    };
  } finally {
    await page.close();
  }
}

async function runBrowserEvidence(baseUrl) {
  const executablePath = CHROME_PATH || "/usr/bin/google-chrome";
  const axeSource = await readFile(
    path.join(root, "node_modules", "axe-core", "axe.min.js"),
    "utf8",
  );
  await mkdir(browserArtifactsDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const loginPage = await browser.newPage();
    await loginPage.setBypassCSP(true);
    const login = await loginBrowser(loginPage, axeSource, baseUrl);
    await loginPage.close();

    const scenarios = [
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
    ];
    const results = [login];
    for (const scenario of scenarios) {
      results.push(await browserScenario(browser, axeSource, baseUrl, scenario));
    }
    const logout = await verifyBrowserLogout(browser, baseUrl);
    if (!logout.passed) throw new Error("Live Neon Auth browser logout evidence failed");
    return { scenarios: results, logout };
  } finally {
    await browser.close();
  }
}

await mkdir(artifactsDir, { recursive: true });
await rm(reportPath, { force: true });
let connectionString = "";
let report;
let authCleanupCount = 0;
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
  if (database.neonAuthTables < 9) {
    throw new Error("Dedicated staging Neon Auth schema is incomplete");
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
          NEON_AUTH_URL,
          OIDC_ISSUER: "https://staging-identity.invalid",
          OIDC_AUDIENCE: "store-management-api-staging",
          OIDC_JWKS_URI:
            "https://staging-identity.invalid/.well-known/jwks.json",
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
  await configureTrustedOrigin(connectionString, baseUrl);
  const authSession = await createSyntheticAuthSession(baseUrl);
  const authenticatedHeaders = { Cookie: authSession.cookie };
  const probes = [];
  probes.push(await probe(baseUrl, "/", "", 302));
  probes.push(await probe(baseUrl, "/login", "Sign in to staging"));
  probes.push(await probe(baseUrl, "/admin", "", 302));
  probes.push(
    await probe(
      baseUrl,
      "/admin",
      "Persistent staging",
      200,
      authenticatedHeaders,
    ),
  );
  probes.push(
    await probe(
      baseUrl,
      "/admin/inventory",
      "Inventory",
      200,
      authenticatedHeaders,
    ),
  );
  probes.push(
    await probe(
      baseUrl,
      "/admin/procurement",
      "Procurement",
      200,
      authenticatedHeaders,
    ),
  );
  probes.push(
    await probe(
      baseUrl,
      "/pos",
      "Persistent staging · synthetic POS",
      200,
      authenticatedHeaders,
    ),
  );
  probes.push(await probe(baseUrl, "/api/health", '"status":"healthy"'));
  probes.push(
    await probe(
      baseUrl,
      "/auth/session",
      '"authenticated":true',
      200,
      authenticatedHeaders,
    ),
  );
  probes.push(
    await probe(
      baseUrl,
      "/staging/status",
      '"neon-auth-required"',
    ),
  );
  const browserEvidence = await runBrowserEvidence(baseUrl);
  authCleanupCount = await cleanupAuthUser(connectionString, authEmail);
  if (authCleanupCount !== 1) {
    throw new Error("Synthetic Neon Auth user cleanup did not remove exactly one user");
  }

  report = {
    schemaVersion: 2,
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
      provider: "neon-auth",
      required: true,
      trustedOriginConfigured: true,
      syntheticAccountCreated: true,
      syntheticAccountCleaned: authCleanupCount === 1,
      cookiesSet: authSession.cookiesSet,
      anonymousRedirectPassed: true,
      sessionProbePassed: true,
      browserLoginPassed: browserEvidence.scenarios[0]?.passed === true,
      browserLogoutPassed: browserEvidence.logout.passed,
      credentialsPersisted: false,
    },
    probes,
    browser: browserEvidence.scenarios,
    persistent: true,
    syntheticOnly: true,
    authoritativeBrowserWritesEnabled: false,
  };
  console.log(`Persistent staging deployment passed at ${baseUrl}`);
} catch (error) {
  if (connectionString && authEmail && authCleanupCount === 0) {
    try {
      authCleanupCount = await cleanupAuthUser(connectionString, authEmail);
    } catch {
      // The redacted report records the primary deployment failure.
    }
  }
  report = {
    schemaVersion: 2,
    status: "failed",
    workerName: WORKER_NAME,
    gitSha,
    runId: GITHUB_RUN_ID || null,
    syntheticAuthCleanupCount: authCleanupCount,
    error: redact(
      error instanceof Error ? error.message : error,
      connectionString,
    ),
  };
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rm(configPath, { force: true });
  authPassword = "";
  authEmail = "";
}
