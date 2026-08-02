import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "performance-evidence",
);
const reportPath = path.join(outputDir, "report.json");
const origin = "http://127.0.0.1:4322";
const requestCount = 64;
const concurrency = 8;
const maximumP95Ms = 5_000;
const maximumResponseBytes = 512 * 1024;

const routes = Object.freeze([
  "/evidence/storefront?locale=en-GB",
  "/evidence/storefront?locale=bn-BD",
  "/evidence/checkout-recovery?locale=ar",
  "/evidence/order-tracking?locale=ja-JP",
]);

function startStorefront() {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace", "@ozzyl/storefront-web", "run", "dev"],
    {
      cwd: root,
      env: {
        ...process.env,
        STOREFRONT_EVIDENCE_MODE: "1",
        ASTRO_TELEMETRY_DISABLED: "1",
        NO_UPDATE_NOTIFIER: "1",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
  }
  return { child, output: () => output };
}

function terminateProcessGroup(child, signal) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  terminateProcessGroup(server.child, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  terminateProcessGroup(server.child, "SIGKILL");
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Storefront performance server exited with ${server.child.exitCode}.\n${server.output()}`,
      );
    }
    try {
      const response = await fetch(`${origin}${routes[0]}`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The local evidence server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Storefront performance server did not start.\n${server.output()}`,
  );
}

async function measure(route) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${origin}${route}`, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      route,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes: body.byteLength,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      ok:
        response.status === 200 &&
        (response.headers.get("content-type") ?? "").includes("text/html") &&
        body.byteLength > 0 &&
        body.byteLength <= maximumResponseBytes,
    };
  } catch (error) {
    return {
      route,
      status: 0,
      contentType: "",
      bytes: 0,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function routeSummary(results, route) {
  const matching = results.filter((result) => result.route === route);
  const durations = matching.map((result) => result.durationMs);
  return Object.freeze({
    route,
    requests: matching.length,
    successful: matching.filter((result) => result.ok).length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maximumBytes: Math.max(0, ...matching.map((result) => result.bytes)),
  });
}

await mkdir(outputDir, { recursive: true });
const server = startStorefront();
const results = [];
const rehearsalStartedAt = performance.now();
try {
  await waitForServer(server);

  for (const route of routes) {
    const warmup = await measure(route);
    if (!warmup.ok) {
      throw new Error(
        `Storefront performance warmup failed for ${route}: ${JSON.stringify(warmup)}`,
      );
    }
  }

  let nextIndex = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= requestCount) return;
      const route = routes[index % routes.length];
      results[index] = await measure(route);
    }
  });
  await Promise.all(workers);
} finally {
  await stopServer(server);
}

const durations = results.map((result) => result.durationMs);
const successful = results.filter((result) => result.ok).length;
const p50Ms = percentile(durations, 0.5);
const p95Ms = percentile(durations, 0.95);
const maximumBytes = Math.max(0, ...results.map((result) => result.bytes));
const totalDurationMs =
  Math.round((performance.now() - rehearsalStartedAt) * 100) / 100;
const routeSummaries = routes.map((route) => routeSummary(results, route));
const passed =
  results.length === requestCount &&
  successful === requestCount &&
  p95Ms <= maximumP95Ms &&
  maximumBytes <= maximumResponseBytes &&
  routeSummaries.every(
    (route) => route.requests > 0 && route.requests === route.successful,
  );

const report = {
  generatedAt: new Date().toISOString(),
  evidenceKind: "bounded-local-rehearsal",
  productionSla: false,
  requestCount,
  concurrency,
  budgets: {
    maximumP95Ms,
    maximumResponseBytes,
  },
  summary: {
    successful,
    failed: requestCount - successful,
    p50Ms,
    p95Ms,
    maximumBytes,
    totalDurationMs,
    passed,
  },
  routes: routeSummaries,
  failures: results.filter((result) => !result.ok),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!passed) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `Storefront bounded performance rehearsal passed ${successful}/${requestCount} requests; p95=${p95Ms}ms`,
  );
}
