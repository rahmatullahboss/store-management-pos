import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@neondatabase/serverless";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const manifest = JSON.parse(await readFile(path.join(root, "database/foundation/manifest.json"), "utf8"));
const client = new Client({ connectionString });
await client.connect();
try {
  for (const migration of manifest.migrations) {
    const existing = await client.query("SELECT checksum FROM platform.schema_migrations WHERE migration_id = $1", [migration.id]).catch(() => ({ rows: [] }));
    if (existing.rows.length > 0) continue;
    const sql = await readFile(path.join(root, "database/foundation/migrations", migration.file), "utf8");
    await client.query(sql);
    console.log(`applied ${migration.id}`);
  }
  if (process.env.LOAD_SYNTHETIC_SEED === "1") {
    await client.query(await readFile(path.join(root, "database/foundation/seeds/dev.sql"), "utf8"));
    console.log("loaded synthetic development seed");
  }
} finally {
  await client.end();
}
