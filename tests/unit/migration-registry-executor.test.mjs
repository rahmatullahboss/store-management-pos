import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyMigrationRegistry,
  prepareMigrationRegistry,
  verifyAppliedMigrationRegistry,
} from "../../tooling/scripts/apply-migration-registry.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function fixtureRoot({ checksumMismatch = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "migration-registry-"));
  const foundation = path.join(directory, "database", "foundation");
  await mkdir(path.join(foundation, "migrations"), { recursive: true });
  const sql = "SELECT 'fixture migration';\n";
  const digest = createHash("sha256").update(sql).digest("hex");
  await writeFile(path.join(foundation, "migrations", "FND-TEST.sql"), sql, "utf8");
  await writeFile(path.join(foundation, "seeds", "dev.sql"), "SELECT 'fixture seed';\n", "utf8").catch(async () => {
    await mkdir(path.join(foundation, "seeds"), { recursive: true });
    await writeFile(path.join(foundation, "seeds", "dev.sql"), "SELECT 'fixture seed';\n", "utf8");
  });
  await writeFile(
    path.join(foundation, "manifest.json"),
    `${JSON.stringify({
      module: "FOUNDATION",
      version: 1,
      order: 0,
      migrations: [{
        id: "FND-TEST",
        file: "FND-TEST.sql",
        sha256: checksumMismatch ? "0".repeat(64) : digest,
      }],
    }, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

test("current migration registry is deterministic, complete and bounded", async () => {
  const plan = await prepareMigrationRegistry(root);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.metadata));
  assert.deepEqual(plan.metadata, {
    schemaVersion: 1,
    manifestCount: 17,
    migrationCount: 67,
    moduleIds: [
      "FOUNDATION",
      "MOD-A-CATALOG",
      "MOD-A-PRICING",
      "MOD-A-TAX",
      "MOD-B-INVENTORY",
      "MOD-B-PROCUREMENT",
      "MOD-C-CUSTOMER",
      "MOD-C-SALES",
      "MOD-C-FULFILLMENT",
      "MOD-E-PAYMENT",
      "MOD-E-ACCOUNTING",
      "MOD-E-BANKING",
      "MOD-D-POS",
      "MOD-D-CASH",
      "MOD-F-LOCALIZATION",
      "MOD-G-REPORTING",
      "MOD-G-INTEGRATION",
    ],
    migrationIds: plan.metadata.migrationIds,
  });
  assert.equal(plan.metadata.migrationIds.length, 67);
  assert.equal(new Set(plan.metadata.migrationIds).size, 67);
  assert.equal(plan.metadata.migrationIds[0], "FND-0001");
  assert.equal(plan.metadata.migrationIds.at(-1), "INT-0007");
  assert.deepEqual(Object.keys(plan).sort(), ["apply", "metadata"]);
  assert.doesNotMatch(JSON.stringify(plan), /CREATE TABLE|connectionString|postgresql:\/\//iu);
});

test("all checksums are verified before the first database query", async () => {
  const badRoot = await fixtureRoot({ checksumMismatch: true });
  let queryCount = 0;
  await assert.rejects(
    applyMigrationRegistry({ query: async () => { queryCount += 1; } }, badRoot),
    /FND-TEST checksum does not match the manifest/u,
  );
  assert.equal(queryCount, 0);
});

test("registry applies migrations sequentially, then seed, then verifies exact markers", async () => {
  const fixture = await fixtureRoot();
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT migration_id/u.test(sql)) return { rows: [{ migration_id: "FND-TEST" }] };
      return { rows: [] };
    },
  };
  const metadata = await applyMigrationRegistry(client, fixture);
  assert.equal(metadata.manifestCount, 1);
  assert.equal(metadata.migrationCount, 1);
  assert.deepEqual(metadata.moduleIds, ["FOUNDATION"]);
  assert.deepEqual(metadata.migrationIds, ["FND-TEST"]);
  assert.match(calls[0].sql, /fixture migration/u);
  assert.match(calls[1].sql, /fixture seed/u);
  assert.match(calls[2].sql, /SELECT migration_id/u);
  assert.deepEqual(calls[2].params, [["FND-TEST"]]);
});

test("migration failure stops before seed and marker verification", async () => {
  const fixture = await fixtureRoot();
  const calls = [];
  await assert.rejects(
    applyMigrationRegistry({
      async query(sql) {
        calls.push(sql);
        throw new Error("migration failed");
      },
    }, fixture),
    /migration failed/u,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /fixture migration/u);
});

test("marker verification requires exact registry equality", async () => {
  const expected = ["FND-0001", "FND-0002"];
  await assert.doesNotReject(
    verifyAppliedMigrationRegistry({
      query: async () => ({ rows: expected.map((migration_id) => ({ migration_id })) }),
    }, expected),
  );
  for (const actual of [
    ["FND-0001"],
    ["FND-0001", "FND-0002", "UNKNOWN-0001"],
    ["FND-0002", "FND-0001"],
  ]) {
    await assert.rejects(
      verifyAppliedMigrationRegistry({
        query: async () => ({ rows: actual.map((migration_id) => ({ migration_id })) }),
      }, expected),
      /Applied migration registry does not match the verified plan/u,
    );
  }
});

test("marker verification rejects malformed database evidence", async () => {
  await assert.rejects(
    verifyAppliedMigrationRegistry({ query: async () => ({ rows: [{ migration_id: 42 }] }) }, ["FND-0001"]),
    /migration_id at row 1 must be a non-empty string/u,
  );
  await assert.rejects(
    verifyAppliedMigrationRegistry({ query: async () => ({ rows: null }) }, ["FND-0001"]),
    /did not return rows/u,
  );
});
