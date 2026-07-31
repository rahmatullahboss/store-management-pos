import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCustomAuthRelationEvidenceSource } from "../../tooling/scripts/staging-custom-auth-source-contract.mjs";

const canonicalRelations =
  "'custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits','custom_auth_events'";

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
  assert.equal(normalized.split(canonicalRelations).length - 1, 1);
});

test("custom auth relation evidence rejects missing, reordered or duplicate contracts", () => {
  for (const source of [
    "'custom_auth_credentials','custom_auth_sessions','custom_auth_rate_limits'",
    "'custom_auth_sessions','custom_auth_credentials','custom_auth_rate_limits','custom_auth_events'",
    `${canonicalRelations}\n${canonicalRelations}`,
  ]) {
    assert.throws(
      () => normalizeCustomAuthRelationEvidenceSource(source),
      /must appear exactly once/u,
    );
  }
});

test("custom auth relation evidence rejects absent deployment source", () => {
  assert.throws(
    () => normalizeCustomAuthRelationEvidenceSource(""),
    /deployment source is required/u,
  );
});
