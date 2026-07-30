import { spawn } from "node:child_process";
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
      throw new Error(`${scenario.pathname} browser navigation returned ${response?.status() ?? "no response"}`);
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
      const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");
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
    const results = [];
    for (const scenario of scenarios) {
      results.push(await browserScenario(browser, axeSource, baseUrl, scenario));
    }
    return results;
  } finally {
    await browser.close();
  }
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
  const browser = await runBrowserEvidence(baseUrl);

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
    browser,
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
