import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";
import { executeSqlStatements } from "./sql-statements.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const migrationLockName = "store-management-pos:schema-migrations";

const availableModules = [
  { name: "FOUNDATION", manifest: "database/foundation/manifest.json", migrations: "database/foundation/migrations" },
  { name: "MOD-A-CATALOG", manifest: "database/migrations/catalog/manifest.json", migrations: "database/migrations/catalog" },
  { name: "MOD-A-PRICING", manifest: "database/migrations/pricing/manifest.json", migrations: "database/migrations/pricing" },
  { name: "MOD-A-TAX", manifest: "database/migrations/tax/manifest.json", migrations: "database/migrations/tax" },
  { name: "MOD-B-INVENTORY", manifest: "database/modules/inventory/manifest.json", migrations: "database/modules/inventory/migrations" },
  { name: "MOD-B-PROCUREMENT", manifest: "database/modules/procurement/manifest.json", migrations: "database/modules/procurement/migrations" },
  { name: "MOD-C-CUSTOMER", manifest: "database/modules/customer/manifest.json", migrations: "database/modules/customer/migrations" },
  { name: "MOD-C-SALES", manifest: "database/modules/sales/manifest.json", migrations: "database/modules/sales/migrations" },
  { name: "MOD-C-FULFILLMENT", manifest: "database/modules/fulfillment/manifest.json", migrations: "database/modules/fulfillment/migrations" },
  { name: "MOD-E-PAYMENT", manifest: "database/modules/payments/manifest.json", migrations: "database/modules/payments/migrations" },
  { name: "MOD-E-ACCOUNTING", manifest: "database/modules/accounting/manifest.json", migrations: "database/modules/accounting/migrations" },
  { name: "MOD-E-BANKING", manifest: "database/modules/banking/manifest.json", migrations: "database/modules/banking/migrations" },
  { name: "MOD-D-POS", manifest: "database/modules/pos/manifest.json", migrations: "database/modules/pos/migrations" },
  { name: "MOD-D-CASH", manifest: "database/modules/cash/manifest.json", migrations: "database/modules/cash/migrations" },
  { name: "MOD-F-LOCALIZATION", manifest: "database/modules/localization/manifest.json", migrations: "database/modules/localization/migrations" },
  { name: "MOD-H-STOREFRONT", manifest: "database/modules/storefront/manifest.json", migrations: "database/modules/storefront/migrations" },
];

const dependencies = new Map([
  ["MOD-A-CATALOG", ["FOUNDATION"]],
  ["MOD-A-PRICING", ["FOUNDATION", "MOD-A-CATALOG"]],
  ["MOD-A-TAX", ["FOUNDATION"]],
  ["MOD-B-INVENTORY", ["FOUNDATION"]],
  ["MOD-B-PROCUREMENT", ["FOUNDATION", "MOD-B-INVENTORY"]],
  ["MOD-C-CUSTOMER", ["FOUNDATION"]],
  ["MOD-C-SALES", ["FOUNDATION", "MOD-A-CATALOG", "MOD-A-PRICING", "MOD-A-TAX", "MOD-B-INVENTORY", "MOD-C-CUSTOMER"]],
  ["MOD-C-FULFILLMENT", ["FOUNDATION", "MOD-B-INVENTORY", "MOD-C-SALES"]],
  ["MOD-E-PAYMENT", ["FOUNDATION", "MOD-C-SALES"]],
  ["MOD-E-ACCOUNTING", ["FOUNDATION", "MOD-C-SALES", "MOD-E-PAYMENT"]],
  ["MOD-E-BANKING", ["FOUNDATION", "MOD-E-PAYMENT", "MOD-E-ACCOUNTING"]],
  ["MOD-D-POS", ["FOUNDATION"]],
  ["MOD-D-CASH", ["FOUNDATION", "MOD-D-POS"]],
  ["MOD-F-LOCALIZATION", ["FOUNDATION", "MOD-A-TAX", "MOD-C-SALES", "MOD-D-POS", "MOD-E-ACCOUNTING"]],
  ["MOD-H-STOREFRONT", [
    "FOUNDATION",
    "MOD-A-CATALOG",
    "MOD-A-PRICING",
    "MOD-A-TAX",
    "MOD-B-INVENTORY",
    "MOD-C-CUSTOMER",
    "MOD-C-SALES",
    "MOD-C-FULFILLMENT",
    "MOD-E-PAYMENT",
    "MOD-E-ACCOUNTING",
    "MOD-F-LOCALIZATION",
  ]],
]);

const requested = new Set((process.env.MIGRATION_MODULES ?? availableModules.map((item) => item.name).join(",")).split(",").map((item) => item.trim()).filter(Boolean));
const unknown = [...requested].filter((name) => !availableModules.some((item) => item.name === name));
if (unknown.length > 0) throw new Error(`Unknown migration module(s): ${unknown.join(", ")}`);
for (const name of requested) {
  for (const dependency of dependencies.get(name) ?? []) if (!requested.has(dependency)) throw new Error(`${name} requires ${dependency}`);
}

function acceptedMarkers(migration) {
  const marker = `manifest:${migration.file}`;
  const legacyMarkers = migration.legacyMarkers ?? [];
  if (!Array.isArray(legacyMarkers)) throw new Error(`${migration.id} legacyMarkers must be an array`);
  const accepted = new Set([marker]);
  for (const legacyMarker of legacyMarkers) {
    if (typeof legacyMarker !== "string" || !/^manifest:[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/u.test(legacyMarker)) {
      throw new Error(`${migration.id} contains an invalid legacy checksum marker`);
    }
    if (legacyMarker === marker || accepted.has(legacyMarker)) {
      throw new Error(`${migration.id} contains a duplicate legacy checksum marker`);
    }
    accepted.add(legacyMarker);
  }
  return { marker, accepted };
}

const client = new Client({ connectionString });
await client.connect();
await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [migrationLockName]);
try {
  for (const source of availableModules.filter((item) => requested.has(item.name))) {
    const manifest = JSON.parse(await readFile(path.join(root, source.manifest), "utf8"));
    if (manifest.module !== source.name) throw new Error(`${source.manifest} module identity does not match ${source.name}`);
    for (const migration of manifest.migrations) {
      const sql = await readFile(path.join(root, source.migrations, migration.file), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      if (digest !== migration.sha256) throw new Error(`${migration.id} checksum does not match the manifest`);
      const { marker, accepted } = acceptedMarkers(migration);
      const existing = await client.query("SELECT checksum FROM platform.schema_migrations WHERE migration_id = $1", [migration.id]).catch(() => ({ rows: [] }));
      if (existing.rows.length > 0) {
        if (!accepted.has(existing.rows[0].checksum)) throw new Error(`${migration.id} database checksum marker does not match`);
        console.log(existing.rows[0].checksum === marker ? `verified ${migration.id}` : `verified ${migration.id} using reviewed legacy marker`);
        continue;
      }
      await executeSqlStatements(client, sql);
      const applied = await client.query("SELECT checksum FROM platform.schema_migrations WHERE migration_id = $1", [migration.id]);
      if (applied.rows[0]?.checksum !== marker) throw new Error(`${migration.id} did not record the expected checksum marker`);
      console.log(`applied ${migration.id}`);
    }
  }
  if (process.env.LOAD_SYNTHETIC_SEED === "1") {
    await executeSqlStatements(client, await readFile(path.join(root, "database/foundation/seeds/dev.sql"), "utf8"));
    console.log("loaded synthetic development seed");
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [migrationLockName]).catch(() => undefined);
  await client.end();
}
