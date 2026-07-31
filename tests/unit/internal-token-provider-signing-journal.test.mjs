import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL,
  recordInternalTokenProviderSigningEvidence,
} from "../../tooling/scripts/internal-token-provider-signing-journal.mjs";

const digests = ["A", "B", "C", "D", "E", "F", "G"].map((letter) => letter.repeat(43));

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    algorithm: "RS256",
    digestAlgorithm: "SHA-256",
    providerClass: "cloud-kms",
    purpose: "read-token",
    requestDigest: digests[0],
    signingInputDigest: digests[1],
    keyReferenceDigest: digests[2],
    keyVersionDigest: digests[3],
    auditReferenceDigest: digests[4],
    operationDigest: digests[5],
    signatureDigest: digests[6],
    nonExportable: true,
    hardwareProtected: true,
    receiptValidated: true,
    signatureByteLength: 256,
    latencyMs: 25,
    occurredAt: 1_800_000_000,
    ...overrides,
  };
}

test("provider signing recorder calls only the stored append function and returns aggregate acknowledgement", async () => {
  const calls = [];
  const result = await recordInternalTokenProviderSigningEvidence(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ recorded: true }] };
      },
    },
    evidence(),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL);
  assert.deepEqual(calls[0].params.slice(0, 7), digests);
  assert.deepEqual(calls[0].params.slice(7, 17), [
    "read-token",
    "cloud-kms",
    "RS256",
    "SHA-256",
    true,
    true,
    true,
    256,
    25,
    "2027-01-15T08:00:00.000Z",
  ]);
  assert.deepEqual(result, {
    schemaVersion: 1,
    providerClass: "cloud-kms",
    purpose: "read-token",
    recorded: true,
    identifiersIncluded: false,
    receiptDigestsIncluded: false,
  });
  assert.match(INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL, /^SELECT\s+/u);
  assert.match(INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL, /append_internal_token_provider_signing_journal/u);
  assert.doesNotMatch(INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL, /(?:INSERT|UPDATE|DELETE)\s/iu);
});

test("journal recorder rejects ineligible or non-aggregate evidence before database access", async () => {
  let queries = 0;
  const client = { async query() { queries += 1; return { rows: [{ recorded: true }] }; } };

  await assert.rejects(
    recordInternalTokenProviderSigningEvidence(
      client,
      evidence({ providerClass: "test-double" }),
    ),
    /not durable-journal eligible/u,
  );
  await assert.rejects(
    recordInternalTokenProviderSigningEvidence(
      client,
      { ...evidence(), keyReference: "kms:\/\/forbidden\/raw-reference" },
    ),
    /evidence fields are invalid/u,
  );
  await assert.rejects(
    recordInternalTokenProviderSigningEvidence(
      client,
      evidence({ signatureDigest: digests[5] }),
    ),
    /digests must have distinct purposes/u,
  );
  await assert.rejects(
    recordInternalTokenProviderSigningEvidence(
      { async query() { queries += 1; return { rows: [{ recorded: false }] }; } },
      evidence(),
    ),
    /database acknowledgement is invalid/u,
  );
  assert.equal(queries, 1);
});
