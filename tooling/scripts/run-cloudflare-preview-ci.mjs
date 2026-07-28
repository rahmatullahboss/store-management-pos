import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for the Cloudflare preview supervisor");
}

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const artifactsDir = path.join(root, "artifacts", "foundation");
const reportPath = path.join(artifactsDir, "cloudflare-preview-report.json");
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
const workerPrefix = "store-pos-fnd-";
const timeoutMs = 240_000;

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function deleteWorker(workerName) {
  const response = await fetch(`${apiBase}/workers/scripts/${encodeURIComponent(workerName)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` }
  });
  if (response.status === 404) return;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const messages = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare cleanup ${response.status}${messages ? `: ${messages}` : ""}`);
  }
  console.log(`deleted Cloudflare CI worker ${workerName}`);
}

async function cleanupStaleWorkers() {
  const scripts = await cloudflare("/workers/scripts");
  const names = Array.isArray(scripts) ? scripts.map((script) => script.id || script.name).filter(Boolean) : [];
  for (const workerName of names.filter((name) => name.startsWith(workerPrefix))) {
    await deleteWorker(workerName);
  }
}

async function readReport() {
  try {
    return JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    return null;
  }
}

async function stopProcessGroup(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5000)
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

await mkdir(artifactsDir, { recursive: true });
await rm(reportPath, { force: true });
await cleanupStaleWorkers();

const child = spawn(process.execPath, ["tooling/scripts/cloudflare-preview-ci.mjs"], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: "inherit"
});

let childError = null;
child.on("error", (error) => {
  childError = error;
});

const deadline = Date.now() + timeoutMs;
let report = null;
while (Date.now() < deadline) {
  report = await readReport();
  if (report?.status === "passed" || report?.status === "failed") break;
  if (childError) break;
  if (child.exitCode !== null) {
    report = await readReport();
    break;
  }
  await sleep(500);
}

await stopProcessGroup(child);
report = report || await readReport();
if (report?.workerName) await deleteWorker(report.workerName);

if (!report) {
  throw childError || new Error(`Cloudflare preview did not produce a report within ${timeoutMs} ms`);
}
if (report.status !== "passed") {
  throw new Error(report.error || "Cloudflare preview validation failed");
}

console.log(`Cloudflare Foundation evidence passed via ${report.benchmarkMode}`);
