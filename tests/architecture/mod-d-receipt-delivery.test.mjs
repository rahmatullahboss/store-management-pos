import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baseMigrationUrl = new URL("../../database/modules/pos/migrations/POS-0003-offline-sync-security.sql", import.meta.url);
const deliveryMigrationUrl = new URL("../../database/modules/pos/migrations/POS-0008-receipt-delivery.sql", import.meta.url);
const manifestUrl = new URL("../../database/modules/pos/manifest.json", import.meta.url);
const repositoryUrl = new URL("../../modules/pos/src/receipt-repository.ts", import.meta.url);
const handlerUrl = new URL("../../apps/api/src/modules/pos/receipt-handler.ts", import.meta.url);
const apiIndexUrl = new URL("../../apps/api/src/index.ts", import.meta.url);

test("receipt delivery schema is append-only and POS-0008 adds the runtime command boundary", async () => {
  const [baseMigration, deliveryMigration, manifestSource] = await Promise.all([
    readFile(baseMigrationUrl, "utf8"),
    readFile(deliveryMigrationUrl, "utf8"),
    readFile(manifestUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.ok(manifest.migrations.some((migrationEntry) => migrationEntry.id === "POS-0008" && migrationEntry.file === "POS-0008-receipt-delivery.sql"));

  assert.match(baseMigration, /CREATE TABLE pos\.receipt_delivery_requests/u);
  assert.match(baseMigration, /UNIQUE \(tenant_id, receipt_snapshot_id, idempotency_key\)/u);
  assert.match(baseMigration, /receipt_delivery_requests_append_only/u);
  assert.match(baseMigration, /ALTER TABLE pos\.%I ENABLE ROW LEVEL SECURITY/u);
  assert.match(baseMigration, /ALTER TABLE pos\.%I FORCE ROW LEVEL SECURITY/u);
  assert.match(baseMigration, /CREATE POLICY tenant_isolation/u);

  assert.match(deliveryMigration, /ALTER TABLE pos\.receipt_delivery_requests/u);
  assert.match(deliveryMigration, /receipt_delivery_requests_reason_present/u);
  assert.match(deliveryMigration, /CREATE OR REPLACE FUNCTION pos\.request_receipt_delivery_v1/u);
  assert.match(deliveryMigration, /SECURITY DEFINER/u);
  assert.match(deliveryMigration, /REVOKE ALL ON FUNCTION pos\.request_receipt_delivery_v1/u);
  assert.match(deliveryMigration, /GRANT EXECUTE ON FUNCTION pos\.request_receipt_delivery_v1/u);
  assert.match(deliveryMigration, /pos\.receipt\.delivery\.requested\.v1/u);
  assert.match(deliveryMigration, /platform\.audit_events/u);
  assert.match(deliveryMigration, /platform\.outbox_events/u);
});

test("receipt API never bypasses tenant lookup or delivery permissions", async () => {
  const [repository, handler, apiIndex] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(handlerUrl, "utf8"),
    readFile(apiIndexUrl, "utf8"),
  ]);

  assert.match(repository, /WHERE tenant_id=\$1::uuid AND id=\$2::uuid/u);
  assert.match(repository, /WHERE tenant_id=\$1::uuid AND receipt_number=\$2/u);
  assert.match(repository, /pos\.request_receipt_delivery_v1/u);
  assert.doesNotMatch(repository, /INSERT INTO pos\.receipt_delivery_requests/u);
  assert.match(handler, /requirePermission\(context, "pos\.checkout\.read"\)/u);
  assert.match(handler, /input\.channel === "print" \? "pos\.receipt\.reprint" : "pos\.receipt\.deliver"/u);
  assert.match(apiIndex, /handlePosReceiptRequest/u);
});
