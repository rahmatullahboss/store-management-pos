import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const WRANGLER_VERSION = "4.114.0";
const PREVIEW_ALIAS = "gate";
const REMOTE_DEV_PORT = 8787;
const {
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  GITHUB_RUN_ID,
  GITHUB_SHA
} = process.env;

if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for Foundation Cloudflare preview CI");
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "foundation");
const safeRun = (GITHUB_RUN_ID || Date.now().toString()).replace(/[^0-9]/g, "").slice(-14);
const workerName = `store-pos-fnd-${safeRun}`;
const configPath = path.join(root, `.wrangler-${workerName}.json`);
const metafilePath = path.join(artifactsDir, "cloudflare-bundle-meta.json");
const reportPath = path.join(artifactsDir, "cloudflare-preview-report.json");
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
let deployOutput = "";
let previewOutput = "";
let remoteDevOutput = "";
let remoteDevProcess = null;

function redact(value) {
  return String(value || "")
    .replaceAll(CLOUDFLARE_API_TOKEN, "[REDACTED_TOKEN]")
    .replaceAll(CLOUDFLARE_ACCOUNT_ID, "[REDACTED_ACCOUNT]")
    .replace(/\u001b\[[0-9;]*m/gu, "");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else {
        const error = new Error(`${command} exited with code ${code}`);
        error.commandOutput = redact(output);
        reject(error);
      }
    });
  });
}

function startRemoteDev() {
  const child = spawn("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "dev",
    "--remote",
    "--config",
    configPath,
    "--name",
    workerName,
    "--ip",
    "127.0.0.1",
    "--port",
    String(REMOTE_DEV_PORT),
    "--local-protocol",
    "http",
    "--log-level",
    "info"
  ], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    remoteDevOutput += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    remoteDevOutput += text;
    process.stderr.write(text);
  });
  child.on("error", (error) => {
    remoteDevOutput += `\nremote dev process error: ${error.message}`;
  });
  return child;
}

async function stopRemoteDev() {
  if (!remoteDevProcess || remoteDevProcess.exitCode !== null) return;
  remoteDevProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => remoteDevProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (remoteDevProcess.exitCode === null) remoteDevProcess.kill("SIGKILL");
}

async function cloudflare(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const messages = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare API ${response.status}${messages ? `: ${messages}` : ""}`);
  }
  return payload?.result;
}

async function ensurePreviewUrls() {
  const result = await cloudflare(`/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, previews_enabled: true })
  });
  if (!result?.previews_enabled) throw new Error("Cloudflare Worker preview URLs could not be enabled");
  return result;
}

async function deleteWorker() {
  const response = await fetch(`${apiBase}/workers/scripts/${encodeURIComponent(workerName)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` }
  });
  if (response.status === 404) return false;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const messages = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare cleanup ${response.status}${messages ? `: ${messages}` : ""}`);
  }
  return true;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestHealth(url) {
  const started = performance.now();
  const response = await fetch(url, { headers: { "x-foundation-gate": GITHUB_RUN_ID || "manual" } });
  const elapsedMs = performance.now() - started;
  const responseText = await response.text();
  let body = null;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = null;
  }
  if (!response.ok || body?.status !== "healthy" || body?.service !== "api") {
    throw new Error(`Cloudflare health check failed at ${url} with HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
  return { elapsedMs, body };
}

async function awaitHealth(url, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestHealth(url);
    } catch (error) {
      lastError = error;
      if (remoteDevProcess?.exitCode !== null && url.includes("127.0.0.1")) {
        throw new Error(`Cloudflare remote preview exited before becoming ready: ${redact(remoteDevOutput).slice(-1000)}`);
      }
      await sleep(2500);
    }
  }
  throw lastError || new Error(`Cloudflare health check did not become ready at ${url}`);
}

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentage) - 1);
  return sorted[index];
}

async function resolvePreviewUrl(output) {
  const urls = [...output.matchAll(/https:\/\/[a-z0-9.-]+\.workers\.dev/giu)].map((match) => match[0]);
  const aliasPrefix = `https://${PREVIEW_ALIAS}-${workerName}.`;
  const aliasUrl = urls.find((url) => url.startsWith(aliasPrefix));
  if (aliasUrl) return `${aliasUrl}/health`;
  const accountSubdomain = await cloudflare("/workers/subdomain");
  if (!accountSubdomain?.subdomain) throw new Error("Cloudflare account Workers subdomain is unavailable");
  return `${aliasPrefix}${accountSubdomain.subdomain}.workers.dev/health`;
}

async function readBundleMetrics() {
  const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  const outputs = Object.entries(metafile.outputs || {});
  const scriptBytes = outputs
    .filter(([name]) => name.endsWith(".js"))
    .reduce((total, [, output]) => total + Number(output.bytes || 0), 0);
  const sourceMapBytes = outputs
    .filter(([name]) => name.endsWith(".map"))
    .reduce((total, [, output]) => total + Number(output.bytes || 0), 0);
  return { scriptBytes, sourceMapBytes, totalBytes: scriptBytes + sourceMapBytes };
}

async function writeFailureReport(error) {
  let bundle = null;
  try {
    bundle = await readBundleMetrics();
  } catch {
    bundle = null;
  }
  const report = {
    schemaVersion: 1,
    status: "failed",
    workerName,
    previewAlias: PREVIEW_ALIAS,
    wranglerVersion: WRANGLER_VERSION,
    gitSha: GITHUB_SHA || null,
    runId: GITHUB_RUN_ID || null,
    bundle,
    error: redact(error?.message || error),
    commandOutput: error?.commandOutput || redact(`${deployOutput}\n${previewOutput}\n${remoteDevOutput}`) || null
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

await mkdir(artifactsDir, { recursive: true });
await writeFile(configPath, `${JSON.stringify({
  name: workerName,
  main: "apps/api/src/index.ts",
  compatibility_date: "2026-07-27",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: true,
  preview_urls: true,
  observability: {
    enabled: true,
    logs: {
      invocation_logs: true,
      head_sampling_rate: 1
    }
  },
  vars: {
    APP_ENV: "foundation-ci",
    REGION: "cloudflare-global",
    OIDC_ISSUER: "https://foundation.invalid",
    OIDC_AUDIENCE: "store-management-api",
    OIDC_JWKS_URI: "https://foundation.invalid/.well-known/jwks.json",
    OIDC_MFA_ACR_VALUES: "urn:foundation:mfa"
  }
}, null, 2)}\n`, "utf8");

try {
  deployOutput = await run("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "deploy",
    "--config",
    configPath,
    "--name",
    workerName,
    "--minify",
    "--metafile",
    metafilePath,
    "--message",
    `Foundation gate bootstrap ${GITHUB_SHA || "manual"}`
  ]);

  const subdomainState = await ensurePreviewUrls();
  previewOutput = await run("npx", [
    "--yes",
    `wrangler@${WRANGLER_VERSION}`,
    "versions",
    "upload",
    "--config",
    configPath,
    "--name",
    workerName,
    "--minify",
    "--preview-alias",
    PREVIEW_ALIAS,
    "--message",
    `Foundation gate preview ${GITHUB_SHA || "manual"}`
  ]);

  const publicPreviewUrl = await resolvePreviewUrl(previewOutput);
  const publicPreviewProbe = { reachable: false, elapsedMs: null, error: null };
  try {
    const publicResponse = await awaitHealth(publicPreviewUrl, 4);
    publicPreviewProbe.reachable = true;
    publicPreviewProbe.elapsedMs = Number(publicResponse.elapsedMs.toFixed(2));
  } catch (error) {
    publicPreviewProbe.error = redact(error.message);
  }

  const benchmarkMode = "remote-preview-proxy";
  const benchmarkUrl = `http://127.0.0.1:${REMOTE_DEV_PORT}/health`;
  remoteDevProcess = startRemoteDev();
  const firstRequest = await awaitHealth(benchmarkUrl, 24);

  const sequential = [];
  for (let index = 0; index < 20; index += 1) sequential.push((await requestHealth(benchmarkUrl)).elapsedMs);
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => requestHealth(benchmarkUrl)));
  const concurrentLatencies = concurrent.map((result) => result.elapsedMs);
  const bundle = await readBundleMetrics();
  const report = {
    schemaVersion: 1,
    status: "passed",
    workerName,
    previewAlias: PREVIEW_ALIAS,
    publicPreviewUrl,
    publicPreviewProbe,
    benchmarkMode,
    benchmarkUrl,
    wranglerVersion: WRANGLER_VERSION,
    gitSha: GITHUB_SHA || null,
    runId: GITHUB_RUN_ID || null,
    bundle,
    subdomain: subdomainState,
    firstRequestMs: Number(firstRequest.elapsedMs.toFixed(2)),
    sequential: {
      count: sequential.length,
      p50Ms: Number(percentile(sequential, 0.5).toFixed(2)),
      p95Ms: Number(percentile(sequential, 0.95).toFixed(2)),
      maxMs: Number(Math.max(...sequential).toFixed(2))
    },
    concurrent: {
      count: concurrentLatencies.length,
      p50Ms: Number(percentile(concurrentLatencies, 0.5).toFixed(2)),
      p95Ms: Number(percentile(concurrentLatencies, 0.95).toFixed(2)),
      maxMs: Number(Math.max(...concurrentLatencies).toFixed(2))
    },
    health: firstRequest.body
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFailureReport(error);
  throw error;
} finally {
  await stopRemoteDev();
  try {
    if (await deleteWorker()) console.log(`deleted Cloudflare preview worker ${workerName}`);
  } catch (error) {
    console.error(`failed to delete Cloudflare preview worker ${workerName}: ${error.message}`);
    process.exitCode = 1;
  }
  await rm(configPath, { force: true });
}
