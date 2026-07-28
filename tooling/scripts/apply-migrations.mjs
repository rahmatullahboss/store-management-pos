import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";
import { discoverMigrationManifests } from "./migration-manifests.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const manifests = await discoverMigrationManifests(root);
const client = new Client({ connectionString });
await client.connect();
try {
  for (const manifest of manifests) {
    for (const migration of manifest.migrations) {
      const sql = await readFile(path.join(manifest.migrationsDirectory, migration.file), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match the manifest`);
      const marker = `manifest:${migration.file}`;
      const existing = await client.query("SELECT checksum FROM platform.schema_migrations WHERE migration_id = $1", [migration.id]).catch(() => ({ rows: [] }));
      if (existing.rows.length > 0) {
        if (existing.rows[0].checksum !== marker) throw new Error(`${migration.id} database checksum marker does not match`);
        continue;
      }
      await client.query(sql);
      const applied = await client.query("SELECT checksum FROM platform.schema_migrations WHERE migration_id = $1", [migration.id]);
      if (applied.rows[0]?.checksum !== marker) throw new Error(`${migration.id} did not record the expected checksum marker`);
      console.log(`applied ${migration.id}`);
    }
  }
  if (process.env.LOAD_SYNTHETIC_SEED === "1") {
    await client.query(await readFile(path.join(root, "database/foundation/seeds/dev.sql"), "utf8"));
    console.log("loaded synthetic development seed");
  }
} finally {
  await client.end();
}
