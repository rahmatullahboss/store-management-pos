import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildInternalTokenProviderEvidenceExport,
  createInternalTokenProviderEvidenceCustodyCommand,
  createInternalTokenProviderEvidencePolicyDigest,
  INTERNAL_TOKEN_PROVIDER_EVIDENCE_CUSTODY_SQL,
  recordInternalTokenProviderEvidenceCustody,
} from "../../tooling/scripts/internal-token-provider-evidence-custody.mjs";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const now = 2_000_000_000;

function exportEvidence() {
  const policyBody = {
    approvalDigest: digest("approval"),
    effectiveAt: now - 10,
    expiresAt: now + 10,
    maximumExportRows: 10,
    retentionDays: 90,
    schemaVersion: 1,
  };
  return buildInternalTokenProviderEvidenceExport(
    [{
      algorithm: "RS256",
      auditReferenceDigest: digest("audit"),
      digestAlgorithm: "SHA-256",
      hardwareProtected: true,
      keyReferenceDigest: digest("key-reference"),
      keyVersionDigest: digest("key-version"),
      latencyMs: 20,
      nonExportable: true,
      occurredAt: now - 1,
      operationDigest: digest("operation"),
      providerClass: "pkcs11-hsm",
      purpose: "command-token",
      receiptValidated: true,
      requestDigest: digest("request"),
      signatureByteLength: 256,
      signatureDigest: digest("signature"),
      signingInputDigest: digest("signing-input"),
    }],
    {
      ...policyBody,
      policyDigest: createInternalTokenProviderEvidencePolicyDigest(policyBody),
    },
    [],
    now,
  );
}

test("custody command is digest-bound and enforces chain shape", () => {
  const first = createInternalTokenProviderEvidenceCustodyCommand(
    exportEvidence(),
    1,
    null,
  );
  const repeated = createInternalTokenProviderEvidenceCustodyCommand(
    exportEvidence(),
    1,
    null,
  );
  assert.deepEqual(first, repeated);
  const second = createInternalTokenProviderEvidenceCustodyCommand(
    exportEvidence(),
    2,
    first.custodyDigest,
  );
  assert.equal(second.previousCustodyDigest, first.custodyDigest);
  assert.notEqual(second.custodyDigest, first.custodyDigest);
  assert.throws(
    () => createInternalTokenProviderEvidenceCustodyCommand(
      exportEvidence(),
      2,
      null,
    ),
    /linkage shape is invalid/u,
  );
});

test("custody recorder uses the privileged function and returns aggregate acknowledgement", async () => {
  const command = createInternalTokenProviderEvidenceCustodyCommand(
    exportEvidence(),
    1,
    null,
  );
  const calls = [];
  const result = await recordInternalTokenProviderEvidenceCustody(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ recorded: true }] };
      },
    },
    command,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, INTERNAL_TOKEN_PROVIDER_EVIDENCE_CUSTODY_SQL);
  assert.equal(calls[0].params.length, 14);
  assert.deepEqual(result, {
    durable: true,
    identifierIncluded: false,
    receiptDigestsIncluded: false,
    recordCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /exportDigest|custodyDigest|policyDigest/u);
});

test("custody recorder masks database failures and rejects tampered acknowledgements", async () => {
  const command = createInternalTokenProviderEvidenceCustodyCommand(
    exportEvidence(),
    1,
    null,
  );
  await assert.rejects(
    recordInternalTokenProviderEvidenceCustody(
      { query: async () => { throw new Error("postgresql://secret"); } },
      command,
    ),
    (error) => {
      assert.match(error.message, /database write failed/u);
      assert.doesNotMatch(error.message, /postgresql|secret/u);
      return true;
    },
  );
  await assert.rejects(
    recordInternalTokenProviderEvidenceCustody(
      { query: async () => ({ rows: [{ recorded: false }] }) },
      command,
    ),
    /database acknowledgement is invalid/u,
  );
  await assert.rejects(
    recordInternalTokenProviderEvidenceCustody(
      { query: async () => ({ rows: [{ recorded: true }] }) },
      { ...command, recordCount: 2 },
    ),
    /command digest does not match/u,
  );
});
