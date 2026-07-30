import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverMigrationManifests } from "../../tooling/scripts/migration-manifests.mjs";

const modules = [
  {
    identity: "MOD-G-REPORTING",
    manifestPath: new URL("../../database/modules/reporting/manifest.json", import.meta.url),
    migrationsDirectory: new URL("../../database/modules/reporting/migrations/", import.meta.url),
    expectedIds: ["RPT-0001", "RPT-0002"],
  },
  {
    identity: "MOD-G-INTEGRATION",
    manifestPath: new URL("../../database/modules/integrations/manifest.json", import.meta.url),
    migrationsDirectory: new URL("../../database/modules/integrations/migrations/", import.meta.url),
    expectedIds: ["INT-0001", "INT-0002", "INT-0003", "INT-0004", "INT-0005", "INT-0006", "INT-0007"],
  },
];

async function loadModule(source) {
  const manifest = JSON.parse(await readFile(source.manifestPath, "utf8"));
  const migrations = [];
  for (const migration of manifest.migrations) {
    const sql = await readFile(new URL(migration.file, source.migrationsDirectory), "utf8");
    migrations.push({ ...migration, sql, digest: createHash("sha256").update(sql).digest("hex") });
  }
  return { manifest, migrations };
}

test("MOD-G manifests are deterministic, complete and ordered after MOD-F", async () => {
  const loaded = await Promise.all(modules.map(loadModule));
  const allIds = loaded.flatMap(({ migrations }) => migrations.map(({ id }) => id));
  assert.equal(new Set(allIds).size, allIds.length);
  for (const [index, result] of loaded.entries()) {
    const source = modules[index];
    assert.ok(source);
    assert.equal(result.manifest.module, source.identity);
    assert.deepEqual(result.migrations.map(({ id }) => id), source.expectedIds);
    const declared = result.manifest.migrations.map(({ file }) => file).sort();
    const present = (await readdir(source.migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    assert.deepEqual(present, declared, `${source.identity} contains orphan or missing migrations`);
    for (const migration of result.migrations) {
      assert.equal(migration.digest, migration.sha256, `${migration.id} checksum must match manifest`);
      assert.match(migration.sql, /^BEGIN;/u);
      assert.match(migration.sql, /COMMIT;\s*$/u);
      assert.match(migration.sql, new RegExp(`VALUES \\('${migration.id}'`, "u"));
    }
  }
  const registry = await discoverMigrationManifests(fileURLToPath(new URL("../..", import.meta.url)));
  const identities = registry.map(({ module }) => module);
  assert.ok(identities.indexOf("MOD-F-LOCALIZATION") < identities.indexOf("MOD-G-REPORTING"));
  assert.ok(identities.indexOf("MOD-G-REPORTING") < identities.indexOf("MOD-G-INTEGRATION"));
});

test("MOD-G tables use forced tenant RLS and runtime roles are command-only", async () => {
  for (const source of modules) {
    const { migrations } = await loadModule(source);
    const sql = migrations.map((migration) => migration.sql).join("\n");
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/u);
    assert.match(sql, /platform\.current_tenant_id\(\)/u);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON ALL TABLES/u);
    assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE) ON/u);
    assert.match(sql, /SECURITY DEFINER/u);
    assert.match(sql, /REVOKE ALL ON FUNCTION/u);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION/u);
  }
});

test("reporting migration preserves exact, rebuildable and auditable projection evidence", async () => {
  const { migrations } = await loadModule(modules[0]);
  const sql = migrations.map((migration) => migration.sql).join("\n");
  for (const table of [
    "metric_definitions", "projection_cursors", "projection_event_receipts", "metric_snapshots",
    "projection_reconciliations", "export_requests", "export_events",
  ]) assert.match(sql, new RegExp(`reporting\\.${table}`, "u"));
  assert.match(sql, /numeric\(78,0\)/u);
  assert.match(sql, /UNIQUE \(tenant_id, projection_name, source_event_id\)/u);
  assert.match(sql, /difference_amount = projected_amount - control_amount/u);
  assert.match(sql, /projection_event_receipts_append_only/u);
  assert.match(sql, /metric_snapshots_append_only/u);
  assert.match(sql, /projection_reconciliations_append_only/u);
  assert.match(sql, /export_events_append_only/u);
  for (const command of [
    "publish_metric_definition",
    "consume_projection_event",
    "record_metric_snapshot",
    "request_export",
    "transition_export",
  ]) assert.match(sql, new RegExp(`reporting\\.${command}`, "u"));
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /projection event replay payload differs/u);
  assert.match(sql, /metric snapshot replay payload differs/u);
  assert.match(sql, /export transition replay payload differs/u);
  assert.match(sql, /INSERT INTO platform\.audit_events/u);
  assert.match(sql, /INSERT INTO platform\.outbox_events/u);
  assert.doesNotMatch(sql, /CURRENT_DATE/u);
});

test("integration migration preserves credential, public directory, webhook replay and connector ownership evidence", async () => {
  const { migrations } = await loadModule(modules[1]);
  const sql = migrations.map((migration) => migration.sql).join("\n");
  for (const table of [
    "api_clients", "api_client_security_events", "webhook_subscriptions", "webhook_deliveries", "webhook_delivery_attempts",
    "webhook_replay_requests", "connector_connections", "connector_field_mappings",
    "connector_cursors", "connector_sync_outcomes",
  ]) assert.match(sql, new RegExp(`integration\\.${table}`, "u"));
  assert.match(sql, /UNIQUE \(tenant_id, subscription_id, source_event_id\)/u);
  assert.match(sql, /UNIQUE \(tenant_id, connection_id, operation_id\)/u);
  assert.match(sql, /ownership <> 'platform' OR direction = 'outbound'/u);
  assert.match(sql, /ownership <> 'external' OR direction = 'inbound'/u);
  assert.match(sql, /api_client_security_events_append_only/u);
  assert.match(sql, /webhook_delivery_attempts_append_only/u);
  assert.match(sql, /webhook_replay_requests_append_only/u);
  assert.match(sql, /connector_sync_outcomes_append_only/u);
  assert.match(sql, /credential_reference/u);
  assert.match(sql, /credential_reference ~ '\^\(secret\|vault\|kms\|provider\):\/\//u);
  assert.match(sql, /service_user_id uuid/u);
  assert.match(sql, /resolve_api_client_authentication/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION integration\.resolve_api_client_authentication/u);
  assert.doesNotMatch(sql, /credential_(?:secret|value)|api_key_value|access_token_value/u);
  for (const command of [
    "register_api_client",
    "rotate_api_client_credential",
    "change_api_client_status",
    "create_webhook_subscription",
    "enqueue_webhook_delivery",
    "record_webhook_attempt",
    "request_webhook_replay",
    "register_connector_connection",
    "add_connector_mapping",
    "record_connector_sync_outcome",
  ]) assert.match(sql, new RegExp(`integration\\.${command}`, "u"));
  assert.match(sql, /revoked API client status is terminal/u);
  assert.match(sql, /API client credential version conflict/u);
  assert.match(sql, /only dead-letter webhook deliveries can be replayed/u);
  assert.match(sql, /webhook attempt replay payload differs/u);
  assert.match(sql, /connector sync replay payload differs/u);
  assert.match(sql, /INSERT INTO platform\.audit_events/u);
  assert.match(sql, /INSERT INTO platform\.outbox_events/u);
  assert.doesNotMatch(sql, /signing_key_reference[^\n]*metadata|credential_reference[^\n]*metadata/u);
});

test("SaaS platform migrations preserve immutable plans, exact usage, lifecycle safety and approved support controls", async () => {
  const { migrations } = await loadModule(modules[1]);
  const sql = migrations.map((migration) => migration.sql).join("\n");
  for (const table of [
    "saas_plan_definitions", "saas_plan_entitlements", "tenant_subscriptions",
    "tenant_subscription_events", "usage_events", "usage_counters",
    "tenant_lifecycle_jobs", "tenant_lifecycle_job_events",
    "support_impersonation_grants", "support_impersonation_events",
    "feature_rollouts", "feature_rollout_events", "support_incidents",
    "support_incident_events",
  ]) assert.match(sql, new RegExp(`platform\\.${table}`, "u"));
  assert.match(sql, /quantity numeric\(78,0\)/u);
  assert.match(sql, /usage_events_append_only/u);
  assert.match(sql, /tenant_subscription_events_append_only/u);
  assert.match(sql, /tenant_lifecycle_job_events_append_only/u);
  assert.match(sql, /support_impersonation_events_append_only/u);
  assert.match(sql, /feature_rollout_events_append_only/u);
  assert.match(sql, /support_incident_events_append_only/u);
  assert.match(sql, /support_actor_id <> approved_by/u);
  assert.match(sql, /no longer than eight hours/u);
  assert.match(sql, /cancelled tenant subscription is terminal/u);
  assert.match(sql, /tenant subscription version conflict/u);
  assert.match(sql, /tenant lifecycle job version conflict/u);
  assert.match(sql, /SET status = v_tenant_status, updated_at = p_observed_at, version = version \+ 1/u);
  assert.doesNotMatch(sql, /DELETE FROM platform\.(?:tenants|tenant_subscriptions|usage_events)/u);
  for (const command of [
    "publish_saas_plan", "assign_tenant_subscription", "transition_tenant_subscription",
    "record_usage_event", "request_tenant_lifecycle_job", "transition_tenant_lifecycle_job",
    "issue_support_impersonation_grant", "record_support_impersonation_use",
    "revoke_support_impersonation_grant", "set_feature_rollout",
    "open_support_incident", "transition_support_incident",
  ]) {
    assert.match(sql, new RegExp(`platform\\.${command}`, "u"));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION platform\\.${command}`, "u"));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION platform\\.${command}`, "u"));
  }
  assert.match(sql, /INSERT INTO platform\.audit_events/u);
  assert.match(sql, /INSERT INTO platform\.outbox_events/u);
  assert.doesNotMatch(sql, /CURRENT_DATE/u);
});
