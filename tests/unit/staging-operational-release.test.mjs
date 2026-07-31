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
  const patcher = await source("tooling/scripts/staging-custom-auth-patch.mjs");
  const evidenceSources = `${runner}\n${deploy}\n${patcher}`;
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
  const [runbook, plan, status, checkpoint, backupAcceptance, financeRecovery] = await Promise.all([
    source("docs/architecture/staging/operability-alerts-runbook.md"),
    source("docs/architecture/staging/production-operability-plan.md"),
    source("docs/architecture/staging/status.yaml"),
    source("docs/architecture/staging/usable-release-candidate-checkpoint.md"),
    source("docs/architecture/staging/backup-restore-acceptance.md"),
    source("docs/modules/payments-accounting-banking/migration-and-recovery-runbook.md"),
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
  assert.match(status, /schema_version: 15/u);
  assert.match(status, /status: asymmetric_internal_token_implemented_pending_live_evidence/u);
  assert.match(status, /signing_algorithm: RS256/u);
  assert.match(status, /key_id_required: true/u);
  assert.ok(status.includes("public_jwks_path: /internal-identity/.well-known/jwks.json"));
  assert.match(status, /private_key_published: false/u);
  assert.match(status, /report_schema_version: 7/u);
  assert.match(status, /signal_count: 12/u);
  assert.match(status, /live_evidence_state: exact_head_verified/u);
  assert.match(status, /operability_status: healthy/u);
  assert.match(status, /launch_gate: clear/u);
  assert.match(status, /warning_count: 0/u);
  assert.match(status, /critical_count: 0/u);
  assert.match(status, /claimed: 2/u);
  assert.match(status, /delivered: 2/u);
  assert.match(status, /remaining: 0/u);
  assert.match(status, /consumer: staging-operability-evidence-v1/u);
  assert.match(status, /payloads_persisted_in_artifacts: false/u);
  assert.match(status, /external_delivery: false/u);
  assert.match(status, /production_alert_delivery: false/u);
  assert.match(checkpoint, /operability gate clear; disposable full-registry recovery verified; production acceptance pending/u);
  assert.match(checkpoint, /outbox batches \/ claimed \/ delivered \/ replayed: `2 \/ 44 \/ 44 \/ 0`/u);
  assert.match(checkpoint, /Production message transport, alert delivery, paging, dead-letter ownership and approved SLOs are not configured/u);
  assert.match(checkpoint, /restore-ready \/ reconciliation \/ total recovery: `2,388\.30 \/ 1,368\.19 \/ 3,756\.49 ms`/u);
  assert.match(checkpoint, /generic preview job `90996337636` was intentionally skipped/u);
  assert.match(plan, /shared executor verifies checksums for all 17 manifests and 64 registered migrations/u);
  assert.match(status, /backup_restore_rehearsal:/u);
  assert.match(status, /status: live_evidence_complete_production_acceptance_pending/u);
  assert.match(status, /registered_migration_count: 64/u);
  assert.match(status, /exact_checkpoint_restore: true/u);
  assert.match(status, /marker_reconciled: true/u);
  assert.match(status, /restore_ready_ms: 2388\.3/u);
  assert.match(status, /reconciliation_ms: 1368\.19/u);
  assert.match(status, /total_recovery_ms: 3756\.49/u);
  assert.match(status, /cleanup_deleted: true/u);
  assert.match(status, /generic_preview_result: skipped_by_dedicated_persistent_staging_policy/u);
  assert.match(status, /production_acceptance: false/u);
  assert.match(status, /production_class_rehearsal_accepted: false/u);
  assert.match(backupAcceptance, /it is not a production backup policy/u);
  assert.match(backupAcceptance, /all 17 manifests and 64 registered migrations/u);
  assert.match(backupAcceptance, /Exact-head disposable recovery evidence/u);
  assert.match(backupAcceptance, /This evidence satisfies the disposable CI rehearsal gate only/u);
  assert.match(backupAcceptance, /Production backup\/restore remains \*\*not accepted\*\*/u);
  assert.match(backupAcceptance, /two-person authorization/u);
  assert.match(financeRecovery, /shared 17-manifest\/64-migration registry/u);
  assert.match(financeRecovery, /it is not production backup acceptance/u);
});
