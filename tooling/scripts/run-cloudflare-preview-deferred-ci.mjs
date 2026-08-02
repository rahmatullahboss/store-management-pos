import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_PREVIEW_DELETIONS,
  DEFAULT_STALE_PREVIEW_AGE_MS,
  isCloudflareWorkerQuotaError,
  selectStaleStorefrontPreviewWorkers,
} from "./cloudflare-preview-retention.mjs";

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_RUN_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error(
    "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for the Cloudflare preview supervisor",
  );
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const scriptsDir = path.join(root, "tooling", "scripts");
const artifactsDir = path.join(root, "artifacts", "foundation");
const reportPath = path.join(artifactsDir, "cloudflare-preview-report.json");
const retentionReportPath = path.join(
  artifactsDir,
  "cloudflare-preview-retention.json",
);
const sourcePath = path.join(scriptsDir, "cloudflare-preview-ci.mjs");
const runtimePath = path.join(
  scriptsDir,
  `.cloudflare-preview-deferred-${process.pid}.mjs`,
);
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
const currentWorkerName = GITHUB_RUN_ID
  ? `store-pos-fnd-${GITHUB_RUN_ID.replace(/[^0-9]/g, "").slice(-14)}`
  : null;
const timeoutMs = 240_000;
const maximumListPages = 2;

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cloudflare(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const messages = payload?.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Cloudflare API ${response.status}${messages ? `: ${messages}` : ""}`,
    );
  }
  return payload;
}

async function deleteWorker(workerName) {
  const response = await fetch(
    `${apiBase}/workers/scripts/${encodeURIComponent(workerName)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    },
  );
  if (response.status === 404) return false;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const messages = payload?.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Cloudflare cleanup ${response.status}${messages ? `: ${messages}` : ""}`,
    );
  }
  console.log(`deleted repository-owned Cloudflare CI worker ${workerName}`);
  return true;
}

async function cleanupCurrentRunWorker() {
  if (!currentWorkerName) return;
  await deleteWorker(currentWorkerName);
}

async function listWorkers() {
  const workers = [];
  for (let page = 1; page <= maximumListPages; page += 1) {
    const payload = await cloudflare(
      `/workers/scripts?page=${page}&per_page=100`,
    );
    if (!Array.isArray(payload?.result)) {
      throw new Error("Cloudflare Worker inventory response is invalid");
    }
    workers.push(...payload.result);
    const totalPages = Number(payload?.result_info?.total_pages ?? 1);
    if (!Number.isFinite(totalPages) || page >= totalPages) break;
  }
  return workers;
}

async function pruneStaleOwnedWorkers() {
  const inventory = await listWorkers();
  const candidates = selectStaleStorefrontPreviewWorkers(inventory, {
    currentWorkerName,
    nowMs: Date.now(),
    minimumAgeMs: DEFAULT_STALE_PREVIEW_AGE_MS,
    maxDeletions: DEFAULT_MAX_PREVIEW_DELETIONS,
  });
  const deleted = [];
  for (const candidate of candidates) {
    if (await deleteWorker(candidate.id)) deleted.push(candidate);
  }
  const retentionReport = {
    schemaVersion: 1,
    status: deleted.length > 0 ? "pruned" : "no-eligible-workers",
    currentWorkerName,
    ownedWorkerPrefix: "store-pos-fnd-",
    minimumAgeMs: DEFAULT_STALE_PREVIEW_AGE_MS,
    maximumDeletions: DEFAULT_MAX_PREVIEW_DELETIONS,
    inventoryCount: inventory.length,
    eligibleCount: candidates.length,
    deleted,
  };
  await writeFile(
    retentionReportPath,
    `${JSON.stringify(retentionReport, null, 2)}\n`,
    "utf8",
  );
  return deleted;
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
    sleep(5000),
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function runPreviewAttempt() {
  await rm(reportPath, { force: true });
  const child = spawn(process.execPath, [runtimePath], {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: "inherit",
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
    if (!report) {
      throw childError || new Error(
        `Cloudflare preview did not produce a report within ${timeoutMs} ms`,
      );
    }
    return report;
  } finally {
    await stopProcessGroup(child);
  }
}

await mkdir(artifactsDir, { recursive: true });
await rm(reportPath, { force: true });
await rm(retentionReportPath, { force: true });
await cleanupCurrentRunWorker();

const source = await readFile(sourcePath, "utf8");
const eagerCleanup = `  try {\n    if (await deleteWorker()) console.log(\`deleted Cloudflare preview worker \${workerName}\`);\n  } catch (error) {\n    console.error(\`failed to delete Cloudflare preview worker \${workerName}: \${error.message}\`);\n    process.exitCode = 1;\n  }\n`;
const eagerPreviewEnable = `async function ensurePreviewUrls() {\n  const result = await cloudflare(\`/workers/scripts/\${encodeURIComponent(workerName)}/subdomain\`, {\n    method: "POST",\n    body: JSON.stringify({ enabled: true, previews_enabled: true })\n  });\n  if (!result?.previews_enabled) throw new Error("Cloudflare Worker preview URLs could not be enabled");\n  return result;\n}\n`;
const resilientPreviewEnable = `async function ensurePreviewUrls() {\n  let lastError;\n  for (let attempt = 1; attempt <= 8; attempt += 1) {\n    try {\n      const result = await cloudflare(\`/workers/scripts/\${encodeURIComponent(workerName)}/subdomain\`, {\n        method: "POST",\n        body: JSON.stringify({ enabled: true, previews_enabled: true })\n      });\n      if (!result?.previews_enabled) throw new Error("Cloudflare Worker preview URLs could not be enabled");\n      return result;\n    } catch (error) {\n      lastError = error;\n      const message = String(error?.message || error);\n      if (!message.includes("10007") && !message.includes("does not exist") && !message.includes("not found")) throw error;\n      if (attempt < 8) await sleep(2000);\n    }\n  }\n  throw lastError || new Error("Cloudflare Worker preview URL propagation timed out");\n}\n`;
let runtimeSource = source.replace(eagerCleanup, "");
if (runtimeSource === source) {
  throw new Error(
    "Cloudflare deferred-cleanup transformation did not match the expected cleanup block",
  );
}
const previewPatchedSource = runtimeSource.replace(
  eagerPreviewEnable,
  resilientPreviewEnable,
);
if (previewPatchedSource === runtimeSource) {
  throw new Error(
    "Cloudflare preview propagation transformation did not match the expected enable block",
  );
}
runtimeSource = previewPatchedSource;
await writeFile(runtimePath, runtimeSource, "utf8");

try {
  let report = await runPreviewAttempt();
  if (report.status !== "passed" && isCloudflareWorkerQuotaError(report)) {
    const deleted = await pruneStaleOwnedWorkers();
    if (deleted.length === 0) {
      throw new Error(
        "Cloudflare Worker quota is exhausted and no stale repository-owned preview Workers are eligible for deletion",
      );
    }
    await cleanupCurrentRunWorker();
    await sleep(3000);
    report = await runPreviewAttempt();
  }
  if (report.status !== "passed") {
    throw new Error(report.error || "Cloudflare preview validation failed");
  }
  console.log(
    `Cloudflare Foundation evidence passed via ${report.benchmarkMode}; cleanup deferred until runtime metrics complete`,
  );
} finally {
  await rm(runtimePath, { force: true });
}
