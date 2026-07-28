import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for Workers runtime metrics");
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactsDir = path.join(root, "artifacts", "foundation");
const previewReportPath = path.join(artifactsDir, "cloudflare-preview-report.json");
const metricsReportPath = path.join(artifactsDir, "cloudflare-runtime-metrics.json");
const previewReport = JSON.parse(await readFile(previewReportPath, "utf8"));
const workerName = previewReport.workerName;
if (!workerName) throw new Error("Cloudflare preview report does not contain a worker name");

const query = `query FoundationWorkerRuntimeMetrics(
  $accountTag: string,
  $datetimeStart: string,
  $datetimeEnd: string,
  $scriptName: string
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 100,
        filter: {
          scriptName: $scriptName,
          datetime_geq: $datetimeStart,
          datetime_leq: $datetimeEnd
        }
      ) {
        sum {
          requests
          errors
          subrequests
        }
        quantiles {
          cpuTimeP50
          cpuTimeP99
          wallTimeP50
          wallTimeP99
          memoryUsageBytesP50
          memoryUsageBytesP90
          memoryUsageBytesP99
          memoryUsageBytesP999
        }
        dimensions {
          datetime
          scriptName
          status
        }
      }
    }
  }
}`;

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function queryMetrics() {
  const now = new Date();
  const datetimeStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const datetimeEnd = new Date(now.getTime() + 2 * 60 * 1000).toISOString();
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: CLOUDFLARE_ACCOUNT_ID,
        datetimeStart,
        datetimeEnd,
        scriptName: workerName
      }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Cloudflare GraphQL HTTP ${response.status}: ${JSON.stringify(payload)}`);
  if (payload?.errors?.length) throw new Error(`Cloudflare GraphQL: ${JSON.stringify(payload.errors)}`);
  const rows = payload?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
  return { datetimeStart, datetimeEnd, rows };
}

await mkdir(artifactsDir, { recursive: true });
let result;
let lastError;
for (let attempt = 1; attempt <= 18; attempt += 1) {
  try {
    result = await queryMetrics();
    const requests = result.rows.reduce((total, row) => total + Number(row.sum?.requests || 0), 0);
    const hasCpu = result.rows.some((row) => Number.isFinite(row.quantiles?.cpuTimeP50));
    const hasWall = result.rows.some((row) => Number.isFinite(row.quantiles?.wallTimeP50));
    const hasMemory = result.rows.some((row) => Number.isFinite(row.quantiles?.memoryUsageBytesP50));
    if (requests > 0 && hasCpu && hasWall && hasMemory) break;
    result = null;
  } catch (error) {
    lastError = error;
    if (/permission|authentication|authorization|not authorized|cannot query field/iu.test(error.message)) break;
  }
  if (attempt < 18) await sleep(10_000);
}

if (!result) throw lastError || new Error(`Cloudflare runtime metrics did not become available for ${workerName}`);
const successfulRows = result.rows.filter((row) => row.dimensions?.status === "success");
const rows = successfulRows.length ? successfulRows : result.rows;
const totalRequests = rows.reduce((total, row) => total + Number(row.sum?.requests || 0), 0);
const totalErrors = rows.reduce((total, row) => total + Number(row.sum?.errors || 0), 0);
const maximum = (field) => Math.max(...rows.map((row) => Number(row.quantiles?.[field])).filter(Number.isFinite));
const report = {
  schemaVersion: 1,
  status: "passed",
  generatedAt: new Date().toISOString(),
  gitSha: GITHUB_SHA || null,
  runId: GITHUB_RUN_ID || null,
  workerName,
  window: {
    start: result.datetimeStart,
    end: result.datetimeEnd
  },
  requestCount: totalRequests,
  errorCount: totalErrors,
  units: {
    cpuTime: "microseconds",
    wallTime: "microseconds",
    memoryUsage: "bytes"
  },
  observedMaximumQuantiles: {
    cpuTimeP50: maximum("cpuTimeP50"),
    cpuTimeP99: maximum("cpuTimeP99"),
    wallTimeP50: maximum("wallTimeP50"),
    wallTimeP99: maximum("wallTimeP99"),
    memoryUsageBytesP50: maximum("memoryUsageBytesP50"),
    memoryUsageBytesP90: maximum("memoryUsageBytesP90"),
    memoryUsageBytesP99: maximum("memoryUsageBytesP99"),
    memoryUsageBytesP999: maximum("memoryUsageBytesP999")
  },
  rows
};

await writeFile(metricsReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
