import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(pathname) {
  return await readFile(new URL(pathname, root), "utf8");
}

test("operational seed uses module tables, immutable stock provenance and synthetic identities", async () => {
  const sql = await source("tooling/fixtures/staging-operational-seed.sql");
  assert.match(sql, /INSERT INTO catalog\.products/u);
  assert.match(sql, /INSERT INTO pricing\.price_rules/u);
  assert.match(sql, /INSERT INTO inventory\.stock_ledger_entries/u);
  assert.doesNotMatch(sql, /INSERT INTO inventory\.stock_balances/u);
  assert.match(sql, /source_document_type[\s\S]*'staging_seed'/u);
  assert.match(sql, /STG-PG-OPENING/u);
  assert.equal((sql.match(/staging-opening-/gu) ?? []).length, 5);
  assert.equal((sql.match(/@example\.invalid/gu) ?? []).length, 3);
  assert.doesNotMatch(sql, /@(gmail|yahoo|outlook|hotmail)\./iu);
});

test("operational loader is idempotent, concurrency-safe and fails closed on partial data", async () => {
  const loader = await source("tooling/scripts/run-operational-staging.mjs");
  assert.match(loader, /pg_advisory_lock/u);
  assert.match(loader, /dataset already complete; immutable seed replay skipped/u);
  assert.match(loader, /dataset is partial; refusing an unsafe immutable seed replay/u);
  assert.match(loader, /inventory ledger reconciliation failed/u);
  assert.match(loader, /products:\s*5/u);
  assert.match(loader, /sales_orders:\s*3/u);
  assert.match(loader, /stock_balances:\s*5/u);
});

test("release data preserves exact POS minor units and normalizes unsupported numeral glyphs", async () => {
  const release = await source("apps/api/src/staging-operational-release-data.ts");
  assert.match(release, /BENGALI_DIGITS/u);
  assert.match(release, /exactMinorFromDisplay/u);
  assert.match(release, /lineTotalMinor:\s*exactMinorFromDisplay/u);
  assert.match(release, /subtotalMinor/u);
  assert.match(release, /payableMinor/u);
});

test("authenticated operational routes replace empty staging shells", async () => {
  const worker = await source("apps/api/src/staging-operational-worker.ts");
  assert.match(worker, /renderStagingDashboard/u);
  assert.match(worker, /renderStagingCatalog/u);
  assert.match(worker, /renderInventoryAdminPage/u);
  assert.match(worker, /renderProcurementAdminPage/u);
  assert.match(worker, /renderCustomerAdminPage/u);
  assert.match(worker, /renderSalesAdminPage/u);
  assert.match(worker, /loadReleaseCandidateOperationalData/u);
  assert.match(worker, /database-resolved read permissions/u);
});

test("persistent deployment proves useful routes and responsive browser surfaces", async () => {
  const runner = await source("tooling/scripts/run-custom-auth-staging.mjs");
  const deploy = await source("tooling/scripts/deploy-custom-auth-staging.mjs");
  const evidenceSources = `${runner}\n${deploy}`;
  for (const marker of [
    '"/admin/catalog"',
    '"/admin/customers"',
    '"/admin/sales"',
    '"admin-dashboard-desktop"',
    '"admin-catalog-mobile"',
    '"admin-inventory-desktop"',
    '"pos-register-mobile"',
  ]) {
    assert.ok(
      evidenceSources.includes(marker),
      `missing deployment evidence marker ${marker}`,
    );
  }
});

test("operational staging persists aggregate operability evidence before enforcing critical alerts", async () => {
  const loader = await source("tooling/scripts/run-operational-staging.mjs");
  assert.match(loader, /drainSyntheticOutbox/u);
  assert.match(loader, /collectStagingDatabaseSignals/u);
  assert.match(loader, /deriveStagingOperabilitySignals/u);
  assert.match(loader, /evaluateStagingOperability/u);
  assert.match(loader, /persistent-staging-report\.json/u);
  assert.match(loader, /persistent-staging-report\.json\.tmp/u);
  assert.match(loader, /outboxPublisher/u);
  assert.match(loader, /schemaVersion:\s*7/u);
  assert.match(loader, /await rename\(operabilityReportTemporaryPath, operabilityReportPath\)/u);
  assert.match(loader, /operability\.launchGate === "blocked"/u);
  assert.match(loader, /alert\.alertId/u);
  assert.doesNotMatch(loader, /alert\.observed/u);
});

test("persistent staging workflow publishes bounded operability summary and evidence paths", async () => {
  const workflow = await source(".github/workflows/persistent-admin-pos-staging.yml");
  for (const path of [
    '"tooling/scripts/staging-operability.mjs"',
    '"tooling/scripts/staging-outbox-publisher.mjs"',
    '"tests/unit/staging-operability.test.mjs"',
    '"tests/unit/staging-outbox-publisher.test.mjs"',
  ]) assert.ok(workflow.includes(path), `missing workflow path ${path}`);
  assert.match(workflow, /Outbox claimed\/delivered\/replayed:/u);
  assert.match(workflow, /Outbox failed\/remaining\/exhausted:/u);
  assert.match(workflow, /Outbox payloads in artifacts:/u);
  assert.match(workflow, /External outbox delivery:/u);
  assert.match(workflow, /Operability status:/u);
  assert.match(workflow, /Operability launch gate:/u);
  assert.match(workflow, /Operability warnings:/u);
  assert.match(workflow, /Operability critical alerts:/u);
  assert.match(workflow, /alert\.alertId/u);
  assert.match(workflow, /alert\.runbook/u);
  assert.doesNotMatch(workflow, /operability\?\.signals/u);
  assert.doesNotMatch(workflow, /alert\.observed/u);
});

test("operability documentation fixes ownership while preserving production blockers", async () => {
  const [runbook, plan, status, checkpoint] = await Promise.all([
    source("docs/architecture/staging/operability-alerts-runbook.md"),
    source("docs/architecture/staging/production-operability-plan.md"),
    source("docs/architecture/staging/status.yaml"),
    source("docs/architecture/staging/usable-release-candidate-checkpoint.md"),
  ]);
  for (const metric of [
    "http_probe_failures",
    "identity_control_failures",
    "artifact_secret_leaks",
    "outbox_publisher_failures",
    "inventory_reconciliation_mismatches",
    "journal_imbalance_count",
    "outbox_backlog_count",
  ]) assert.ok(runbook.includes(metric), `missing runbook metric ${metric}`);
  assert.match(runbook, /Synthetic outbox publisher failures are critical/u);
  assert.match(runbook, /FOR UPDATE SKIP LOCKED/u);
  assert.match(runbook, /production monitoring vendor/u);
  assert.match(plan, /twelve fixed low-cardinality aggregate signals/u);
  assert.match(plan, /schema-v7 atomic report enrichment/u);
  assert.match(plan, /production monitoring backend, alert delivery, paging and approved SLOs/u);
  assert.match(status, /schema_version: 11/u);
  assert.match(status, /report_schema_version: 7/u);
  assert.match(status, /signal_count: 12/u);
  assert.match(status, /live_evidence_state: pending_exact_head_workflow/u);
  assert.match(status, /consumer: staging-operability-evidence-v1/u);
  assert.match(status, /payloads_persisted_in_artifacts: false/u);
  assert.match(status, /external_delivery: false/u);
  assert.match(status, /production_alert_delivery: false/u);
  assert.match(checkpoint, /synthetic outbox publisher implementation complete; schema-v7 live evidence pending/u);
  assert.match(checkpoint, /canonical SHA-256 envelope digest/u);
  assert.match(checkpoint, /Production message transport, alert delivery, paging and approved SLOs are not configured/u);
});
