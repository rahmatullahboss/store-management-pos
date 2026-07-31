import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildInternalTokenProviderEvidenceExport,
  createInternalTokenProviderEvidenceHoldDigest,
  createInternalTokenProviderEvidencePolicyDigest,
  verifyInternalTokenProviderEvidenceExport,
} from "../../tooling/scripts/internal-token-provider-evidence-custody.mjs";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const now = 2_000_000_000;

function retentionPolicy(overrides = {}) {
  const body = {
    approvalDigest: digest("retention-approval"),
    effectiveAt: now - 1_000,
    expiresAt: now + 1_000,
    maximumExportRows: 20,
    retentionDays: 30,
    schemaVersion: 1,
    ...overrides,
  };
  return {
    ...body,
    policyDigest: createInternalTokenProviderEvidencePolicyDigest(body),
  };
}

function legalHold(overrides = {}) {
  const body = {
    imposedAt: now - 100,
    releasedAt: null,
    scopeEndsAt: null,
    scopeStartsAt: now - 60 * 86_400,
    schemaVersion: 1,
    ...overrides,
  };
  return {
    ...body,
    holdDigest: createInternalTokenProviderEvidenceHoldDigest(body),
  };
}

function evidence(index, occurredAt) {
  return {
    algorithm: "RS256",
    auditReferenceDigest: digest(`audit-${index}`),
    digestAlgorithm: "SHA-256",
    hardwareProtected: true,
    keyReferenceDigest: digest(`key-reference-${index}`),
    keyVersionDigest: digest(`key-version-${index}`),
    latencyMs: 12 + index,
    nonExportable: true,
    occurredAt,
    operationDigest: digest(`operation-${index}`),
    providerClass: index % 2 === 0 ? "managed-hsm" : "cloud-kms",
    purpose: index % 2 === 0 ? "command-token" : "read-token",
    receiptValidated: true,
    requestDigest: digest(`request-${index}`),
    signatureByteLength: 256,
    signatureDigest: digest(`signature-${index}`),
    signingInputDigest: digest(`signing-input-${index}`),
  };
}

test("evidence export is deterministic, chained and privacy preserving", () => {
  const source = [evidence(2, now - 10), evidence(1, now - 40 * 86_400)];
  const first = buildInternalTokenProviderEvidenceExport(source, retentionPolicy(), [], now);
  const second = buildInternalTokenProviderEvidenceExport(
    [...source].reverse(),
    retentionPolicy(),
    [],
    now,
  );
  assert.deepEqual(first, second);
  assert.deepEqual(verifyInternalTokenProviderEvidenceExport(first), {
    chainValid: true,
    eligibleForDisposalCount: 1,
    legalHoldCount: 0,
    privacyProfile: "digest-only-v1",
    recordCount: 2,
    retentionDays: 30,
    status: "sealed",
  });
  assert.equal(first.records[0].previousRecordDigest, null);
  assert.equal(first.records[1].previousRecordDigest, first.records[0].recordDigest);
  assert.equal(first.chainRootDigest, first.records[1].recordDigest);
  const serialized = JSON.stringify(first);
  for (const forbidden of [
    source[0].requestDigest,
    source[0].keyReferenceDigest,
    source[0].auditReferenceDigest,
    source[0].operationDigest,
    source[0].signatureDigest,
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "u"));
  }
});

test("active legal hold blocks disposal after the retention horizon", () => {
  const record = evidence(1, now - 40 * 86_400);
  const withoutHold = buildInternalTokenProviderEvidenceExport(
    [record],
    retentionPolicy(),
    [],
    now,
  );
  const withHold = buildInternalTokenProviderEvidenceExport(
    [record],
    retentionPolicy(),
    [legalHold()],
    now,
  );
  assert.equal(withoutHold.records[0].eligibleForDisposal, true);
  assert.equal(withHold.records[0].legalHold, true);
  assert.equal(withHold.records[0].eligibleForDisposal, false);
  assert.equal(withHold.legalHoldCount, 1);
  assert.equal(withHold.eligibleForDisposalCount, 0);
});

test("released legal hold no longer blocks an expired record", () => {
  const result = buildInternalTokenProviderEvidenceExport(
    [evidence(1, now - 40 * 86_400)],
    retentionPolicy(),
    [legalHold({ releasedAt: now - 1 })],
    now,
  );
  assert.equal(result.records[0].legalHold, false);
  assert.equal(result.records[0].eligibleForDisposal, true);
});

test("export verification rejects record, linkage and aggregate tampering", () => {
  const value = buildInternalTokenProviderEvidenceExport(
    [evidence(1, now - 5), evidence(2, now - 4)],
    retentionPolicy(),
    [],
    now,
  );
  const tamperedRecord = structuredClone(value);
  tamperedRecord.records[0].latencyMs += 1;
  assert.throws(
    () => verifyInternalTokenProviderEvidenceExport(tamperedRecord),
    /record digest does not match/u,
  );
  const tamperedLink = structuredClone(value);
  tamperedLink.records[1].previousRecordDigest = digest("wrong-link");
  assert.throws(
    () => verifyInternalTokenProviderEvidenceExport(tamperedLink),
    /sequence or linkage is invalid/u,
  );
  const tamperedCount = structuredClone(value);
  tamperedCount.legalHoldCount = 1;
  assert.throws(
    () => verifyInternalTokenProviderEvidenceExport(tamperedCount),
    /retention counts do not match/u,
  );
});

test("export fails closed for unapproved policy, extra fields and replayed records", () => {
  const invalidPolicy = retentionPolicy();
  invalidPolicy.policyDigest = digest("wrong-policy");
  assert.throws(
    () => buildInternalTokenProviderEvidenceExport(
      [evidence(1, now - 1)],
      invalidPolicy,
      [],
      now,
    ),
    /policy digest does not match/u,
  );
  assert.throws(
    () => buildInternalTokenProviderEvidenceExport(
      [{ ...evidence(1, now - 1), rawKeyReference: "provider/key/secret" }],
      retentionPolicy(),
      [],
      now,
    ),
    /record fields are invalid/u,
  );
  const replayed = evidence(1, now - 1);
  assert.throws(
    () => buildInternalTokenProviderEvidenceExport(
      [replayed, { ...replayed, occurredAt: now - 2 }],
      retentionPolicy(),
      [],
      now,
    ),
    /requestDigest values must be unique/u,
  );
});
