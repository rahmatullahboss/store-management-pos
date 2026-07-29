import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-a");
const socket = process.env.MOD_A_PG_SOCKET ?? "/tmp/store-pos-mod-a-socket";
const port = process.env.MOD_A_PG_PORT ?? "55439";
const database = process.env.MOD_A_PG_VALIDATION_DB ?? "mod_a_final_validation";

const migrations = [
  "database/foundation/migrations/FND-0001-platform.sql",
  "database/foundation/migrations/FND-0002-rls.sql",
  "database/foundation/migrations/FND-0003-reference-slice.sql",
  "database/foundation/migrations/FND-0004-identity-revocation.sql",
  "database/foundation/migrations/FND-0005-session-revocation-privilege-hardening.sql",
  "database/foundation/seeds/dev.sql",
  "database/migrations/catalog/CAT-0001-core.sql",
  "database/migrations/catalog/CAT-0002-search-performance.sql",
  "database/migrations/catalog/CAT-0003-pos-feed.sql",
  "database/migrations/pricing/PRC-0001-core.sql",
  "database/migrations/tax/TAX-0001-core.sql",
  "database/migrations/pricing/PRC-0002-price-tax-snapshot.sql",
  "database/migrations/pricing/PRC-0003-publishing.sql",
  "database/migrations/tax/TAX-0002-publishing.sql",
];

const expectedMigrationIds = [
  "FND-0001", "FND-0002", "FND-0003", "FND-0004", "FND-0005",
  "CAT-0001", "CAT-0002", "CAT-0003",
  "PRC-0001", "PRC-0002", "PRC-0003",
  "TAX-0001", "TAX-0002",
];

const requiredFunctions = [
  "catalog.save_product",
  "catalog.search_variant_feed",
  "catalog.catalog_snapshot_feed",
  "pricing.record_quote_snapshot",
  "pricing.record_price_tax_snapshot",
  "pricing.publish_price_list_version",
  "pricing.publish_promotion_version",
  "tax.record_calculation_snapshot",
  "tax.publish_configuration",
];

async function run(command, args, options = {}) {
  return await execFileAsync(command, args, {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
    ...options,
  });
}

async function psql(sql) {
  const { stdout } = await run("psql", ["-h", socket, "-p", port, "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  return stdout.trim();
}

function parseJson(value) {
  if (!value) throw new Error("Validation query returned empty JSON");
  return JSON.parse(value);
}

await run("dropdb", ["-h", socket, "-p", port, "--if-exists", database]);
await run("createdb", ["-h", socket, "-p", port, database]);

const applied = [];
try {
  for (const migration of migrations) {
    await run("psql", ["-h", socket, "-p", port, "-d", database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", migration]);
    applied.push(migration);
  }

  const inspection = parseJson(await psql(`
    SELECT json_build_object(
      'serverVersion', current_setting('server_version'),
      'migrationIds', (SELECT json_agg(migration_id ORDER BY migration_id) FROM platform.schema_migrations),
      'schemas', (SELECT json_agg(schema_name ORDER BY schema_name) FROM information_schema.schemata WHERE schema_name IN ('platform','catalog','pricing','tax')),
      'forcedRlsTables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('catalog','pricing','tax') AND c.relkind='r' AND c.relforcerowsecurity),
      'tenantPolicies', (SELECT count(*) FROM pg_policies WHERE schemaname IN ('catalog','pricing','tax') AND policyname='tenant_isolation'),
      'appendOnlyTriggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('catalog','pricing','tax') AND t.tgname='append_only' AND NOT t.tgisinternal),
      'permissions', (SELECT count(*) FROM platform.permissions WHERE module IN ('catalog','pricing','tax')),
      'functions', (SELECT json_agg(n.nspname || '.' || p.proname ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('catalog','pricing','tax'))
    )
  `));

  const migrationSet = new Set(inspection.migrationIds ?? []);
  const functionSet = new Set(inspection.functions ?? []);
  const checks = {
    allExpectedMigrations: expectedMigrationIds.every((id) => migrationSet.has(id)),
    noUnexpectedMissingSchema: ["platform", "catalog", "pricing", "tax"].every((schema) => (inspection.schemas ?? []).includes(schema)),
    requiredFunctions: requiredFunctions.every((name) => functionSet.has(name)),
    forcedRlsCoverage: Number(inspection.forcedRlsTables) >= 39,
    tenantPolicyCoverage: Number(inspection.tenantPolicies) >= 39,
    appendOnlyCoverage: Number(inspection.appendOnlyTriggers) >= 14,
    permissionCoverage: Number(inspection.permissions) >= 18,
  };

  const report = {
    schemaVersion: 1,
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    database,
    evidenceClass: "fresh-local-postgresql-rebuild",
    applied,
    expectedMigrationIds,
    requiredFunctions,
    inspection,
    checks,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "fresh-rebuild-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const checkRows = Object.entries(checks).map(([name, passed]) => `| ${name} | ${passed ? "Pass" : "Fail"} |`).join("\n");
  const markdown = `# MOD-A Fresh Local PostgreSQL Rebuild\n\n**Generated:** ${report.generatedAt}\n**Status:** ${report.status}\n**PostgreSQL:** ${inspection.serverVersion}\n\nA disposable empty database applied Foundation FND-0001..FND-0005, the synthetic Foundation seed and every MOD-A migration in dependency order. The database is removed after evidence capture.\n\n## Applied files\n\n${applied.map((file) => `- \`${file}\``).join("\n")}\n\n## Inspection\n\n- Schema migrations recorded: ${(inspection.migrationIds ?? []).length}\n- Forced-RLS MOD-A tables: ${inspection.forcedRlsTables}\n- Tenant-isolation policies: ${inspection.tenantPolicies}\n- Append-only triggers: ${inspection.appendOnlyTriggers}\n- Catalog/pricing/tax permissions: ${inspection.permissions}\n\n## Checks\n\n| Check | Result |\n|---|---|\n${checkRows}\n\nMachine-readable details are in [fresh-rebuild-report.json](fresh-rebuild-report.json).\n`;
  await writeFile(path.join(outputDir, "fresh-rebuild-report.md"), markdown);
  console.log(JSON.stringify({ status: report.status, checks, inspection }, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await run("dropdb", ["-h", socket, "-p", port, "--if-exists", database]).catch(() => undefined);
}
