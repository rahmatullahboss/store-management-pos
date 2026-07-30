import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverMigrationManifests } from "./migration-manifests.mjs";

function requireQueryClient(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("A query-capable database client is required");
  }
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function freezeMetadata(manifests, migrationIds) {
  return Object.freeze({
    schemaVersion: 1,
    manifestCount: manifests.length,
    migrationCount: migrationIds.length,
    moduleIds: Object.freeze(manifests.map(({ module }) => module)),
    migrationIds: Object.freeze([...migrationIds]),
  });
}

export async function verifyAppliedMigrationRegistry(client, expectedMigrationIds) {
  requireQueryClient(client);
  if (!Array.isArray(expectedMigrationIds) || expectedMigrationIds.length === 0) {
    throw new TypeError("Expected migration IDs are required");
  }
  const expected = expectedMigrationIds.map((value, index) => nonEmptyString(value, `expected migration ID ${index + 1}`));
  if (new Set(expected).size !== expected.length) {
    throw new TypeError("Expected migration IDs must be unique");
  }
  const result = await client.query(
    `SELECT migration_id
     FROM platform.schema_migrations
     ORDER BY array_position($1::text[], migration_id::text), migration_id`,
    [expected],
  );
  if (!result || !Array.isArray(result.rows)) {
    throw new Error("Applied migration registry query did not return rows");
  }
  const actual = result.rows.map((row, index) => nonEmptyString(row?.migration_id, `migration_id at row ${index + 1}`));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Applied migration registry does not match the verified plan");
  }
  return Object.freeze({ exact: true, migrationCount: actual.length });
}

export async function prepareMigrationRegistry(root) {
  const manifests = await discoverMigrationManifests(root);
  const entries = [];
  const migrationIds = [];

  for (const manifest of manifests) {
    for (const migration of manifest.migrations) {
      const sourcePath = path.join(manifest.migrationsDirectory, migration.file);
      const sql = await readFile(sourcePath, "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      if (digest !== migration.sha256) {
        throw new Error(`${migration.id} checksum does not match the manifest`);
      }
      entries.push(Object.freeze({ id: migration.id, sql }));
      migrationIds.push(migration.id);
    }
  }

  const foundationSeed = await readFile(path.join(root, "database", "foundation", "seeds", "dev.sql"), "utf8");
  const metadata = freezeMetadata(manifests, migrationIds);

  async function apply(client, options = {}) {
    requireQueryClient(client);
    const loadFoundationSeed = options.loadFoundationSeed !== false;
    const verifyMarkers = options.verifyMarkers !== false;
    for (const entry of entries) {
      await client.query(entry.sql);
    }
    if (loadFoundationSeed) {
      await client.query(foundationSeed);
    }
    if (verifyMarkers) {
      await verifyAppliedMigrationRegistry(client, metadata.migrationIds);
    }
    return metadata;
  }

  return Object.freeze({ metadata, apply });
}

export async function applyMigrationRegistry(client, root, options = {}) {
  const plan = await prepareMigrationRegistry(root);
  return plan.apply(client, options);
}
