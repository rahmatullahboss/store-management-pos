import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const moduleDirectories = [
  new URL("../../database/modules/pos/", import.meta.url),
  new URL("../../database/modules/cash/", import.meta.url),
];

async function migrationInventory(moduleDirectory) {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", moduleDirectory), "utf8"));
  const referencedFiles = manifest.migrations.map((migration) => migration.file).sort();
  const migrationFiles = (await readdir(new URL("migrations/", moduleDirectory)))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return { manifest, referencedFiles, migrationFiles };
}

test("MOD-D manifests reference every SQL migration exactly once", async () => {
  for (const moduleDirectory of moduleDirectories) {
    const { manifest, referencedFiles, migrationFiles } = await migrationInventory(moduleDirectory);
    assert.equal(
      new Set(referencedFiles).size,
      referencedFiles.length,
      `${manifest.module} manifest must not reference a migration file more than once`,
    );
    assert.deepEqual(
      migrationFiles,
      referencedFiles,
      `${manifest.module} migrations directory must contain no orphan or unregistered SQL files`,
    );
  }
});
