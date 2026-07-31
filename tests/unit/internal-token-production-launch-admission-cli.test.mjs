import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkProductionLaunchAdmission,
} from "../../tooling/scripts/check-production-launch-admission.mjs";
import {
  createProductionLaunchBundle,
  createProductionLaunchRevocationSnapshot,
  productionLaunchDigest,
  productionLaunchNow,
} from "../helpers/production-launch-governance-fixtures.mjs";

function assertAggregateOnly(result) {
  for (const key of [
    "actorDigest",
    "admissionBundleDigest",
    "approvalDigest",
    "bundleDigest",
    "entryDigest",
    "evidenceDigest",
    "genesisDigest",
    "headDigest",
    "incidentDigest",
    "providerClass",
    "reasonDigest",
    "releaseDigest",
    "snapshotDigest",
  ]) {
    assert.equal(Object.hasOwn(result, key), false);
  }
}

async function fixturePaths() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "production-launch-admission-"),
  );
  return {
    evidencePath: path.join(directory, "evidence.json"),
    reportPath: path.join(directory, "report.json"),
    revocationPath: path.join(directory, "revocation.json"),
  };
}

async function writeGovernanceFiles(paths, actions = []) {
  const bundle = createProductionLaunchBundle();
  const revocation = createProductionLaunchRevocationSnapshot({ actions, bundle });
  await writeFile(paths.evidencePath, JSON.stringify(bundle), "utf8");
  await writeFile(paths.revocationPath, JSON.stringify(revocation), "utf8");
  return { bundle, revocation };
}

function productionEnvironment(paths, revocation) {
  return {
    PRODUCTION_LAUNCH_EVIDENCE_PATH: paths.evidencePath,
    PRODUCTION_LAUNCH_REVOCATION_EXPECTED_HEAD_DIGEST: revocation.headDigest,
    PRODUCTION_LAUNCH_REVOCATION_STATE_PATH: paths.revocationPath,
    STORE_DEPLOYMENT_TARGET: "production",
  };
}

test("non-production CLI mode remains blocked, aggregate-only and successful", async () => {
  const { reportPath } = await fixturePaths();
  const result = await checkProductionLaunchAdmission({
    environment: { STORE_DEPLOYMENT_TARGET: "staging" },
    now: productionLaunchNow,
    reportPath,
  });
  assert.deepEqual(result, {
    approvalCount: 0,
    controlCount: 0,
    environment: "staging",
    evidenceDigestsIncluded: false,
    identifiersIncluded: false,
    launchGate: "blocked",
    schemaVersion: 1,
    status: "not_requested",
  });
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), result);
  assertAggregateOnly(result);
});

test("production CLI clears only with admission, revocation snapshot and protected head", async () => {
  const paths = await fixturePaths();
  const { revocation } = await writeGovernanceFiles(paths);
  const result = await checkProductionLaunchAdmission({
    environment: productionEnvironment(paths, revocation),
    now: productionLaunchNow,
    reportPath: paths.reportPath,
  });
  assert.deepEqual(result, {
    approvalCount: 3,
    controlCount: 10,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt: productionLaunchNow + 120,
    identifiersIncluded: false,
    latestRevocationAction: "none",
    launchGate: "clear",
    revocationApprovalCount: 0,
    revocationEmergencyStopCount: 0,
    revocationEntryCount: 0,
    revocationState: "clear",
    schemaVersion: 1,
    status: "admitted",
  });
  assert.deepEqual(JSON.parse(await readFile(paths.reportPath, "utf8")), result);
  assertAggregateOnly(result);
});

test("valid suspension and emergency-stop journals write aggregate blocked reports", async () => {
  for (const actions of [["suspend"], ["emergency_stop"]]) {
    const paths = await fixturePaths();
    const { revocation } = await writeGovernanceFiles(paths, actions);
    const result = await checkProductionLaunchAdmission({
      environment: productionEnvironment(paths, revocation),
      now: productionLaunchNow,
      reportPath: paths.reportPath,
    });
    assert.equal(result.status, "suspended");
    assert.equal(result.launchGate, "blocked");
    assert.equal(result.revocationState, "suspended");
    assert.equal(result.latestRevocationAction, actions[0]);
    assert.equal(
      result.revocationApprovalCount,
      actions[0] === "emergency_stop" ? 1 : 3,
    );
    assert.deepEqual(JSON.parse(await readFile(paths.reportPath, "utf8")), result);
    assertAggregateOnly(result);
  }
});

test("production CLI requires both files and the protected journal checkpoint", async () => {
  const paths = await fixturePaths();
  const { revocation } = await writeGovernanceFiles(paths);
  const cases = [
    {
      environment: { STORE_DEPLOYMENT_TARGET: "production" },
      message: /production evidence file is required/u,
    },
    {
      environment: {
        PRODUCTION_LAUNCH_EVIDENCE_PATH: paths.evidencePath,
        STORE_DEPLOYMENT_TARGET: "production",
      },
      message: /production revocation state file is required/u,
    },
    {
      environment: {
        PRODUCTION_LAUNCH_EVIDENCE_PATH: paths.evidencePath,
        PRODUCTION_LAUNCH_REVOCATION_STATE_PATH: paths.revocationPath,
        STORE_DEPLOYMENT_TARGET: "production",
      },
      message: /protected revocation journal head digest is required/u,
    },
  ];
  for (const item of cases) {
    await assert.rejects(
      checkProductionLaunchAdmission({
        environment: item.environment,
        now: productionLaunchNow,
        reportPath: paths.reportPath,
      }),
      item.message,
    );
  }

  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: {
        ...productionEnvironment(paths, revocation),
        PRODUCTION_LAUNCH_REVOCATION_EXPECTED_HEAD_DIGEST:
          productionLaunchDigest("wrong-protected-head"),
      },
      now: productionLaunchNow,
      reportPath: paths.reportPath,
    }),
    /production revocation state validation failed/u,
  );
});

test("inline admission and revocation state are prohibited without leaking content", async () => {
  const paths = await fixturePaths();
  for (const environment of [
    {
      PRODUCTION_LAUNCH_EVIDENCE_JSON:
        "{\"providerSecret\":\"admission-secret\"}",
      STORE_DEPLOYMENT_TARGET: "production",
    },
    {
      PRODUCTION_LAUNCH_REVOCATION_STATE_JSON:
        "{\"incidentUrl\":\"private-incident\"}",
      STORE_DEPLOYMENT_TARGET: "production",
    },
  ]) {
    await assert.rejects(
      checkProductionLaunchAdmission({
        environment,
        now: productionLaunchNow,
        reportPath: paths.reportPath,
      }),
      (error) => {
        assert.match(error.message, /inline production/u);
        assert.doesNotMatch(
          error.message,
          /providerSecret|admission-secret|incidentUrl|private-incident/u,
        );
        return true;
      },
    );
  }
});

test("malformed and invalid revocation evidence is masked at the command boundary", async () => {
  const paths = await fixturePaths();
  const { revocation } = await writeGovernanceFiles(paths);
  await writeFile(
    paths.revocationPath,
    "{not-json:private-provider-resource}",
    "utf8",
  );
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: productionEnvironment(paths, revocation),
      now: productionLaunchNow,
      reportPath: paths.reportPath,
    }),
    (error) => {
      assert.match(error.message, /could not be read or parsed/u);
      assert.doesNotMatch(error.message, /not-json|private-provider-resource/u);
      return true;
    },
  );

  const invalid = createProductionLaunchRevocationSnapshot();
  invalid.snapshotDigest = productionLaunchDigest("invalid-snapshot");
  await writeFile(paths.revocationPath, JSON.stringify(invalid), "utf8");
  await assert.rejects(
    checkProductionLaunchAdmission({
      environment: {
        ...productionEnvironment(paths, invalid),
        PRODUCTION_LAUNCH_REVOCATION_EXPECTED_HEAD_DIGEST: invalid.headDigest,
      },
      now: productionLaunchNow,
      reportPath: paths.reportPath,
    }),
    (error) => {
      assert.match(error.message, /revocation state validation failed/u);
      assert.doesNotMatch(error.message, /snapshot digest|invalid-snapshot/u);
      return true;
    },
  );
});
