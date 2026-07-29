import test from "node:test";
import assert from "node:assert/strict";
import { discoverMigrationManifests } from "../../tooling/scripts/migration-manifests.mjs";

test("migration discovery keeps Foundation first and finance manifests ordered", async () => {
  const manifests = await discoverMigrationManifests(process.cwd());
  assert.equal(manifests[0].module, "FOUNDATION");
  const modules = manifests.slice(1).map((manifest) => manifest.module);
  for (const required of ["MOD-B-INVENTORY", "MOD-B-PROCUREMENT", "MOD-C-CUSTOMER", "MOD-C-SALES", "MOD-C-FULFILLMENT", "MOD-E-PAYMENT", "MOD-E-ACCOUNTING", "MOD-E-BANKING"]) {
    assert.ok(modules.includes(required), `${required} manifest is missing`);
  }
  assert.ok(modules.indexOf("MOD-E-PAYMENT") < modules.indexOf("MOD-E-ACCOUNTING"));
  assert.ok(modules.indexOf("MOD-E-ACCOUNTING") < modules.indexOf("MOD-E-BANKING"));
  const financeMigrationIds = manifests
    .flatMap((manifest) => manifest.migrations.map((migration) => migration.id))
    .filter((id) => /^(?:PAY|ACC|BNK)-/u.test(id));
  assert.deepEqual(financeMigrationIds, ["PAY-0001", "PAY-0002", "ACC-0001", "ACC-0002", "BNK-0001", "BNK-0002"]);
});
