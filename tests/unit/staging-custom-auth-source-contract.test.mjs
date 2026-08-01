import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCustomAuthStagingDeploy } from "../../tooling/scripts/staging-custom-auth-patch.mjs";
import {
  finalizeCustomAuthRelationEvidenceSource,
  normalizeCustomAuthRelationEvidenceSource,
} from "../../tooling/scripts/staging-custom-auth-source-contract.mjs";

const canonicalLegacyRelations =
  "'custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits','custom_auth_events'";
const canonicalLiveRelations =
  "'auth_credentials','auth_sessions','auth_rate_limits','auth_events'";
const deployPath = fileURLToPath(
  new URL("../../tooling/scripts/deploy-custom-auth-staging.mjs", import.meta.url),
);
const deploySource = await readFile(deployPath, "utf8");

test("custom auth relation evidence tolerates formatting but normalizes exact order", () => {
  const source = `
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_name IN (
      'custom_auth_credentials',
      'custom_auth_sessions',
      'custom_auth_rate_limits',
      'custom_auth_events'
    )
  `;

  const normalized = normalizeCustomAuthRelationEvidenceSource(source);
  const finalized = finalizeCustomAuthRelationEvidenceSource(normalized);
  assert.equal(finalized.split(canonicalLegacyRelations).length - 1, 1);
});

test("operational live relation evidence survives asymmetric patch composition", () => {
  const liveSource = deploySource.replace(
    canonicalLegacyRelations,
    canonicalLiveRelations,
  );
  assert.notEqual(liveSource, deploySource);

  const normalized = normalizeCustomAuthRelationEvidenceSource(liveSource);
  const patched = buildCustomAuthStagingDeploy(normalized);
  const finalized = finalizeCustomAuthRelationEvidenceSource(patched);

  assert.equal(finalized.split(canonicalLiveRelations).length - 1, 1);
  assert.equal(finalized.split(canonicalLegacyRelations).length - 1, 0);
  assert.doesNotMatch(finalized, /asymmetric-patch-relation-contract/u);
  assert.match(finalized, /STAGING_INTERNAL_TOKEN_KEYSET_EVIDENCE/u);
});

test("custom auth relation evidence rejects incomplete or ambiguous contracts", () => {
  for (const source of [
    "'custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits'",
    "'custom_auth_sessions','custom_auth_credentials','custom_auth_rate_limits','custom_auth_events'",
    `${canonicalLegacyRelations}\n${canonicalLegacyRelations}`,
    `${canonicalLegacyRelations}\n${canonicalLiveRelations}`,
  ]) {
    assert.throws(
      () => normalizeCustomAuthRelationEvidenceSource(source),
      /must contain exactly one complete legacy or live contract/u,
    );
  }
});

test("custom auth relation evidence rejects absent deployment source", () => {
  assert.throws(
    () => normalizeCustomAuthRelationEvidenceSource(""),
    /deployment source is required/u,
  );
});
