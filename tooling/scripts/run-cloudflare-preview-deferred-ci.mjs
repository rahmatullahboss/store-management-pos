import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_RUN_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for the Cloudflare preview supervisor");
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const scriptsDir = path.join(root, "tooling", "scripts");
const artifactsDir = path.join(root, "artifacts", "foundation");
const reportPath = path.join(artifactsDir, "cloudflare-preview-report.json");
const sourcePath = path.join(scriptsDir, "cloudflare-preview-ci.mjs");
const runtimePath = path.join(scriptsDir, `.cloudflare-preview-deferred-${process.pid}.mjs`);
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
const currentWorkerName = GITHUB_RUN_ID
  ? `store-pos-fnd-${GITHUB_RUN_ID.replace(/[^0-9]/g, "").slice(-14)}`
  : null;
const timeoutMs = 240_000;

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  console.log(`deleted stale Cloudflare CI worker ${workerName}`);
}

async function cleanupCurrentRunWorker() {
  if (!currentWorkerName) return;
  await deleteWorker(currentWorkerName);
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
await cleanupCurrentRunWorker();

const source = await readFile(sourcePath, "utf8");
const eagerCleanup = `  try {\n    if (await deleteWorker()) console.log(\`deleted Cloudflare preview worker \${workerName}\`);\n  } catch (error) {\n    console.error(\`failed to delete Cloudflare preview worker \${workerName}: \${error.message}\`);\n    process.exitCode = 1;\n  }\n`;
const eagerPreviewEnable = `async function ensurePreviewUrls() {\n  const result = await cloudflare(\`/workers/scripts/\${encodeURIComponent(workerName)}/subdomain\`, {\n    method: "POST",\n    body: JSON.stringify({ enabled: true, previews_enabled: true })\n  });\n  if (!result?.previews_enabled) throw new Error("Cloudflare Worker preview URLs could not be enabled");\n  return result;\n}\n`;
const resilientPreviewEnable = `async function ensurePreviewUrls() {\n  let lastError;\n  for (let attempt = 1; attempt <= 8; attempt += 1) {\n    try {\n      const result = await cloudflare(\`/workers/scripts/\${encodeURIComponent(workerName)}/subdomain\`, {\n        method: "POST",\n        body: JSON.stringify({ enabled: true, previews_enabled: true })\n      });\n      if (!result?.previews_enabled) throw new Error("Cloudflare Worker preview URLs could not be enabled");\n      return result;\n    } catch (error) {\n      lastError = error;\n      const message = String(error?.message || error);\n      if (!message.includes("10007") && !message.includes("does not exist") && !message.includes("not found")) throw error;\n      if (attempt < 8) await sleep(2000);\n    }\n  }\n  throw lastError || new Error("Cloudflare Worker preview URL propagation timed out");\n}\n`;
let runtimeSource = source.replace(eagerCleanup, "");
if (runtimeSource === source) throw new Error("Cloudflare deferred-cleanup transformation did not match the expected cleanup block");
const previewPatchedSource = runtimeSource.replace(eagerPreviewEnable, resilientPreviewEnable);
if (previewPatchedSource === runtimeSource) throw new Error("Cloudflare preview propagation transformation did not match the expected enable block");
runtimeSource = previewPatchedSource;
await writeFile(runtimePath, runtimeSource, "utf8");

const child = spawn(process.execPath, [runtimePath], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: "inherit"
});
let childError = null;
child.on("error", (error) => {
  childError = error;
});

try {
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
  if (!report) throw childError || new Error(`Cloudflare preview did not produce a report within ${timeoutMs} ms`);
  if (report.status !== "passed") throw new Error(report.error || "Cloudflare preview validation failed");
  console.log(`Cloudflare Foundation evidence passed via ${report.benchmarkMode}; cleanup deferred until runtime metrics complete`);
} finally {
  await stopProcessGroup(child);
  await rm(runtimePath, { force: true });
}
