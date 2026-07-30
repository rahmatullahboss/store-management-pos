import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sources = [
  {
    manifest: "database/foundation/manifest.json",
    directory: "database/foundation/migrations",
  },
  {
    manifest: "database/migrations/catalog/manifest.json",
    directory: "database/migrations/catalog",
  },
  {
    manifest: "database/migrations/pricing/manifest.json",
    directory: "database/migrations/pricing",
  },
  {
    manifest: "database/modules/inventory/manifest.json",
    directory: "database/modules/inventory/migrations",
  },
  {
    manifest: "database/modules/storefront/manifest.json",
    directory: "database/modules/storefront/migrations",
  },
];

async function psql(args) {
  const { stdout, stderr } = await execFileAsync(
    "psql",
    [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", ...args],
    {
      cwd: root,
      env: { ...process.env, PGAPPNAME: "storefront-postgres-rehearsal" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

for (const source of sources) {
  const manifest = JSON.parse(
    await readFile(path.join(root, source.manifest), "utf8"),
  );
  for (const migration of manifest.migrations) {
    const migrationPath = path.join(root, source.directory, migration.file);
    const sql = await readFile(migrationPath, "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    if (digest !== migration.sha256) {
      throw new Error(
        `${migration.id} checksum mismatch before PostgreSQL rehearsal`,
      );
    }
    await psql(["--file", migrationPath]);
    console.log(`rehearsal applied ${migration.id}`);
  }
}

for (const fixture of [
  "tests/integration/storefront-postgres-rehearsal.sql",
  "tests/integration/storefront-public-host-rehearsal.sql",
  "tests/integration/storefront-publishing-postgres-rehearsal.sql",
  "tests/integration/storefront-public-content-rehearsal.sql",
  "tests/integration/storefront-public-catalog-rehearsal.sql",
  "tests/integration/storefront-public-discovery-rehearsal.sql",
  "tests/integration/storefront-public-search-filter-rehearsal.sql",
  "tests/integration/storefront-public-seo-rehearsal.sql",
  "tests/integration/storefront-public-media-rehearsal.sql",
  "tests/integration/storefront-cache-family-rehearsal.sql",
]) {
  await psql(["--file", path.join(root, fixture)]);
}

const { stdout } = await execFileAsync(
  "psql",
  [
    databaseUrl,
    "--no-psqlrc",
    "--tuples-only",
    "--no-align",
    "--command",
    `SELECT jsonb_build_object(
      'migrations', (SELECT count(*) FROM platform.schema_migrations WHERE migration_id LIKE 'STF-%'),
      'tables', (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'storefront'),
      'forcedRlsTables', (
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'storefront' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
      ),
      'auditEvents', (SELECT count(*) FROM platform.audit_events WHERE event_type LIKE 'storefront.%'),
      'outboxEvents', (SELECT count(*) FROM platform.outbox_events WHERE event_type LIKE 'storefront.%'),
      'commandReceipts', (SELECT count(*) FROM storefront.command_receipts),
      'cacheGenerations', (SELECT count(*) FROM storefront.cache_generations),
      'cacheGenerationFamilies', (SELECT count(*) FROM storefront.cache_generation_families)
    )::text;`,
  ],
  { cwd: root, maxBuffer: 1024 * 1024 },
);
const summary = JSON.parse(stdout.trim());
if (summary.migrations !== 17) throw new Error("Storefront migration count is invalid");
if (summary.tables < 17) throw new Error("Storefront table count is incomplete");
if (summary.forcedRlsTables !== summary.tables) {
  throw new Error("Not every storefront table has forced RLS");
}
if (summary.auditEvents < 20 || summary.outboxEvents < 20) {
  throw new Error("Storefront audit/outbox evidence is incomplete");
}
if (
  summary.commandReceipts < 18 ||
  summary.cacheGenerations < 1 ||
  summary.cacheGenerationFamilies < 9
) {
  throw new Error("Storefront command or cache-family evidence is incomplete");
}
console.log(JSON.stringify(summary));
