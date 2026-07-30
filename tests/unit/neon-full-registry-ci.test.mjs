import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("generic Neon preview and recovery consume the shared full migration registry", async () => {
  const [preview, recovery] = await Promise.all([
    source("tooling/scripts/neon-preview-ci.mjs"),
    source("tooling/scripts/neon-recovery-ci.mjs"),
  ]);
  for (const [name, content] of [["preview", preview], ["recovery", recovery]]) {
    assert.match(content, /applyMigrationRegistry/u, `${name} must apply the shared registry`);
    assert.match(content, /manifestCount/u, `${name} must report manifest count`);
    assert.match(content, /migrationCount/u, `${name} must report migration count`);
    assert.match(content, /moduleIds/u, `${name} must report module IDs`);
    assert.match(content, /migrationIds/u, `${name} must report migration IDs`);
    assert.doesNotMatch(content, /database\/foundation\/manifest\.json/u, `${name} must not load Foundation only`);
    assert.doesNotMatch(content, /for \(const migration of manifest\.migrations\)/u, `${name} must not own a direct manifest loop`);
  }
});

test("Neon recovery report records bounded full-registry and RTO evidence", async () => {
  const recovery = await source("tooling/scripts/neon-recovery-ci.mjs");
  assert.match(recovery, /schemaVersion:\s*2/u);
  for (const marker of [
    "checkpointTimestamp",
    "mutationObservedAt",
    "restoreRequestedAt",
    "branchesReadyAt",
    "reconciliationCompletedAt",
    "restoreReadyMs",
    "reconciliationMs",
    "totalRecoveryMs",
    "exactCheckpointRestore",
    "markerReconciled",
    "cleanupDeleted",
  ]) assert.ok(recovery.includes(marker), `missing recovery evidence marker ${marker}`);
  assert.match(recovery, /beforeMutation\.reference_count === 1/u);
  assert.match(recovery, /restoredState\.audit_count === 1/u);
  assert.match(recovery, /restoredState\.outbox_count === 1/u);
  assert.match(recovery, /restoredState\.idempotency_count === 1/u);
  assert.match(recovery, /JSON\.stringify\(restoredState\.migration_ids\) === JSON\.stringify\(migrationRegistry\.migrationIds\)/u);
  assert.doesNotMatch(recovery, /connectionString:\s/u);
  assert.doesNotMatch(recovery, /NEON_API_KEY\s*:/u);
  assert.doesNotMatch(recovery, /apiKey\s*:/iu);
});

test("Foundation CI publishes a bounded recovery summary without disposable identifiers", async () => {
  const workflow = await source(".github/workflows/foundation-ci.yml");
  assert.match(workflow, /Summarize Neon recovery evidence/u);
  for (const marker of [
    "Recovery status:",
    "Migration manifests:",
    "Registered migrations:",
    "Modules:",
    "Exact checkpoint restore:",
    "Marker reconciled:",
    "Restore ready ms:",
    "Reconciliation ms:",
    "Total recovery ms:",
    "Cleanup deleted:",
  ]) assert.ok(workflow.includes(marker), `missing workflow summary marker ${marker}`);
  assert.doesNotMatch(workflow, /report\.projectId/u);
  assert.doesNotMatch(workflow, /report\.originalBranchId/u);
  assert.doesNotMatch(workflow, /report\.restoredBranchId/u);
  assert.doesNotMatch(workflow, /report\.backupBranchId/u);
  assert.doesNotMatch(workflow, /report\.markerId/u);
  assert.doesNotMatch(workflow, /report\.failure/u);
});
