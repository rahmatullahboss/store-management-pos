import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sources = [
  { module: "MOD-B", manifest: "database/modules/inventory/manifest.json", directory: "database/modules/inventory/migrations" },
  { module: "MOD-B", manifest: "database/modules/procurement/manifest.json", directory: "database/modules/procurement/migrations" },
  { module: "MOD-C", manifest: "database/modules/customer/manifest.json", directory: "database/modules/customer/migrations" },
  { module: "MOD-C", manifest: "database/modules/sales/manifest.json", directory: "database/modules/sales/migrations" },
  { module: "MOD-C", manifest: "database/modules/fulfillment/manifest.json", directory: "database/modules/fulfillment/migrations" },
  { module: "MOD-E", manifest: "database/modules/payments/manifest.json", directory: "database/modules/payments/migrations" },
  { module: "MOD-E", manifest: "database/modules/accounting/manifest.json", directory: "database/modules/accounting/migrations" },
  { module: "MOD-E", manifest: "database/modules/banking/manifest.json", directory: "database/modules/banking/migrations" },
  { module: "MOD-D", manifest: "database/modules/pos/manifest.json", directory: "database/modules/pos/migrations" },
  { module: "MOD-D", manifest: "database/modules/cash/manifest.json", directory: "database/modules/cash/migrations" },
];
const ids = new Set();
const databaseMarkers = new Map();
const counts = new Map();
for (const source of sources) {
  const manifest = JSON.parse(await readFile(path.join(root, source.manifest), "utf8"));
  for (const migration of manifest.migrations) {
    if (ids.has(migration.id)) throw new Error(`Duplicate module migration id ${migration.id}`);
    ids.add(migration.id);
    counts.set(source.module, (counts.get(source.module) ?? 0) + 1);
    const sql = await readFile(path.join(root, source.directory, migration.file), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match manifest: expected ${migration.sha256}, computed ${digest}`);
    if (!sql.includes(`VALUES ('${migration.id}'`)) throw new Error(`${migration.id} does not record its schema migration marker`);
    if (/CREATE TABLE/u.test(sql) && (!/ENABLE ROW LEVEL SECURITY/u.test(sql) || !/FORCE ROW LEVEL SECURITY/u.test(sql))) throw new Error(`${migration.id} creates tables without forced RLS`);
    if (!/BEGIN;/u.test(sql) || !/COMMIT;/u.test(sql)) throw new Error(`${migration.id} must be transactional`);

    const canonicalMarker = `manifest:${migration.file}`;
    const legacyMarkers = migration.legacyMarkers ?? [];
    if (!Array.isArray(legacyMarkers)) throw new Error(`${migration.id} legacyMarkers must be an array`);
    for (const marker of [canonicalMarker, ...legacyMarkers]) {
      if (typeof marker !== "string" || !/^manifest:[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/u.test(marker)) {
        throw new Error(`${migration.id} contains an invalid database checksum marker`);
      }
      if (marker !== canonicalMarker && marker === canonicalMarker) throw new Error(`${migration.id} repeats its canonical checksum marker`);
      const owner = databaseMarkers.get(marker);
      if (owner) throw new Error(`${migration.id} reuses database checksum marker ${marker} owned by ${owner}`);
      databaseMarkers.set(marker, migration.id);
    }
    if (new Set(legacyMarkers).size !== legacyMarkers.length || legacyMarkers.includes(canonicalMarker)) {
      throw new Error(`${migration.id} contains duplicate legacy checksum markers`);
    }
  }
}
const inventory = await readFile(path.join(root, "database/modules/inventory/migrations/INV-0001-core.sql"), "utf8");
if (!/stock_ledger_append_only/u.test(inventory)) throw new Error("Inventory ledger append-only trigger is missing");
if (!/negative stock requires approval/u.test(inventory)) throw new Error("Negative-stock approval guard is missing");
const procurement = await readFile(path.join(root, "database/modules/procurement/migrations/PUR-0001-procurement.sql"), "utf8");
if (/REFERENCES catalog\./u.test(procurement)) throw new Error("MOD-B must not depend on unmerged MOD-A tables");
if (!/goods_receipt_lines_append_only/u.test(procurement)) throw new Error("Goods receipt lineage immutability is missing");
const pos = await readFile(path.join(root, "database/modules/pos/migrations/POS-0001-store-edge.sql"), "utf8");
if (!/receipt_snapshots_append_only/u.test(pos)) throw new Error("POS receipt snapshot append-only trigger is missing");
if (!/checkout_operation_identity_immutable/u.test(pos)) throw new Error("POS checkout identity immutability guard is missing");
if (!/payment_state <> 'unknown' OR status IN \('pending','unknown','review'\)/u.test(pos)) throw new Error("POS unknown-payment retry guard is missing");
const cash = await readFile(path.join(root, "database/modules/cash/migrations/CSH-0001-cash-ledger.sql"), "utf8");
if (!/cash_events_append_only/u.test(cash)) throw new Error("Cash event append-only trigger is missing");
if (!/expected_minor/u.test(cash) || !/variance_minor/u.test(cash)) throw new Error("Cash reconciliation reconstruction is missing");
const cashControls = await readFile(path.join(root, "database/modules/cash/migrations/CSH-0002-reversal-controls.sql"), "utf8");
if (!/cash_events_one_reversal_idx/u.test(cashControls)) throw new Error("Cash reversal uniqueness guard is missing");
if (!/cash reversal must exactly offset the original event/u.test(cashControls)) throw new Error("Cash exact reversal guard is missing");
if (!/cash events require an open or explicitly reopened shift/u.test(cashControls)) throw new Error("Closed-shift cash event guard is missing");
if (!/CREATE VIEW cash\.shift_expected_cash/u.test(cashControls)) throw new Error("Cash expected-balance reconstruction view is missing");
console.log(`validated ${ids.size} module migrations (${[...counts].map(([module, count]) => `${module}:${count}`).join(", ")})`);
