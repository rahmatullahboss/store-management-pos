import test from "node:test";
import assert from "node:assert/strict";
import { discoverMigrationManifests } from "../../tooling/scripts/migration-manifests.mjs";

test("migration discovery includes the complete explicitly ordered platform registry", async () => {
  const manifests = await discoverMigrationManifests(process.cwd());
  assert.deepEqual(
    manifests.map((manifest) => manifest.module),
    [
      "FOUNDATION",
      "MOD-A-CATALOG",
      "MOD-A-PRICING",
      "MOD-A-TAX",
      "MOD-B-INVENTORY",
      "MOD-B-PROCUREMENT",
      "MOD-C-CUSTOMER",
      "MOD-C-SALES",
      "MOD-C-FULFILLMENT",
      "MOD-E-PAYMENT",
      "MOD-E-ACCOUNTING",
      "MOD-E-BANKING",
      "MOD-D-POS",
      "MOD-D-CASH",
      "MOD-F-LOCALIZATION",
      "MOD-G-REPORTING",
      "MOD-G-INTEGRATION",
    ],
  );
  const migrationIds = manifests.flatMap((manifest) => manifest.migrations.map((migration) => migration.id));
  assert.equal(migrationIds.length, 64);
  assert.equal(new Set(migrationIds).size, 64);
  assert.deepEqual(migrationIds.slice(14, 22), [
    "CAT-0001",
    "CAT-0002",
    "CAT-0003",
    "PRC-0001",
    "PRC-0002",
    "PRC-0003",
    "TAX-0001",
    "TAX-0002",
  ]);
  assert.deepEqual(
    migrationIds.filter((id) => /^(?:PAY|ACC|BNK)-/u.test(id)),
    ["PAY-0001", "PAY-0002", "ACC-0001", "ACC-0002", "BNK-0001", "BNK-0002"],
  );
});
