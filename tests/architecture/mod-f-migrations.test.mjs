import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverMigrationManifests } from "../../tooling/scripts/migration-manifests.mjs";

const manifestUrl = new URL("../../database/modules/localization/manifest.json", import.meta.url);
const migrationsUrl = new URL("../../database/modules/localization/migrations/", import.meta.url);

async function load() {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const migrations = [];
  for (const entry of manifest.migrations) {
    const sql = await readFile(new URL(entry.file, migrationsUrl), "utf8");
    migrations.push({ ...entry, sql, digest: createHash("sha256").update(sql).digest("hex") });
  }
  return { manifest, migrations };
}

test("MOD-F migration manifest is deterministic and ordered after integrated MOD-D", async () => {
  const { manifest, migrations } = await load();
  assert.equal(manifest.module, "MOD-F-LOCALIZATION");
  assert.equal(manifest.order, 50);
  assert.deepEqual(migrations.map(({ id }) => id), ["LOC-0001", "LOC-0002", "LOC-0003", "LOC-0004", "LOC-0005"]);
  const present = (await readdir(migrationsUrl)).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(present, migrations.map(({ file }) => file).sort());
  for (const migration of migrations) {
    assert.equal(migration.digest, migration.sha256, `${migration.id} checksum must match its manifest`);
    assert.match(migration.sql, /^BEGIN;/u);
    assert.match(migration.sql, /COMMIT;\s*$/u);
    assert.match(migration.sql, new RegExp(`VALUES \\('${migration.id}'`, "u"));
  }

  const registry = await discoverMigrationManifests(fileURLToPath(new URL("../..", import.meta.url)));
  const modules = registry.map(({ module }) => module);
  assert.ok(modules.indexOf("MOD-D-CASH") < modules.indexOf("MOD-F-LOCALIZATION"));
});

test("MOD-F core schema preserves tenant isolation and immutable legal evidence", async () => {
  const { migrations } = await load();
  const sql = migrations.map(({ sql: migrationSql }) => migrationSql).join("\n");
  for (const table of [
    "country_pack_versions", "locale_profiles", "currency_metadata", "business_day_boundaries",
    "country_pack_activations", "legal_number_scopes", "legal_number_allocations",
    "legal_documents", "fiscal_submissions", "fiscal_submission_events",
    "retention_policies", "privacy_operations",
  ]) assert.match(sql, new RegExp(`localization\\.${table}`, "u"));

  assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/u);
  assert.match(sql, /platform\.current_tenant_id\(\)/u);
  assert.match(sql, /legal_documents_append_only/u);
  assert.match(sql, /legal_number_allocations_append_only/u);
  assert.match(sql, /fiscal_submission_events_append_only/u);
  assert.match(sql, /UNIQUE \(tenant_id, scope_id, operation_id\)/u);
  assert.match(sql, /UNIQUE \(tenant_id, legal_number\)/u);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON ALL TABLES/u);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE) ON/u);
});

test("MOD-F command functions are tenant-scoped, idempotent and runtime-callable only", async () => {
  const { migrations } = await load();
  const sql = migrations.slice(1).map(({ sql: migrationSql }) => migrationSql).join("\n");
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, localization, platform/u);
  assert.match(sql, /activate_country_pack/u);
  assert.match(sql, /allocate_legal_number/u);
  assert.match(sql, /record_fiscal_transition/u);
  assert.match(sql, /publish_legal_document/u);
  assert.match(sql, /create_fiscal_submission/u);
  assert.match(sql, /create_privacy_operation/u);
  assert.match(sql, /transition_privacy_operation/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /p_business_date/u);
  assert.match(sql, /idempotency conflict/u);
  assert.match(sql, /replay payload differs/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION/u);
  assert.doesNotMatch(sql, /CURRENT_DATE/u);
});

test("MOD-F publishes safe transactional audit and outbox evidence", async () => {
  const { migrations } = await load();
  const migration = migrations.find(({ id }) => id === "LOC-0005");
  assert.ok(migration);
  assert.match(migration.sql, /localization\.publish_command_evidence/u);
  assert.match(migration.sql, /INSERT INTO platform\.audit_events/u);
  assert.match(migration.sql, /INSERT INTO platform\.outbox_events/u);
  assert.match(migration.sql, /localization\.country_pack\.activated\.v1/u);
  assert.match(migration.sql, /localization\.legal_number\.allocated\.v1/u);
  assert.match(migration.sql, /localization\.legal_document\.published\.v1/u);
  assert.match(migration.sql, /localization\.fiscal_submission\.status_observed\.v1/u);
  assert.match(migration.sql, /localization\.privacy_operation\.status_changed\.v1/u);
  assert.match(migration.sql, /REVOKE ALL ON FUNCTION localization\.publish_command_evidence\(\) FROM PUBLIC/u);
  assert.doesNotMatch(migration.sql, /subject_reference|reason_message|semantic_payload_hash|archive_object_key/u);
});

test("MOD-F provisions read permissions separately from privileged commands", async () => {
  const { migrations } = await load();
  const sql = migrations.map(({ sql: migrationSql }) => migrationSql).join("\n");
  for (const permission of [
    "localization.pack.read",
    "localization.document.read",
    "localization.fiscal.read",
    "localization.privacy.read",
  ]) assert.match(sql, new RegExp(permission.replaceAll(".", "\\."), "u"));
  assert.match(sql, /localization\.document\.publish/u);
  assert.match(sql, /localization\.fiscal\.submit/u);
  assert.match(sql, /localization\.privacy\.execute/u);
});
