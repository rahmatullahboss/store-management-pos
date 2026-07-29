import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modules = [
  {
    identity: "MOD-D-POS",
    manifestPath: new URL("../../database/modules/pos/manifest.json", import.meta.url),
    migrationsDirectory: new URL("../../database/modules/pos/migrations/", import.meta.url),
    expectedIds: ["POS-0001"],
  },
  {
    identity: "MOD-D-CASH",
    manifestPath: new URL("../../database/modules/cash/manifest.json", import.meta.url),
    migrationsDirectory: new URL("../../database/modules/cash/migrations/", import.meta.url),
    expectedIds: ["CSH-0001"],
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

test("MOD-D migrations have deterministic identities and verified checksums", async () => {
  const loaded = await Promise.all(modules.map(loadModule));
  const allIds = loaded.flatMap(({ migrations }) => migrations.map(({ id }) => id));
  assert.equal(new Set(allIds).size, allIds.length, "migration IDs must be globally unique within MOD-D");

  for (const [index, result] of loaded.entries()) {
    const source = modules[index];
    assert.ok(source);
    assert.equal(result.manifest.module, source.identity);
    assert.deepEqual(result.migrations.map(({ id }) => id), source.expectedIds);
    for (const migration of result.migrations) {
      assert.equal(migration.digest, migration.sha256, `${migration.id} checksum must match its manifest`);
      assert.match(migration.sql, /^BEGIN;/u);
      assert.match(migration.sql, /COMMIT;\s*$/u);
      assert.match(migration.sql, new RegExp(`VALUES \\('${migration.id}'`, "u"));
    }
  }
});

test("MOD-D tables use forced tenant RLS and runtime roles remain command-only", async () => {
  for (const source of modules) {
    const { migrations } = await loadModule(source);
    const sql = migrations.map((migration) => migration.sql).join("\n");
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/u);
    assert.match(sql, /platform\.current_tenant_id\(\)/u);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON ALL TABLES/u);
    assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE) ON/u);
  }
});

test("POS migration preserves checkout, receipt, sync and device evidence", async () => {
  const { migrations } = await loadModule(modules[0]);
  const sql = migrations.map((migration) => migration.sql).join("\n");
  assert.match(sql, /UNIQUE \(tenant_id, device_id, operation_id\)/u);
  assert.match(sql, /checkout operation identity and financial snapshot are immutable/u);
  assert.match(sql, /receipt_snapshots_append_only/u);
  assert.match(sql, /sync_outcomes_append_only/u);
  assert.match(sql, /device_health_events_append_only/u);
  assert.match(sql, /payment_state <> 'unknown'/u);
  assert.doesNotMatch(sql, /REFERENCES (?:catalog|pricing|tax|inventory|customer|sales|payment|accounting|banking)\./u);
});

test("cash migration reconstructs expected cash from immutable signed effects", async () => {
  const { migrations } = await loadModule(modules[1]);
  const sql = migrations.map((migration) => migration.sql).join("\n");
  assert.match(sql, /cash_event_effect/u);
  assert.match(sql, /cash_events_append_only/u);
  assert.match(sql, /cash_counts_append_only/u);
  assert.match(sql, /shift_closures_append_only/u);
  assert.match(sql, /variance_minor = counted_minor - expected_minor/u);
  assert.match(sql, /variance_minor = 0 OR approval_request_id IS NOT NULL/u);
  assert.match(sql, /REFERENCES pos\.register_sessions/u);
  assert.doesNotMatch(sql, /REFERENCES (?:sales|payment|accounting|banking)\./u);
});
