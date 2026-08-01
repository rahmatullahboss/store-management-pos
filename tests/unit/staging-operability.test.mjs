import assert from "node:assert/strict";
import test from "node:test";
import {
  STAGING_OPERABILITY_POLICIES,
  collectStagingDatabaseSignals,
  deriveStagingOperabilitySignals,
  evaluateStagingOperability,
} from "../../tooling/scripts/staging-operability.mjs";

const healthySignals = Object.freeze({
  http_probe_failures: 0,
  browser_scenario_failures: 0,
  axe_violations: 0,
  horizontal_overflow_failures: 0,
  identity_control_failures: 0,
  controlled_command_failures: 0,
  artifact_secret_leaks: 0,
  outbox_publisher_failures: 0,
  inventory_reconciliation_mismatches: 0,
  journal_imbalance_count: 0,
  outbox_backlog_count: 12,
  outbox_oldest_unpublished_seconds: 120,
});

function releaseReport(overrides = {}) {
  return {
    status: "passed",
    probes: [{ pathname: "/api/health", status: 200 }],
    browser: [{ id: "admin", passed: true, violations: [], overflow: false }],
    authentication: {
      syntheticAccountCleaned: true,
      sessionProbePassed: true,
      contextProbePassed: true,
      browserLoginPassed: true,
      browserLogoutPassed: true,
      credentialsPersistedInArtifacts: false,
      legacyNeonAuthRemoved: true,
    },
    mfa: {
      encryptedAtRest: true,
      replayRejected: true,
      createPassed: true,
      releasePassed: true,
      availabilityReconciled: true,
    },
    accountRecovery: {
      nonEnumeratingRequest: true,
      tokenHashOnly: true,
      resetCompleted: true,
      oldSessionRevoked: true,
      oldPasswordRejected: true,
      newPasswordAccepted: true,
      mfaFactorsRevoked: true,
      outstandingStepUpRevoked: true,
      resetReplayRejected: true,
      emailVerificationCompleted: true,
      verificationReplayRejected: true,
    },
    controlledCommand: {
      createPassed: true,
      releasePassed: true,
      availabilityReconciled: true,
      syntheticReservationCleaned: true,
    },
    outboxPublisher: {
      failed: 0,
      remaining: 0,
      exhausted: 0,
      payloadsPersistedInArtifacts: false,
      externalDelivery: false,
    },
    ...overrides,
  };
}

test("staging operability policies are deterministic, immutable and runbook-owned", () => {
  assert.ok(Object.isFrozen(STAGING_OPERABILITY_POLICIES));
  assert.equal(STAGING_OPERABILITY_POLICIES.length, Object.keys(healthySignals).length);
  assert.deepEqual(
    STAGING_OPERABILITY_POLICIES.map(({ metricId }) => metricId),
    Object.keys(healthySignals),
  );
  for (const policy of STAGING_OPERABILITY_POLICIES) {
    assert.ok(Object.isFrozen(policy));
    assert.match(policy.metricId, /^[a-z][a-z0-9_]+$/u);
    assert.match(policy.owner, /^(platform-sre|security-operations|inventory-operations|finance-operations)$/u);
    assert.match(policy.runbook, /^docs\/architecture\/staging\/operability-alerts-runbook\.md#[a-z0-9-]+$/u);
    assert.ok(Number.isSafeInteger(policy.criticalResponseMinutes));
    assert.ok(policy.criticalResponseMinutes > 0);
  }
});

test("healthy aggregate evidence clears the staging launch gate", () => {
  const result = evaluateStagingOperability(healthySignals);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.status, "healthy");
  assert.equal(result.launchGate, "clear");
  assert.equal(result.warningCount, 0);
  assert.equal(result.criticalCount, 0);
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.signals, healthySignals);
});

test("warning and critical thresholds produce bounded deterministic alerts", () => {
  const result = evaluateStagingOperability({
    ...healthySignals,
    outbox_backlog_count: 51,
    inventory_reconciliation_mismatches: 1,
    artifact_secret_leaks: 2,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.launchGate, "blocked");
  assert.equal(result.warningCount, 1);
  assert.equal(result.criticalCount, 2);
  assert.deepEqual(
    result.alerts.map(({ metricId, severity }) => [metricId, severity]),
    [
      ["artifact_secret_leaks", "critical"],
      ["inventory_reconciliation_mismatches", "critical"],
      ["outbox_backlog_count", "warning"],
    ],
  );
  assert.deepEqual(Object.keys(result.alerts[0]).sort(), [
    "alertId",
    "metricId",
    "observed",
    "owner",
    "responseMinutes",
    "runbook",
    "severity",
    "threshold",
  ]);
  assert.doesNotMatch(JSON.stringify(result.alerts), /email|token|cookie|postgresql|tenantId/iu);
});

test("publisher failure is a zero-tolerance staging block", () => {
  const result = evaluateStagingOperability({
    ...healthySignals,
    outbox_publisher_failures: 1,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.launchGate, "blocked");
  assert.equal(result.warningCount, 0);
  assert.equal(result.criticalCount, 1);
  assert.equal(result.alerts[0].alertId, "staging.outbox_publisher_failures.critical");
});

test("warning-only evidence requires review without falsely blocking staging", () => {
  const result = evaluateStagingOperability({
    ...healthySignals,
    outbox_oldest_unpublished_seconds: 901,
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.launchGate, "review");
  assert.equal(result.warningCount, 1);
  assert.equal(result.criticalCount, 0);
});

test("outbox backlog remains a review gate until a production publisher is commissioned", () => {
  const result = evaluateStagingOperability({
    ...healthySignals,
    outbox_backlog_count: 10_000,
    outbox_oldest_unpublished_seconds: 86_400,
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.launchGate, "review");
  assert.equal(result.warningCount, 2);
  assert.equal(result.criticalCount, 0);
});

test("signal validation rejects missing, unknown, fractional, negative and unsafe values", () => {
  const { http_probe_failures: _removed, ...missing } = healthySignals;
  assert.throws(() => evaluateStagingOperability(missing), /Missing staging operability signal http_probe_failures/u);
  assert.throws(
    () => evaluateStagingOperability({ ...healthySignals, arbitrary_payload: 1 }),
    /Unknown staging operability signal arbitrary_payload/u,
  );
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
    assert.throws(
      () => evaluateStagingOperability({ ...healthySignals, http_probe_failures: value }),
      /http_probe_failures must be a non-negative safe integer/u,
    );
  }
});

test("database evidence query returns synthetic aggregate controls only", async () => {
  let observedSql = "";
  const client = {
    async query(sql) {
      observedSql = sql;
      return {
        rows: [{
          outbox_backlog_count: "17",
          outbox_oldest_unpublished_seconds: "240",
          inventory_reconciliation_mismatches: "0",
          journal_imbalance_count: "0",
        }],
      };
    },
  };
  const result = await collectStagingDatabaseSignals(client);
  assert.deepEqual(result, {
    outbox_backlog_count: 17,
    outbox_oldest_unpublished_seconds: 240,
    inventory_reconciliation_mismatches: 0,
    journal_imbalance_count: 0,
  });
  assert.match(observedSql, /code LIKE 'synthetic-%'/u);
  assert.match(observedSql, /platform\.outbox_events/u);
  assert.match(observedSql, /inventory\.stock_ledger_entries/u);
  assert.match(observedSql, /accounting\.journal_lines/u);
  assert.doesNotMatch(observedSql, /email|password|token|payload|metadata|last_error/iu);
});

test("database evidence rejects absent rows and unsafe numeric values", async () => {
  await assert.rejects(
    collectStagingDatabaseSignals({ query: async () => ({ rows: [] }) }),
    /did not return one aggregate row/u,
  );
  await assert.rejects(
    collectStagingDatabaseSignals({
      query: async () => ({ rows: [{
        outbox_backlog_count: "9007199254740992",
        outbox_oldest_unpublished_seconds: 0,
        inventory_reconciliation_mismatches: 0,
        journal_imbalance_count: 0,
      }] }),
    }),
    /outbox_backlog_count is outside the safe integer range/u,
  );
});

test("release report derivation reduces journeys to bounded aggregate signals", () => {
  const signals = deriveStagingOperabilitySignals(releaseReport(), {
    outbox_backlog_count: 17,
    outbox_oldest_unpublished_seconds: 240,
    inventory_reconciliation_mismatches: 0,
    journal_imbalance_count: 0,
  });
  assert.deepEqual(signals, { ...healthySignals, outbox_backlog_count: 17, outbox_oldest_unpublished_seconds: 240 });
});

test("release report derivation counts failed browser, identity, command and leak controls", () => {
  const report = releaseReport({
    status: "failed",
    probes: [],
    browser: [
      { id: "admin", passed: false, violations: [{ id: "label" }], overflow: true },
      { id: "pos", passed: true, violations: [], overflow: false },
    ],
    authentication: {
      syntheticAccountCleaned: false,
      sessionProbePassed: false,
      contextProbePassed: true,
      browserLoginPassed: true,
      browserLogoutPassed: true,
      credentialsPersistedInArtifacts: true,
      legacyNeonAuthRemoved: true,
    },
    mfa: { encryptedAtRest: false, replayRejected: true, createPassed: false, releasePassed: true, availabilityReconciled: true },
    accountRecovery: {
      nonEnumeratingRequest: true,
      tokenHashOnly: false,
      resetCompleted: true,
      oldSessionRevoked: true,
      oldPasswordRejected: true,
      newPasswordAccepted: true,
      mfaFactorsRevoked: true,
      outstandingStepUpRevoked: true,
      resetReplayRejected: false,
      emailVerificationCompleted: true,
      verificationReplayRejected: true,
    },
    controlledCommand: { createPassed: false, releasePassed: true, availabilityReconciled: false, syntheticReservationCleaned: true },
    outboxPublisher: {
      failed: 1,
      remaining: 1,
      exhausted: 0,
      payloadsPersistedInArtifacts: false,
      externalDelivery: false,
    },
  });
  const signals = deriveStagingOperabilitySignals(report, {
    outbox_backlog_count: 0,
    outbox_oldest_unpublished_seconds: 0,
    inventory_reconciliation_mismatches: 0,
    journal_imbalance_count: 0,
  });
  assert.deepEqual(signals, {
    http_probe_failures: 1,
    browser_scenario_failures: 1,
    axe_violations: 1,
    horizontal_overflow_failures: 1,
    identity_control_failures: 4,
    controlled_command_failures: 3,
    artifact_secret_leaks: 2,
    outbox_publisher_failures: 2,
    inventory_reconciliation_mismatches: 0,
    journal_imbalance_count: 0,
    outbox_backlog_count: 0,
    outbox_oldest_unpublished_seconds: 0,
  });
});
