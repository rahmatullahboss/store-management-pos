import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createInternalTokenProductionLaunchNotRequestedEvidence,
  evaluateInternalTokenProductionLaunchAdmission,
} from "./internal-token-production-launch-admission.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
export const PRODUCTION_LAUNCH_ADMISSION_REPORT_PATH = path.join(
  root,
  "artifacts",
  "foundation",
  "production-launch-admission.json",
);

function fail(message) {
  throw new Error(`Production launch admission check: ${message}`);
}

async function writeReport(report, reportPath) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function checkProductionLaunchAdmission({
  environment = process.env,
  now = Math.floor(Date.now() / 1_000),
  reportPath = PRODUCTION_LAUNCH_ADMISSION_REPORT_PATH,
} = {}) {
  const target = typeof environment.STORE_DEPLOYMENT_TARGET === "string"
    ? environment.STORE_DEPLOYMENT_TARGET.trim().toLowerCase()
    : "unspecified";
  if (target !== "production") {
    const report = createInternalTokenProductionLaunchNotRequestedEvidence(target);
    await writeReport(report, reportPath);
    return report;
  }
  if (typeof environment.PRODUCTION_LAUNCH_EVIDENCE_JSON === "string" &&
      environment.PRODUCTION_LAUNCH_EVIDENCE_JSON.trim() !== "") {
    fail("inline production evidence is prohibited");
  }
  const evidencePath = typeof environment.PRODUCTION_LAUNCH_EVIDENCE_PATH === "string"
    ? environment.PRODUCTION_LAUNCH_EVIDENCE_PATH.trim()
    : "";
  if (evidencePath === "") fail("production evidence file is required");

  let bundle;
  try {
    const raw = await readFile(evidencePath, "utf8");
    bundle = JSON.parse(raw);
  } catch {
    fail("production evidence file could not be read or parsed");
  }

  let report;
  try {
    report = evaluateInternalTokenProductionLaunchAdmission(bundle, now);
  } catch {
    fail("production evidence validation failed");
  }
  await writeReport(report, reportPath);
  return report;
}

async function main() {
  try {
    const report = await checkProductionLaunchAdmission();
    console.log(
      `Production launch admission: status=${report.status} target=${report.environment} gate=${report.launchGate}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production launch admission check failed");
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
