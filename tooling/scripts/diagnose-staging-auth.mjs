import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import puppeteer from "puppeteer-core";

const baseUrl = "https://store-pos-staging.rahmatullahzisan.workers.dev";
const projectId = "morning-flower-46531465";
const branchId = "br-empty-sound-afkx5vkj";
const databaseName = "neondb";
const roleName = "neondb_owner";
const { NEON_API_KEY, CHROME_PATH, GITHUB_RUN_ID } = process.env;
if (!NEON_API_KEY) throw new Error("NEON_API_KEY is required for auth diagnostics");

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "artifacts", "staging", "auth-diagnostics");
await mkdir(outputDir, { recursive: true });
const email = `staging-smoke-diagnostic-${GITHUB_RUN_ID || Date.now()}-${randomBytes(4).toString("hex")}@example.com`;
const password = `Stg-${randomBytes(24).toString("base64url")}!9a`;

function setCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length > 0) return values;
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function cookieHeader(values) {
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function postForm(pathname, values, cookie = "") {
  return await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Ozzyl-Staging-Auth-Diagnostic",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(values),
  });
}

async function connectionString() {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${NEON_API_KEY}` } },
  );
  if (!response.ok) throw new Error(`Neon connection URI lookup failed with ${response.status}`);
  const body = await response.json();
  if (typeof body.uri !== "string") throw new Error("Neon connection URI is unavailable");
  return body.uri;
}

async function cleanup() {
  const client = new Client({ connectionString: await connectionString() });
  await client.connect();
  try {
    const result = await client.query(
      `DELETE FROM neon_auth."user"
       WHERE email = $1
         AND email LIKE 'staging-smoke-diagnostic-%@example.com'
       RETURNING id`,
      [email],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

const report = {
  schemaVersion: 1,
  direct: {},
  browser: {},
  cleanupCount: 0,
};
try {
  const signup = await postForm("/auth/sign-up", {
    name: "Staging Diagnostic User",
    email,
    password,
    returnTo: "/admin",
  });
  const signupCookies = setCookies(signup);
  const signupCookie = cookieHeader(signupCookies);
  const signupSession = await fetch(`${baseUrl}/auth/session`, {
    headers: signupCookie ? { Cookie: signupCookie } : {},
    redirect: "manual",
  });
  report.direct.signup = {
    status: signup.status,
    locationPath: signup.headers.get("location")
      ? new URL(signup.headers.get("location")).pathname
      : null,
    cookieNames: signupCookies.map((value) => value.split("=", 1)[0]),
    sessionStatus: signupSession.status,
  };

  if (signupCookie) {
    await postForm("/auth/sign-out", {}, signupCookie);
  }
  const signin = await postForm("/auth/sign-in", {
    email,
    password,
    returnTo: "/admin",
  });
  const signinCookies = setCookies(signin);
  const signinCookie = cookieHeader(signinCookies);
  const signinSession = await fetch(`${baseUrl}/auth/session`, {
    headers: signinCookie ? { Cookie: signinCookie } : {},
    redirect: "manual",
  });
  report.direct.signin = {
    status: signin.status,
    locationPath: signin.headers.get("location")
      ? new URL(signin.headers.get("location")).pathname
      : null,
    cookieNames: signinCookies.map((value) => value.split("=", 1)[0]),
    sessionStatus: signinSession.status,
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/login?returnTo=%2Fadmin`, {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    await page.type("#signin-email", email);
    await page.type("#signin-password", password);
    const typedLengths = await page.evaluate(() => ({
      email: document.querySelector("#signin-email")?.value.length ?? 0,
      password: document.querySelector("#signin-password")?.value.length ?? 0,
    }));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60_000 }),
      page.click('form[action="/auth/sign-in"] button[type="submit"]'),
    ]);
    const state = await page.evaluate(() => ({
      path: location.pathname,
      queryKeys: [...new URLSearchParams(location.search).keys()],
      hasSignedInText: (document.body.textContent ?? "").includes("Signed in as"),
      hasErrorPanel: document.querySelector('[role="alert"]') !== null,
      errorTextLength: document.querySelector('[role="alert"]')?.textContent?.length ?? 0,
    }));
    const cookies = await page.cookies();
    const screenshotPath = path.join(outputDir, "post-signin.jpg");
    await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 82, fullPage: true });
    report.browser = {
      typedLengths,
      ...state,
      cookieNames: cookies.map((cookie) => cookie.name).sort(),
      screenshot: path.relative(root, screenshotPath),
    };
  } finally {
    await browser.close();
  }
} finally {
  report.cleanupCount = await cleanup();
  await writeFile(
    path.join(outputDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

console.log("Redacted staging auth diagnostics completed.");
