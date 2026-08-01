import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

function assertManifest(value, sourcePath, migrationsDirectory) {
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
    migrationsDirectory,
  });
}

async function readManifest(sourcePath, migrationsDirectory) {
  return assertManifest(JSON.parse(await readFile(sourcePath, "utf8")), sourcePath, migrationsDirectory);
}

async function appendDirectoryManifests(manifests, directory, nestedMigrations) {
  let directories = [];
  try {
    directories = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const name of directories) {
    const moduleDirectory = path.join(directory, name);
    const manifestPath = path.join(moduleDirectory, "manifest.json");
    const migrationsDirectory = nestedMigrations ? path.join(moduleDirectory, "migrations") : moduleDirectory;
    try {
      manifests.push(await readManifest(manifestPath, migrationsDirectory));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

export async function discoverMigrationManifests(root) {
  const foundationDirectory = path.join(root, "database", "foundation");
  const manifests = [await readManifest(
    path.join(foundationDirectory, "manifest.json"),
    path.join(foundationDirectory, "migrations"),
  )];
  await appendDirectoryManifests(manifests, path.join(root, "database", "migrations"), false);
  await appendDirectoryManifests(manifests, path.join(root, "database", "modules"), true);
  manifests.sort((left, right) => left.order - right.order || left.module.localeCompare(right.module));
  const moduleIds = new Set();
  const migrationIds = new Set();
  for (const manifest of manifests) {
    if (moduleIds.has(manifest.module)) throw new TypeError(`Duplicate migration module ${manifest.module}`);
    moduleIds.add(manifest.module);
    for (const migration of manifest.migrations) {
      if (migrationIds.has(migration.id)) throw new TypeError(`Duplicate migration id ${migration.id}`);
      migrationIds.add(migration.id);
    }
  }
  return Object.freeze(manifests);
}
