import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildCustomAuthStagingDeploy } from "../../tooling/scripts/staging-custom-auth-patch.mjs";
import { generateStagingTokenKeyset } from "../../tooling/scripts/staging-token-keyset.mjs";

const execute = promisify(execFile);
const root = new URL("../../", import.meta.url);

async function source(pathname) {
  return await readFile(new URL(pathname, root), "utf8");
}

test("custom-auth deployment patches the real source into an asymmetric evidence runner", async () => {
  const original = await source("tooling/scripts/deploy-custom-auth-staging.mjs");
  const patched = buildCustomAuthStagingDeploy(original);
  for (const marker of [
    'main: "apps/api/src/staging-entry.ts"',
    "STAGING_INTERNAL_TOKEN_KEYSET_EVIDENCE",
    "[REDACTED_INTERNAL_TOKEN_KEYSET]",
    '"/internal-identity/.well-known/jwks.json"',
    '"internalTokenSigning":"RS256"',
    "internalToken: internalTokenKeysetEvidence",
    "schemaVersion: 6",
  ]) assert.ok(patched.includes(marker), `missing asymmetric deployment marker ${marker}`);
  assert.doesNotMatch(patched, /randomBytes\(48\).*STAGING_INTERNAL_TOKEN_SECRET/su);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "staging-asymmetric-patch-"));
  const candidate = path.join(temporary, "deploy.mjs");
  try {
    await writeFile(candidate, patched, "utf8");
    await execute(process.execPath, ["--check", candidate]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("deployment generator produces only bounded aggregate evidence", async () => {
  const generated = await generateStagingTokenKeyset({ now: 1_800_000_000 });
  assert.equal(generated.evidence.algorithm, "RS256");
  assert.equal(generated.evidence.activeSigningKeyCount, 1);
  assert.equal(generated.evidence.activeVerificationKeyCount, 1);
  assert.equal(generated.evidence.previousVerificationKeyCount, 1);
  assert.equal(generated.evidence.publishedKeyCount, 2);
  assert.equal(generated.evidence.privateFieldsPublished, 0);
  assert.equal(generated.evidence.privateKeyPersistedInArtifacts, false);
  assert.equal(generated.evidence.keysetPersistedInArtifacts, false);
  assert.doesNotMatch(JSON.stringify(generated.evidence), /privateJwk|"d"|activeKid|previousKid/u);
});

test("entry, workflow and lifecycle docs expose bounded JWKS evidence and retain production blockers", async () => {
  const [entry, workflow, status, lifecycle] = await Promise.all([
    source("apps/api/src/staging-entry.ts"),
    source(".github/workflows/persistent-admin-pos-staging.yml"),
    source("docs/architecture/staging/status.yaml"),
    source("docs/architecture/staging/asymmetric-internal-token-key-lifecycle.md"),
  ]);
  assert.match(entry, /STAGING_INTERNAL_JWKS_PATH/u);
  assert.match(entry, /internalTokenSigning: "RS256"/u);
  assert.match(entry, /internalTokenPrivateKeyPublished: false/u);
  assert.match(workflow, /Internal token algorithm:/u);
  assert.match(workflow, /Internal token active\/previous verification keys:/u);
  assert.match(workflow, /Internal token private fields published:/u);
  assert.match(status, /signing_algorithm: RS256/u);
  assert.match(status, /live_evidence_state: implementation_complete_pending_exact_head/u);
  assert.match(status, /private_key_published: false/u);
  assert.match(lifecycle, /KMS\/HSM-backed non-exportable private keys/u);
  assert.match(lifecycle, /Artifacts and workflow summaries may contain only algorithm/u);
});
