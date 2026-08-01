import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider operational gate remains fail closed and identifier free", async () => {
  const source = await readFile(
    new URL(
      "../../tooling/scripts/internal-token-provider-operational-gate.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const documentation = await readFile(
    new URL(
      "../../docs/architecture/production-provider-operational-gate.md",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /executeRecordedAuditedInternalTokenProviderSigning/u,
  );
  assert.match(source, /cloud-kms/u);
  assert.match(source, /managed-hsm/u);
  assert.match(source, /pkcs11-hsm/u);
  assert.doesNotMatch(source, /test-double/u);
  assert.match(source, /command-token/u);
  assert.match(source, /read-token/u);
  assert.match(source, /emergencyDisabled/u);
  assert.match(source, /maxConcurrentRequests/u);
  assert.match(source, /maxErrorRateBasisPoints/u);
  assert.match(source, /maxP95LatencyMs/u);
  assert.match(source, /maxRequestLatencyMs/u);
  assert.match(source, /lastAuditAt/u);
  assert.match(source, /lastJournalAckAt/u);
  assert.match(source, /operationalGateValidated/u);
  assert.match(source, /identifiersIncluded: false/u);
  assert.match(source, /policyDigestIncluded: false/u);
  assert.match(source, /keyReferenceDigestIncluded: false/u);
  assert.match(source, /healthDigestIncluded: false/u);
  assert.doesNotMatch(source, /process\.env/u);
  assert.doesNotMatch(source, /DATABASE_URL/u);
  assert.doesNotMatch(source, /privateKey/u);
  assert.doesNotMatch(source, /signingInput/u);
  assert.doesNotMatch(source, /\bkeyReference\b/u);

  assert.match(documentation, /does not provision a provider/u);
  assert.match(documentation, /does not approve production launch/u);
  assert.match(documentation, /provider and recorder are not called/u);
  assert.match(documentation, /ten verified controls/u);
  assert.match(documentation, /three distinct owner approvals/u);
});
