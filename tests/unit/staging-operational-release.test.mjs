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
  for (const marker of [
    '"/admin/catalog"',
    '"/admin/customers"',
    '"/admin/sales"',
    '"admin-dashboard-desktop"',
    '"admin-catalog-mobile"',
    '"admin-inventory-desktop"',
    '"pos-register-mobile"',
  ]) {
    assert.ok(runner.includes(marker), `missing deployment evidence marker ${marker}`);
  }
});
