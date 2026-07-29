import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

function assertManifest(value, sourcePath) {
  if (typeof value !== "object" || value === null) throw new TypeError(`${sourcePath} must contain an object`);
  const manifest = value;
  if (typeof manifest.module !== "string" || manifest.module.length === 0) throw new TypeError(`${sourcePath} module is required`);
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) throw new TypeError(`${sourcePath} migrations are required`);
  const migrations = manifest.migrations.map((migration, index) => {
    if (typeof migration !== "object" || migration === null) throw new TypeError(`${sourcePath} migration ${index + 1} must be an object`);
    if (typeof migration.id !== "string" || typeof migration.file !== "string" || typeof migration.sha256 !== "string") {
      throw new TypeError(`${sourcePath} migration ${index + 1} requires id, file and sha256`);
    }
    if (!/^[a-f0-9]{64}$/u.test(migration.sha256)) throw new TypeError(`${sourcePath} migration ${migration.id} has an invalid SHA-256`);
    return Object.freeze({ id: migration.id, file: migration.file, sha256: migration.sha256 });
  });
  const order = typeof manifest.order === "number" ? manifest.order : 0;
  return Object.freeze({
    module: manifest.module,
    version: manifest.version,
    order,
    migrations: Object.freeze(migrations),
    manifestPath: sourcePath,
    migrationsDirectory: path.join(path.dirname(sourcePath), "migrations"),
  });
}

async function readManifest(sourcePath) {
  return assertManifest(JSON.parse(await readFile(sourcePath, "utf8")), sourcePath);
}

export async function discoverMigrationManifests(root) {
  const manifests = [await readManifest(path.join(root, "database/foundation/manifest.json"))];
  const modulesRoot = path.join(root, "database/modules");
  let moduleDirectories = [];
  try {
    moduleDirectories = (await readdir(modulesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return Object.freeze(manifests);
    throw error;
  }
  for (const directory of moduleDirectories) {
    const manifestPath = path.join(modulesRoot, directory, "manifest.json");
    try {
      manifests.push(await readManifest(manifestPath));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  manifests.sort((left, right) => left.order - right.order || left.module.localeCompare(right.module));
  const migrationIds = new Set();
  for (const manifest of manifests) {
    for (const migration of manifest.migrations) {
      if (migrationIds.has(migration.id)) throw new TypeError(`Duplicate migration id ${migration.id}`);
      migrationIds.add(migration.id);
    }
  }
  return Object.freeze(manifests);
}
