import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const availableModules = [
  { name: "FOUNDATION", manifest: "database/foundation/manifest.json", migrations: "database/foundation/migrations" },
  { name: "MOD-A-CATALOG", manifest: "database/migrations/catalog/manifest.json", migrations: "database/migrations/catalog" },
  { name: "MOD-A-PRICING", manifest: "database/migrations/pricing/manifest.json", migrations: "database/migrations/pricing" },
  { name: "MOD-A-TAX", manifest: "database/migrations/tax/manifest.json", migrations: "database/migrations/tax" },
  { name: "MOD-B-INVENTORY", manifest: "database/modules/inventory/manifest.json", migrations: "database/modules/inventory/migrations" },
  { name: "MOD-B-PROCUREMENT", manifest: "database/modules/procurement/manifest.json", migrations: "database/modules/procurement/migrations" },
];

const dependencies = new Map([
  ["MOD-A-CATALOG", ["FOUNDATION"]],
  ["MOD-A-PRICING", ["FOUNDATION", "MOD-A-CATALOG"]],
  ["MOD-A-TAX", ["FOUNDATION"]],
  ["MOD-B-INVENTORY", ["FOUNDATION"]],
  ["MOD-B-PROCUREMENT", ["FOUNDATION", "MOD-B-INVENTORY"]],
]);

const requested = new Set((process.env.MIGRATION_MODULES ?? availableModules.map((item) => item.name).join(",")).split(",").map((item) => item.trim()).filter(Boolean));
const unknown = [...requested].filter((name) => !availableModules.some((item) => item.name === name));
if (unknown.length > 0) throw new Error(`Unknown migration module(s): ${unknown.join(", ")}`);
for (const name of requested) {
  for (const dependency of dependencies.get(name) ?? []) {
    if (!requested.has(dependency)) throw new Error(`${name} requires ${dependency}`);
  }
}

const client = new Client({ connectionString });
await client.connect();
try {
  for (const source of availableModules.filter((item) => requested.has(item.name))) {
    const manifest = JSON.parse(await readFile(path.join(root, source.manifest), "utf8"));
    if (manifest.module !== source.name) throw new Error(`${source.manifest} module identity does not match ${source.name}`);
    for (const migration of manifest.migrations) {
      const sql = await readFile(path.join(root, source.migrations, migration.file), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match the manifest`);
      const marker = `manifest:${migration.file}`;
      const existing = await client.query("SELECT checksum FROM platform.schema_migrations WHERE migration_id = $1", [migration.id]).catch(() => ({ rows: [] }));
      if (existing.rows.length > 0) {
        if (existing.rows[0].checksum !== marker) throw new Error(`${migration.id} database checksum marker does not match`);
        console.log(`verified ${migration.id}`);
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
