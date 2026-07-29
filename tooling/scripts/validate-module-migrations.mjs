import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sources = [
  { manifest: "database/modules/inventory/manifest.json", directory: "database/modules/inventory/migrations" },
  { manifest: "database/modules/procurement/manifest.json", directory: "database/modules/procurement/migrations" },
];
const ids = new Set();
for (const source of sources) {
  const manifest = JSON.parse(await readFile(path.join(root, source.manifest), "utf8"));
  for (const migration of manifest.migrations) {
    if (ids.has(migration.id)) throw new Error(`Duplicate module migration id ${migration.id}`);
    ids.add(migration.id);
    const sql = await readFile(path.join(root, source.directory, migration.file), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match manifest`);
    if (!sql.includes(`VALUES ('${migration.id}'`)) throw new Error(`${migration.id} does not record its schema migration marker`);
    if (!/ENABLE ROW LEVEL SECURITY/u.test(sql) || !/FORCE ROW LEVEL SECURITY/u.test(sql)) throw new Error(`${migration.id} must configure RLS`);
    if (!/BEGIN;/u.test(sql) || !/COMMIT;/u.test(sql)) throw new Error(`${migration.id} must be transactional`);
  }
}
const inventory = await readFile(path.join(root, "database/modules/inventory/migrations/INV-0001-core.sql"), "utf8");
if (!/stock_ledger_append_only/u.test(inventory)) throw new Error("Inventory ledger append-only trigger is missing");
if (!/negative stock requires approval/u.test(inventory)) throw new Error("Negative-stock approval guard is missing");
const procurement = await readFile(path.join(root, "database/modules/procurement/migrations/PUR-0001-procurement.sql"), "utf8");
if (/REFERENCES catalog\./u.test(procurement)) throw new Error("MOD-B must not depend on unmerged MOD-A tables");
if (!/goods_receipt_lines_append_only/u.test(procurement)) throw new Error("Goods receipt lineage immutability is missing");
console.log(`validated ${ids.size} MOD-B migrations`);
