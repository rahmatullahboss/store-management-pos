import test from "node:test";
import assert from "node:assert/strict";
import { discoverMigrationManifests } from "../../tooling/scripts/migration-manifests.mjs";

test("migration discovery orders Foundation before module manifests", async () => {
  const manifests = await discoverMigrationManifests(process.cwd());
  assert.equal(manifests[0].module, "FOUNDATION");
  assert.deepEqual(manifests.slice(1).map((manifest) => manifest.module), ["MOD-E-PAYMENT", "MOD-E-ACCOUNTING", "MOD-E-BANKING"]);
  assert.deepEqual(manifests.flatMap((manifest) => manifest.migrations.map((migration) => migration.id)), [
    "FND-0001", "FND-0002", "FND-0003", "FND-0004", "FND-0005",
    "PAY-0001", "PAY-0002", "ACC-0001", "BNK-0001",
  ]);
});
