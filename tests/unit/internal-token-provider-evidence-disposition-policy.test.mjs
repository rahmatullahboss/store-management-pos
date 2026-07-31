import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildInternalTokenProviderEvidenceExport,
  createInternalTokenProviderEvidenceCustodyCommand,
  createInternalTokenProviderEvidenceHoldDigest,
  createInternalTokenProviderEvidencePolicyDigest,
} from "../../tooling/scripts/internal-token-provider-evidence-custody.mjs";
import {
  authorizeInternalTokenProviderEvidenceDisposition,
  createInternalTokenProviderEvidenceDispositionCommand,
  createInternalTokenProviderEvidenceDispositionRequest,
  createInternalTokenProviderEvidenceDispositionSnapshotDigest,
  recheckInternalTokenProviderEvidenceDisposition,
} from "../../tooling/scripts/internal-token-provider-evidence-disposition.mjs";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const now = 2_000_000_000;

function sourceEvidence(index, occurredAt) {
  return {
    algorithm: "RS256",
    auditReferenceDigest: digest(`audit-${index}`),
    digestAlgorithm: "SHA-256",
    hardwareProtected: true,
    keyReferenceDigest: digest(`key-reference-${index}`),
    keyVersionDigest: digest(`key-version-${index}`),
    latencyMs: 10 + index,
    nonExportable: true,
    occurredAt,
    operationDigest: digest(`sign-operation-${index}`),
    providerClass: "managed-hsm",
    purpose: index % 2 === 0 ? "command-token" : "read-token",
    receiptValidated: true,
    requestDigest: digest(`sign-request-${index}`),
    signatureByteLength: 256,
    signatureDigest: digest(`signature-${index}`),
    signingInputDigest: digest(`signing-input-${index}`),
  };
}

function custodyEvidence(
  records = [sourceEvidence(1, now - 3 * 86_400)],
  retentionDays = 1,
  holds = [],
) {
  const policyBody = {
    approvalDigest: digest("retention-approval"),
    effectiveAt: now - 10_000,
    expiresAt: now + 10_000,
    maximumExportRows: 10,
    retentionDays,
    schemaVersion: 1,
  };
  const exported = buildInternalTokenProviderEvidenceExport(
    records,
    {
      ...policyBody,
      policyDigest: createInternalTokenProviderEvidencePolicyDigest(policyBody),
    },
    holds,
    now,
  );
  return createInternalTokenProviderEvidenceCustodyCommand(exported, 1, null);
}

function dispositionRequest(custody = custodyEvidence()) {
  return createInternalTokenProviderEvidenceDispositionRequest(custody, {
    caseDigest: digest("disposition-case"),
    expiresAt: now + 600,
    proposerDigest: digest("proposer"),
    requestedAt: now,
    schemaVersion: 1,
  });
}

function dispositionApproval(request = dispositionRequest()) {
  return authorizeInternalTokenProviderEvidenceDisposition(
    request,
    [
      {
        actorDigest: digest("records-owner"),
        approvedAt: now + 10,
        role: "records_owner",
      },
      {
        actorDigest: digest("security-owner"),
        approvedAt: now + 20,
        role: "security_owner",
      },
    ],
    now + 20,
  );
}

function dispositionRecheck(request = dispositionRequest(), approval = dispositionApproval(request)) {
  const snapshot = {
    candidateCount: request.candidateCount,
    custodyDigest: request.custodyDigest,
    exportDigest: request.exportDigest,
    legalHoldCount: 0,
    recheckedAt: now + 30,
    schemaVersion: 1,
  };
  return recheckInternalTokenProviderEvidenceDisposition(
    request,
    approval,
    {
      ...snapshot,
      snapshotDigest: createInternalTokenProviderEvidenceDispositionSnapshotDigest(snapshot),
    },
    now + 30,
  );
}

function destructionReceipt(request, approval, recheck, overrides = {}) {
  return {
    approvalDigest: approval.approvalDigest,
    candidateCount: request.candidateCount,
    custodyDigest: request.custodyDigest,
    legalHoldChecked: true,
    occurredAt: now + 40,
    operationDigest: digest("destruction-operation"),
    providerAuditDigest: digest("destruction-audit"),
    providerClass: "object-lock-archive",
    recheckDigest: recheck.recheckDigest,
    requestDigest: request.requestDigest,
    schemaVersion: 1,
    status: "succeeded",
    ...overrides,
  };
}

test("two-person approval, hold recheck and receipt produce a sealed disposition command", () => {
  const custody = custodyEvidence();
  const request = dispositionRequest(custody);
  const approval = dispositionApproval(request);
  const recheck = dispositionRecheck(request, approval);
  const command = createInternalTokenProviderEvidenceDispositionCommand(
    request,
    approval,
    recheck,
    destructionReceipt(request, approval, recheck),
    now + 40,
    1,
    null,
  );
  assert.equal(command.approvalCount, 2);
  assert.equal(command.candidateCount, 1);
  assert.equal(command.legalHoldCount, 0);
  assert.equal(command.status, "destroyed");
  assert.equal(command.privacyProfile, "digest-only-v1");
  assert.equal(command.previousDispositionDigest, null);
  assert.notEqual(command.dispositionDigest, command.operationDigest);
  const serialized = JSON.stringify(command);
  assert.doesNotMatch(serialized, /records-owner|security-owner|proposer|disposition-case/u);
});

test("request requires the complete sealed export to be eligible and past retention", () => {
  const holdBody = {
    imposedAt: now - 100,
    releasedAt: null,
    scopeEndsAt: null,
    scopeStartsAt: now - 4 * 86_400,
    schemaVersion: 1,
  };
  const held = custodyEvidence(
    [sourceEvidence(1, now - 3 * 86_400)],
    1,
    [{
      ...holdBody,
      holdDigest: createInternalTokenProviderEvidenceHoldDigest(holdBody),
    }],
  );
  assert.throws(
    () => dispositionRequest(held),
    /not entirely eligible/u,
  );
  const futureRetention = custodyEvidence([sourceEvidence(1, now - 100)], 1);
  assert.throws(
    () => dispositionRequest(futureRetention),
    /retention horizon/u,
  );
});

test("proposer, duplicate actors and incomplete approval roles fail closed", () => {
  const request = dispositionRequest();
  assert.throws(
    () => authorizeInternalTokenProviderEvidenceDisposition(
      request,
      [
        { actorDigest: request.proposerDigest, approvedAt: now + 10, role: "records_owner" },
        { actorDigest: digest("security-owner"), approvedAt: now + 20, role: "security_owner" },
      ],
      now + 20,
    ),
    /proposer cannot approve/u,
  );
  const actor = digest("same-actor");
  assert.throws(
    () => authorizeInternalTokenProviderEvidenceDisposition(
      request,
      [
        { actorDigest: actor, approvedAt: now + 10, role: "records_owner" },
        { actorDigest: actor, approvedAt: now + 20, role: "security_owner" },
      ],
      now + 20,
    ),
    /actors must be distinct/u,
  );
  assert.throws(
    () => authorizeInternalTokenProviderEvidenceDisposition(
      request,
      [
        { actorDigest: digest("records-one"), approvedAt: now + 10, role: "records_owner" },
        { actorDigest: digest("records-two"), approvedAt: now + 20, role: "records_owner" },
      ],
      now + 20,
    ),
    /roles are incomplete/u,
  );
});

test("execution-time legal hold recheck blocks disposition", () => {
  const request = dispositionRequest();
  const approval = dispositionApproval(request);
  const snapshot = {
    candidateCount: request.candidateCount,
    custodyDigest: request.custodyDigest,
    exportDigest: request.exportDigest,
    legalHoldCount: 1,
    recheckedAt: now + 30,
    schemaVersion: 1,
  };
  assert.throws(
    () => recheckInternalTokenProviderEvidenceDisposition(
      request,
      approval,
      {
        ...snapshot,
        snapshotDigest: createInternalTokenProviderEvidenceDispositionSnapshotDigest(snapshot),
      },
      now + 30,
    ),
    /active legal hold blocks/u,
  );
});

test("destruction receipt must be bound, successful and inside the approval window", () => {
  const request = dispositionRequest();
  const approval = dispositionApproval(request);
  const recheck = dispositionRecheck(request, approval);
  assert.throws(
    () => createInternalTokenProviderEvidenceDispositionCommand(
      request,
      approval,
      recheck,
      destructionReceipt(request, approval, recheck, { candidateCount: 2 }),
      now + 40,
      1,
      null,
    ),
    /binding or status is invalid/u,
  );
  assert.throws(
    () => createInternalTokenProviderEvidenceDispositionCommand(
      request,
      approval,
      recheck,
      destructionReceipt(request, approval, recheck, { legalHoldChecked: false }),
      now + 40,
      1,
      null,
    ),
    /binding or status is invalid/u,
  );
  assert.throws(
    () => createInternalTokenProviderEvidenceDispositionCommand(
      request,
      approval,
      recheck,
      destructionReceipt(request, approval, recheck, { occurredAt: request.expiresAt + 1 }),
      request.expiresAt + 1,
      1,
      null,
    ),
    /timestamp is outside/u,
  );
});

test("disposition command requires correct custody-chain linkage shape", () => {
  const request = dispositionRequest();
  const approval = dispositionApproval(request);
  const recheck = dispositionRecheck(request, approval);
  assert.throws(
    () => createInternalTokenProviderEvidenceDispositionCommand(
      request,
      approval,
      recheck,
      destructionReceipt(request, approval, recheck),
      now + 40,
      2,
      null,
    ),
    /linkage shape is invalid/u,
  );
  const first = createInternalTokenProviderEvidenceDispositionCommand(
    request,
    approval,
    recheck,
    destructionReceipt(request, approval, recheck),
    now + 40,
    1,
    null,
  );
  const second = createInternalTokenProviderEvidenceDispositionCommand(
    request,
    approval,
    recheck,
    destructionReceipt(request, approval, recheck, {
      operationDigest: digest("destruction-operation-two"),
      providerAuditDigest: digest("destruction-audit-two"),
    }),
    now + 40,
    2,
    first.dispositionDigest,
  );
  assert.equal(second.previousDispositionDigest, first.dispositionDigest);
  assert.notEqual(second.dispositionDigest, first.dispositionDigest);
});
