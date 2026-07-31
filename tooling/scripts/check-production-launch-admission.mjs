import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createInternalTokenProductionLaunchNotRequestedEvidence,
  evaluateInternalTokenProductionLaunchAdmission,
} from "./internal-token-production-launch-admission.mjs";
import {
  evaluateInternalTokenProductionLaunchRevocation,
} from "./internal-token-production-launch-revocation.mjs";

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

async function readJsonFile(filePath, name) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    fail(`${name} file could not be read or parsed`);
  }
}

function combineAdmissionAndRevocation(admission, revocation) {
  return Object.freeze({
    approvalCount: admission.approvalCount,
    controlCount: admission.controlCount,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: Math.min(admission.expiresAt, revocation.expiresAt),
    identifiersIncluded: false,
    latestRevocationAction: revocation.latestAction,
    launchGate: revocation.launchGate,
    revocationApprovalCount: revocation.approvalCount,
    revocationEmergencyStopCount: revocation.emergencyStopCount,
    revocationEntryCount: revocation.entryCount,
    revocationState: revocation.revocationState,
    schemaVersion: 1,
    status: revocation.revocationState === "clear"
      ? "admitted"
      : revocation.revocationState,
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
  if (
    typeof environment.PRODUCTION_LAUNCH_EVIDENCE_JSON === "string" &&
    environment.PRODUCTION_LAUNCH_EVIDENCE_JSON.trim() !== ""
  ) {
    fail("inline production evidence is prohibited");
  }
  if (
    typeof environment.PRODUCTION_LAUNCH_REVOCATION_STATE_JSON === "string" &&
    environment.PRODUCTION_LAUNCH_REVOCATION_STATE_JSON.trim() !== ""
  ) {
    fail("inline production revocation state is prohibited");
  }
  const evidencePath = typeof environment.PRODUCTION_LAUNCH_EVIDENCE_PATH === "string"
    ? environment.PRODUCTION_LAUNCH_EVIDENCE_PATH.trim()
    : "";
  if (evidencePath === "") fail("production evidence file is required");
  const revocationPath =
    typeof environment.PRODUCTION_LAUNCH_REVOCATION_STATE_PATH === "string"
      ? environment.PRODUCTION_LAUNCH_REVOCATION_STATE_PATH.trim()
      : "";
  if (revocationPath === "") {
    fail("production revocation state file is required");
  }

  const bundle = await readJsonFile(evidencePath, "production evidence");
  const revocationSnapshot = await readJsonFile(
    revocationPath,
    "production revocation state",
  );

  let admission;
  try {
    admission = evaluateInternalTokenProductionLaunchAdmission(bundle, now);
  } catch {
    fail("production evidence validation failed");
  }
  let revocation;
  try {
    revocation = evaluateInternalTokenProductionLaunchRevocation(
      revocationSnapshot,
      {
        admissionBundleDigest: bundle.bundleDigest,
        releaseDigest: bundle.evidence.releaseDigest,
      },
      now,
    );
  } catch {
    fail("production revocation state validation failed");
  }
  const report = combineAdmissionAndRevocation(admission, revocation);
  await writeReport(report, reportPath);
  return report;
}

async function main() {
  try {
    const report = await checkProductionLaunchAdmission();
    console.log(
      `Production launch admission: status=${report.status} target=${report.environment} gate=${report.launchGate}`,
    );
    if (report.environment === "production" && report.launchGate !== "clear") {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Production launch admission check failed",
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
