import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildInternalTokenProviderEvidenceExport,
  createInternalTokenProviderEvidenceCustodyCommand,
  createInternalTokenProviderEvidencePolicyDigest,
} from "../../tooling/scripts/internal-token-provider-evidence-custody.mjs";
import {
  authorizeInternalTokenProviderEvidenceDisposition,
  createInternalTokenProviderEvidenceDispositionCommand,
  createInternalTokenProviderEvidenceDispositionRequest,
  createInternalTokenProviderEvidenceDispositionSnapshotDigest,
  INTERNAL_TOKEN_PROVIDER_EVIDENCE_DISPOSITION_SQL,
  recheckInternalTokenProviderEvidenceDisposition,
  recordInternalTokenProviderEvidenceDisposition,
} from "../../tooling/scripts/internal-token-provider-evidence-disposition.mjs";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const now = 2_000_000_000;

function dispositionCommand() {
  const policyBody = {
    approvalDigest: digest("retention-approval"),
    effectiveAt: now - 10_000,
    expiresAt: now + 10_000,
    maximumExportRows: 10,
    retentionDays: 1,
    schemaVersion: 1,
  };
  const exported = buildInternalTokenProviderEvidenceExport(
    [{
      algorithm: "RS256",
      auditReferenceDigest: digest("sign-audit"),
      digestAlgorithm: "SHA-256",
      hardwareProtected: true,
      keyReferenceDigest: digest("key-reference"),
      keyVersionDigest: digest("key-version"),
      latencyMs: 20,
      nonExportable: true,
      occurredAt: now - 3 * 86_400,
      operationDigest: digest("sign-operation"),
      providerClass: "managed-hsm",
      purpose: "command-token",
      receiptValidated: true,
      requestDigest: digest("sign-request"),
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
  const custody = createInternalTokenProviderEvidenceCustodyCommand(exported, 1, null);
  const request = createInternalTokenProviderEvidenceDispositionRequest(custody, {
    caseDigest: digest("disposition-case"),
    expiresAt: now + 600,
    proposerDigest: digest("proposer"),
    requestedAt: now,
    schemaVersion: 1,
  });
  const approval = authorizeInternalTokenProviderEvidenceDisposition(
    request,
    [
      { actorDigest: digest("records-owner"), approvedAt: now + 10, role: "records_owner" },
      { actorDigest: digest("security-owner"), approvedAt: now + 20, role: "security_owner" },
    ],
    now + 20,
  );
  const snapshot = {
    candidateCount: request.candidateCount,
    custodyDigest: request.custodyDigest,
    exportDigest: request.exportDigest,
    legalHoldCount: 0,
    recheckedAt: now + 30,
    schemaVersion: 1,
  };
  const recheck = recheckInternalTokenProviderEvidenceDisposition(
    request,
    approval,
    {
      ...snapshot,
      snapshotDigest: createInternalTokenProviderEvidenceDispositionSnapshotDigest(snapshot),
    },
    now + 30,
  );
  return createInternalTokenProviderEvidenceDispositionCommand(
    request,
    approval,
    recheck,
    {
      approvalDigest: approval.approvalDigest,
      candidateCount: request.candidateCount,
      custodyDigest: request.custodyDigest,
      legalHoldChecked: true,
      occurredAt: now + 40,
      operationDigest: digest("destruction-operation"),
      providerAuditDigest: digest("destruction-audit"),
      providerClass: "vault-archive",
      recheckDigest: recheck.recheckDigest,
      requestDigest: request.requestDigest,
      schemaVersion: 1,
      status: "succeeded",
    },
    now + 40,
    1,
    null,
  );
}

test("disposition recorder calls only the privileged append function", async () => {
  const command = dispositionCommand();
  const calls = [];
  const result = await recordInternalTokenProviderEvidenceDisposition(
    {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ recorded: true }] };
      },
    },
    command,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, INTERNAL_TOKEN_PROVIDER_EVIDENCE_DISPOSITION_SQL);
  assert.equal(calls[0].params.length, 16);
  assert.deepEqual(result, {
    approvalCount: 2,
    candidateCount: 1,
    durable: true,
    identifiersIncluded: false,
    receiptDigestsIncluded: false,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /custodyDigest|requestDigest|approvalDigest|operationDigest|providerAuditDigest/u,
  );
});

test("disposition recorder masks database details and rejects invalid acknowledgement", async () => {
  const command = dispositionCommand();
  await assert.rejects(
    recordInternalTokenProviderEvidenceDisposition(
      { query: async () => { throw new Error("postgresql://secret-host/archive"); } },
      command,
    ),
    (error) => {
      assert.match(error.message, /database write failed/u);
      assert.doesNotMatch(error.message, /postgresql|secret-host|archive/u);
      return true;
    },
  );
  await assert.rejects(
    recordInternalTokenProviderEvidenceDisposition(
      { query: async () => ({ rows: [{ recorded: false }] }) },
      command,
    ),
    /database acknowledgement is invalid/u,
  );
});

test("disposition recorder detects command tampering before database access", async () => {
  const command = dispositionCommand();
  let queryCount = 0;
  await assert.rejects(
    recordInternalTokenProviderEvidenceDisposition(
      { query: async () => { queryCount += 1; return { rows: [{ recorded: true }] }; } },
      { ...command, candidateCount: command.candidateCount + 1 },
    ),
    /command digest does not match/u,
  );
  assert.equal(queryCount, 0);
});
