const RUNBOOK = "docs/architecture/staging/operability-alerts-runbook.md";

function policy(metricId, owner, anchor, options = {}) {
  return Object.freeze({
    metricId,
    owner,
    runbook: `${RUNBOOK}#${anchor}`,
    warningAbove: Object.hasOwn(options, "warningAbove") ? options.warningAbove : null,
    criticalAbove: Object.hasOwn(options, "criticalAbove") ? options.criticalAbove : 0,
    warningResponseMinutes: options.warningResponseMinutes ?? 240,
    criticalResponseMinutes: options.criticalResponseMinutes ?? 30,
  });
}

export const STAGING_OPERABILITY_POLICIES = Object.freeze([
  policy("http_probe_failures", "platform-sre", "availability-and-http-probes", { criticalResponseMinutes: 15 }),
  policy("browser_scenario_failures", "platform-sre", "browser-and-accessibility-evidence", { criticalResponseMinutes: 30 }),
  policy("axe_violations", "platform-sre", "browser-and-accessibility-evidence", { criticalResponseMinutes: 30 }),
  policy("horizontal_overflow_failures", "platform-sre", "browser-and-accessibility-evidence", { criticalResponseMinutes: 30 }),
  policy("identity_control_failures", "security-operations", "identity-recovery-and-mfa-controls", { criticalResponseMinutes: 15 }),
  policy("controlled_command_failures", "inventory-operations", "controlled-reservation-command", { criticalResponseMinutes: 15 }),
  policy("artifact_secret_leaks", "security-operations", "artifact-or-secret-exposure", { criticalResponseMinutes: 5 }),
  policy("outbox_publisher_failures", "platform-sre", "outbox-publisher", { criticalResponseMinutes: 15 }),
  policy("inventory_reconciliation_mismatches", "inventory-operations", "inventory-projection-reconciliation", { criticalResponseMinutes: 15 }),
  policy("journal_imbalance_count", "finance-operations", "journal-balance-integrity", { criticalResponseMinutes: 5 }),
  policy("outbox_backlog_count", "platform-sre", "outbox-backlog", {
    warningAbove: 50,
    criticalAbove: null,
    warningResponseMinutes: 240,
  }),
  policy("outbox_oldest_unpublished_seconds", "platform-sre", "outbox-backlog", {
    warningAbove: 900,
    criticalAbove: null,
    warningResponseMinutes: 240,
  }),
]);

const POLICY_BY_METRIC = new Map(
  STAGING_OPERABILITY_POLICIES.map((entry, index) => [entry.metricId, { entry, index }]),
);

function assertSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function databaseInteger(value, name) {
  if (typeof value === "number") return assertSafeInteger(value, name);
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new TypeError(`${name} must be returned as a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return parsed;
}

function booleanFailures(values) {
  return values.reduce((count, value) => count + (value === true ? 0 : 1), 0);
}

function reportEvidenceInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 1;
}

export function evaluateStagingOperability(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Staging operability signals must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!POLICY_BY_METRIC.has(key)) {
      throw new TypeError(`Unknown staging operability signal ${key}`);
    }
  }

  const signals = {};
  for (const { metricId } of STAGING_OPERABILITY_POLICIES) {
    if (!Object.hasOwn(input, metricId)) {
      throw new TypeError(`Missing staging operability signal ${metricId}`);
    }
    signals[metricId] = assertSafeInteger(input[metricId], metricId);
  }

  const alerts = [];
  for (const current of STAGING_OPERABILITY_POLICIES) {
    const observed = signals[current.metricId];
    let severity = null;
    let threshold = null;
    let responseMinutes = null;
    if (current.criticalAbove !== null && observed > current.criticalAbove) {
      severity = "critical";
      threshold = current.criticalAbove;
      responseMinutes = current.criticalResponseMinutes;
    } else if (current.warningAbove !== null && observed > current.warningAbove) {
      severity = "warning";
      threshold = current.warningAbove;
      responseMinutes = current.warningResponseMinutes;
    }
    if (severity) {
      alerts.push(Object.freeze({
        alertId: `staging.${current.metricId}.${severity}`,
        metricId: current.metricId,
        severity,
        observed,
        threshold,
        owner: current.owner,
        responseMinutes,
        runbook: current.runbook,
      }));
    }
  }

  alerts.sort((left, right) => {
    const severityOrder = { critical: 0, warning: 1 };
    return severityOrder[left.severity] - severityOrder[right.severity]
      || POLICY_BY_METRIC.get(left.metricId).index - POLICY_BY_METRIC.get(right.metricId).index;
  });
  const criticalCount = alerts.filter(({ severity }) => severity === "critical").length;
  const warningCount = alerts.length - criticalCount;
  const status = criticalCount > 0 ? "blocked" : warningCount > 0 ? "degraded" : "healthy";
  const launchGate = criticalCount > 0 ? "blocked" : warningCount > 0 ? "review" : "clear";
  return Object.freeze({
    schemaVersion: 1,
    status,
    launchGate,
    warningCount,
    criticalCount,
    signals: Object.freeze(signals),
    alerts: Object.freeze(alerts),
  });
}

const DATABASE_SIGNAL_SQL = `
  WITH synthetic_tenants AS (
    SELECT id
    FROM platform.tenants
    WHERE code LIKE 'synthetic-%'
  ), outbox_control AS (
    SELECT
      count(*)::bigint AS backlog_count,
      COALESCE(
        GREATEST(
          floor(EXTRACT(EPOCH FROM (clock_timestamp() - min(occurred_at))))::bigint,
          0::bigint
        ),
        0::bigint
      ) AS oldest_seconds
    FROM platform.outbox_events
    WHERE tenant_id IN (SELECT id FROM synthetic_tenants)
      AND published_at IS NULL
  ), ledger_totals AS (
    SELECT
      tenant_id,
      warehouse_id,
      variant_id,
      COALESCE(bin_id, '00000000-0000-0000-0000-000000000000'::uuid) AS bin_key,
      stock_status,
      quantity_scale,
      unit_code,
      COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid) AS batch_key,
      sum(quantity_amount)::numeric AS quantity_amount,
      sum(COALESCE(value_delta_minor, 0))::numeric AS value_minor
    FROM inventory.stock_ledger_entries
    WHERE tenant_id IN (SELECT id FROM synthetic_tenants)
    GROUP BY tenant_id, warehouse_id, variant_id, bin_key, stock_status, quantity_scale, unit_code, batch_key
  ), balance_totals AS (
    SELECT
      tenant_id,
      warehouse_id,
      variant_id,
      bin_key,
      stock_status,
      quantity_scale,
      unit_code,
      batch_key,
      quantity_amount::numeric AS quantity_amount,
      value_minor::numeric AS value_minor
    FROM inventory.stock_balances
    WHERE tenant_id IN (SELECT id FROM synthetic_tenants)
  ), inventory_control AS (
    SELECT count(*)::bigint AS mismatch_count
    FROM ledger_totals
    FULL JOIN balance_totals USING (
      tenant_id, warehouse_id, variant_id, bin_key, stock_status, quantity_scale, unit_code, batch_key
    )
    WHERE ledger_totals.quantity_amount IS DISTINCT FROM balance_totals.quantity_amount
       OR ledger_totals.value_minor IS DISTINCT FROM balance_totals.value_minor
  ), journal_line_totals AS (
    SELECT
      tenant_id,
      journal_entry_id,
      sum(transaction_debit_minor)::numeric AS transaction_debit_minor,
      sum(transaction_credit_minor)::numeric AS transaction_credit_minor,
      sum(base_debit_minor)::numeric AS base_debit_minor,
      sum(base_credit_minor)::numeric AS base_credit_minor
    FROM accounting.journal_lines
    WHERE tenant_id IN (SELECT id FROM synthetic_tenants)
    GROUP BY tenant_id, journal_entry_id
  ), journal_control AS (
    SELECT count(*)::bigint AS imbalance_count
    FROM accounting.journal_entries AS journal
    LEFT JOIN journal_line_totals AS lines
      ON lines.tenant_id = journal.tenant_id
     AND lines.journal_entry_id = journal.id
    WHERE journal.tenant_id IN (SELECT id FROM synthetic_tenants)
      AND (
        journal.total_debit_minor <> journal.total_credit_minor
        OR journal.total_base_debit_minor <> journal.total_base_credit_minor
        OR lines.transaction_debit_minor IS DISTINCT FROM journal.total_debit_minor
        OR lines.transaction_credit_minor IS DISTINCT FROM journal.total_credit_minor
        OR lines.base_debit_minor IS DISTINCT FROM journal.total_base_debit_minor
        OR lines.base_credit_minor IS DISTINCT FROM journal.total_base_credit_minor
      )
  )
  SELECT
    outbox_control.backlog_count AS outbox_backlog_count,
    outbox_control.oldest_seconds AS outbox_oldest_unpublished_seconds,
    inventory_control.mismatch_count AS inventory_reconciliation_mismatches,
    journal_control.imbalance_count AS journal_imbalance_count
  FROM outbox_control
  CROSS JOIN inventory_control
  CROSS JOIN journal_control
`;

export async function collectStagingDatabaseSignals(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("A query-capable staging database client is required");
  }
  const result = await client.query(DATABASE_SIGNAL_SQL);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("Staging operability database query did not return one aggregate row");
  }
  const row = result.rows[0];
  return Object.freeze({
    outbox_backlog_count: databaseInteger(row.outbox_backlog_count, "outbox_backlog_count"),
    outbox_oldest_unpublished_seconds: databaseInteger(
      row.outbox_oldest_unpublished_seconds,
      "outbox_oldest_unpublished_seconds",
    ),
    inventory_reconciliation_mismatches: databaseInteger(
      row.inventory_reconciliation_mismatches,
      "inventory_reconciliation_mismatches",
    ),
    journal_imbalance_count: databaseInteger(row.journal_imbalance_count, "journal_imbalance_count"),
  });
}

export function deriveStagingOperabilitySignals(report, databaseSignals) {
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    throw new TypeError("Persistent staging report must be an object");
  }
  if (typeof databaseSignals !== "object" || databaseSignals === null || Array.isArray(databaseSignals)) {
    throw new TypeError("Staging database signals must be an object");
  }

  const probes = Array.isArray(report.probes) ? report.probes : [];
  const browser = Array.isArray(report.browser) ? report.browser : [];
  const authentication = report.authentication ?? {};
  const mfa = report.mfa ?? {};
  const recovery = report.accountRecovery ?? {};
  const command = report.controlledCommand ?? {};
  const publisher = report.outboxPublisher ?? {};

  const identityControlFailures = booleanFailures([
    authentication.syntheticAccountCleaned,
    authentication.sessionProbePassed,
    authentication.contextProbePassed,
    authentication.browserLoginPassed,
    authentication.browserLogoutPassed,
    authentication.legacyNeonAuthRemoved,
    mfa.encryptedAtRest,
    mfa.replayRejected,
    recovery.nonEnumeratingRequest,
    recovery.resetCompleted,
    recovery.oldSessionRevoked,
    recovery.oldPasswordRejected,
    recovery.newPasswordAccepted,
    recovery.mfaFactorsRevoked,
    recovery.outstandingStepUpRevoked,
    recovery.resetReplayRejected,
    recovery.emailVerificationCompleted,
    recovery.verificationReplayRejected,
  ]);
  const controlledCommandFailures = booleanFailures([
    mfa.createPassed,
    mfa.releasePassed,
    mfa.availabilityReconciled,
    command.createPassed,
    command.releasePassed,
    command.availabilityReconciled,
    command.syntheticReservationCleaned,
  ]);
  const artifactSecretLeaks = booleanFailures([
    authentication.credentialsPersistedInArtifacts === false,
    recovery.tokenHashOnly,
  ]);
  const outboxPublisherFailures = reportEvidenceInteger(publisher.failed)
    + reportEvidenceInteger(publisher.remaining)
    + booleanFailures([
      publisher.payloadsPersistedInArtifacts === false,
      publisher.externalDelivery === false,
    ]);

  return Object.freeze({
    http_probe_failures: report.status === "passed" && probes.length > 0 ? 0 : 1,
    browser_scenario_failures: browser.filter(({ passed }) => passed !== true).length,
    axe_violations: browser.reduce(
      (count, scenario) => count + (Array.isArray(scenario.violations) ? scenario.violations.length : 0),
      0,
    ),
    horizontal_overflow_failures: browser.filter(({ overflow }) => overflow === true).length,
    identity_control_failures: identityControlFailures,
    controlled_command_failures: controlledCommandFailures,
    artifact_secret_leaks: artifactSecretLeaks,
    outbox_publisher_failures: outboxPublisherFailures,
    inventory_reconciliation_mismatches: assertSafeInteger(
      databaseSignals.inventory_reconciliation_mismatches,
      "inventory_reconciliation_mismatches",
    ),
    journal_imbalance_count: assertSafeInteger(
      databaseSignals.journal_imbalance_count,
      "journal_imbalance_count",
    ),
    outbox_backlog_count: assertSafeInteger(
      databaseSignals.outbox_backlog_count,
      "outbox_backlog_count",
    ),
    outbox_oldest_unpublished_seconds: assertSafeInteger(
      databaseSignals.outbox_oldest_unpublished_seconds,
      "outbox_oldest_unpublished_seconds",
    ),
  });
}
