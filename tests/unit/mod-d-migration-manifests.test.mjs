import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { discoverMigrationManifests } from "../../tooling/scripts/migration-manifests.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("MOD-D migrations run after the complete Wave 1 finance chain", async () => {
  const manifests = await discoverMigrationManifests(root);
  const modules = manifests.map((manifest) => manifest.module);

  assert.ok(modules.indexOf("MOD-E-PAYMENT") < modules.indexOf("MOD-E-ACCOUNTING"));
  assert.ok(modules.indexOf("MOD-E-ACCOUNTING") < modules.indexOf("MOD-E-BANKING"));
  assert.ok(modules.indexOf("MOD-E-BANKING") < modules.indexOf("MOD-D-POS"));
  assert.ok(modules.indexOf("MOD-D-POS") < modules.indexOf("MOD-D-CASH"));

  const modDMigrationIds = manifests
    .filter((manifest) => manifest.module === "MOD-D-POS" || manifest.module === "MOD-D-CASH")
    .flatMap((manifest) => manifest.migrations.map((migration) => migration.id));
  const requiredIds = [
    "POS-0001",
    "POS-0002",
    "POS-0003",
    "POS-0004",
    "POS-0005",
    "POS-0006",
    "POS-0007",
    "CSH-0001",
    "CSH-0002",
    "CSH-0003",
    "CSH-0004",
    "CSH-0005",
    "CSH-0006",
  ];
  for (const migrationId of requiredIds) assert.ok(modDMigrationIds.includes(migrationId), `${migrationId} must remain registered`);
  assert.equal(new Set(modDMigrationIds).size, modDMigrationIds.length, "MOD-D migration IDs must remain unique");
});
