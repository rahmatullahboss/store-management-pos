import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const reportPath = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "design-evidence",
  "report.json",
);
const evidenceScript = path.join(root, "tooling", "scripts", "storefront-design-evidence.mjs");
const timeoutMs = 240_000;
const startedAt = Date.now();

await rm(reportPath, { force: true });

const child = spawn(process.execPath, [evidenceScript], {
  cwd: root,
  env: process.env,
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  });
}

function terminate(signal) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function freshReport() {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const generatedAt = Date.parse(report.generatedAt ?? "");
    if (!Number.isFinite(generatedAt) || generatedAt < startedAt) return null;
    return report;
  } catch {
    return null;
  }
}

function reportPassed(report) {
  return (
    report?.summary?.total > 0 &&
    report.summary.passed === report.summary.total &&
    report.summary.axeViolations === 0 &&
    report.summary.detectorFindings === 0
  );
}

const deadline = startedAt + timeoutMs;
let settled = false;
let exitCode = null;
child.once("exit", (code) => {
  settled = true;
  exitCode = code;
});

try {
  while (Date.now() < deadline) {
    const report = await freshReport();
    if (report) {
      if (!settled) {
        terminate("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        terminate("SIGKILL");
      }
      if (!reportPassed(report)) {
        throw new Error(`Storefront browser evidence failed: ${JSON.stringify(report.summary)}`);
      }
      console.log(
        `Storefront browser evidence runner verified ${report.summary.passed}/${report.summary.total} scenarios`,
      );
      process.exit(0);
    }
    if (settled) {
      if (exitCode === 0) {
        throw new Error("Storefront evidence process exited successfully without a fresh report.");
      }
      throw new Error(`Storefront evidence process exited with ${exitCode}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Storefront evidence exceeded ${timeoutMs}ms.`);
} catch (error) {
  terminate("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  terminate("SIGKILL");
  const tail = output.slice(-8_000);
  console.error(tail);
  throw error;
}
