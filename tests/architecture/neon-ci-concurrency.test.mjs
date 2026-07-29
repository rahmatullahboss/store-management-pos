import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../.github/workflows/foundation-ci.yml", import.meta.url);
const previewScriptUrl = new URL("../../tooling/scripts/neon-preview-ci.mjs", import.meta.url);
const modDRehearsalUrl = new URL("../../tooling/scripts/mod-d-neon-rehearsal-ci.mjs", import.meta.url);

test("Neon branch lifecycle and persistent MOD-D rehearsal jobs are serialized", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /neon-preview:\n[\s\S]*?group: neon-preview-lifecycle-\$\{\{ github\.repository \}\}/u);
  assert.match(workflow, /neon-recovery:\n[\s\S]*?group: neon-preview-lifecycle-\$\{\{ github\.repository \}\}/u);
  assert.match(workflow, /mod-d-neon-rehearsal:\n[\s\S]*?group: mod-d-neon-rehearsal-\$\{\{ github\.repository \}\}/u);
  assert.ok((workflow.match(/cancel-in-progress: false/gu) ?? []).length >= 3);
});

test("Neon preview cleanup isolates normal runs and reclaims only aged preview branches at quota", async () => {
  const source = await readFile(previewScriptUrl, "utf8");
  assert.match(source, /const previewBranchRootPrefix = "preview\/pr-"/u);
  assert.match(source, /const previewBranchPrefix = `\$\{previewBranchRootPrefix\}\$\{safeRef\}-`/u);
  assert.match(source, /const globalStaleAgeMs = 45 \* 60 \* 1000/u);
  assert.match(
    source,
    /branch\.name\.startsWith\(allPreviewBranches \? previewBranchRootPrefix : previewBranchPrefix\)/u,
  );
  assert.match(source, /now - timestamp >= globalStaleAgeMs/u);
  assert.match(source, /branch\.id === NEON_PARENT_BRANCH_ID/u);
  assert.match(source, /branch\.id === NEON_FALLBACK_BRANCH_ID/u);
  assert.match(source, /branch\.name === branchName/u);
  assert.match(source, /error\.payload\?\.code === "BRANCHES_LIMIT_EXCEEDED"/u);
  assert.match(source, /cleaning only preview\/pr-\* branches older than 45 minutes and retrying once/u);
  assert.match(source, /branchLimitCleanupDeleted/u);
  assert.doesNotMatch(source, /DELETE.*dev\/module/isu);
});

test("Neon preview uses a disposable database when the branch quota remains full", async () => {
  const [workflow, source] = await Promise.all([
    readFile(workflowUrl, "utf8"),
    readFile(previewScriptUrl, "utf8"),
  ]);

  assert.match(workflow, /NEON_FALLBACK_BRANCH_ID: br-autumn-pine-axuo502u/u);
  assert.match(workflow, /NEON_FALLBACK_ENDPOINT_ID: ep-blue-moon-axw07qmr/u);
  assert.match(workflow, /NEON_FALLBACK_ROLE_NAME: neondb_owner/u);
  assert.match(source, /const databaseName = `ci_preview_/u);
  assert.match(source, /async function createFallbackDatabase\(\)/u);
  assert.match(source, /\/databases`, \{/u);
  assert.match(source, /owner_name: NEON_FALLBACK_ROLE_NAME/u);
  assert.match(source, /isolationMode: "database"/u);
  assert.match(source, /shared fallback compute must not be suspended by preview CI/u);
  assert.match(
    source,
    /\/databases\/\$\{encodeURIComponent\(activeDatabaseName\)\}`, \{ method: "DELETE" \}/u,
  );
  assert.match(source, /databaseCleanupDeleted = true/u);
  assert.match(source, /schemaVersion: 2/u);
});

test("persistent MOD-D rehearsal holds a database advisory lock across migration and verification", async () => {
  const source = await readFile(modDRehearsalUrl, "utf8");
  const lockIndex = source.indexOf("pg_advisory_lock");
  const migrationIndex = source.indexOf('run("node", ["tooling/scripts/apply-migrations.mjs"]');
  const verificationIndex = source.indexOf("SELECT migration_id FROM platform.schema_migrations");
  const unlockIndex = source.indexOf("pg_advisory_unlock");

  assert.ok(lockIndex >= 0, "advisory lock must be acquired");
  assert.ok(migrationIndex > lockIndex, "migrations must run after advisory lock acquisition");
  assert.ok(verificationIndex > migrationIndex, "verification must run after migrations");
  assert.ok(unlockIndex > verificationIndex, "advisory lock must be released after verification");
  assert.match(source, /advisoryLockAcquired: false/u);
  assert.match(source, /report\.advisoryLockAcquired = true/u);
});
