import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  executeRecordedAuditedInternalTokenProviderSigning,
} from "../../tooling/scripts/internal-token-provider-signing-recorded.mjs";

function digest(value) {
  return createHash("sha256").update(value).digest("base64url");
}

const keyReference = "hsm://production-cluster/internal-token/key/version-9";
const signingInput = "eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJzdG9yZS1hcGkifQ";

function command() {
  return {
    signingInput,
    keyReference,
    keyReferenceDigest: digest(keyReference),
    purpose: "command-token",
    requestedAt: 1_800_000_000,
    expiresAt: 1_800_000_030,
  };
}

function provider() {
  return {
    async sign(request) {
      const signature = new Uint8Array(256).fill(11);
      return {
        signature,
        receipt: {
          schemaVersion: 1,
          algorithm: "RS256",
          digestAlgorithm: "SHA-256",
          providerClass: "managed-hsm",
          status: "succeeded",
          nonExportable: true,
          hardwareProtected: true,
          occurredAt: 1_800_000_010,
          latencyMs: 31,
          requestDigest: request.requestDigest,
          signingInputDigest: request.signingInputDigest,
          keyReferenceDigest: request.keyReferenceDigest,
          keyVersionDigest: digest("key-version-9"),
          auditReferenceDigest: digest("audit-reference-9"),
          operationDigest: digest("operation-9"),
          signatureDigest: digest(signature),
        },
      };
    },
  };
}

test("recorded provider signing persists digest-only evidence before returning signature", async () => {
  const records = [];
  const result = await executeRecordedAuditedInternalTokenProviderSigning(
    provider(),
    command(),
    1_800_000_010,
    {
      async record(evidence) {
        records.push(evidence);
        return {
          schemaVersion: 1,
          providerClass: evidence.providerClass,
          purpose: evidence.purpose,
          recorded: true,
          identifiersIncluded: false,
          receiptDigestsIncluded: false,
        };
      },
    },
  );

  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    "algorithm",
    "auditReferenceDigest",
    "digestAlgorithm",
    "hardwareProtected",
    "keyReferenceDigest",
    "keyVersionDigest",
    "latencyMs",
    "nonExportable",
    "occurredAt",
    "operationDigest",
    "providerClass",
    "purpose",
    "receiptValidated",
    "requestDigest",
    "schemaVersion",
    "signatureByteLength",
    "signatureDigest",
    "signingInputDigest",
  ]);
  assert.equal(records[0].providerClass, "managed-hsm");
  assert.equal(records[0].purpose, "command-token");
  assert.equal(records[0].signatureByteLength, 256);
  assert.equal(result.signature.byteLength, 256);
  assert.equal(result.summary.durableEvidenceRecorded, true);
  assert.equal(result.summary.identifiersIncluded, false);
  assert.equal(result.summary.signatureIncluded, false);
  assert.equal(result.summary.receiptDigestsIncluded, false);
  const persisted = JSON.stringify(result.summary);
  assert.doesNotMatch(persisted, /hsm:\/\/|version-9|eyJ|audit-reference|operation-9/u);
  for (const value of Object.values(records[0])) {
    assert.notEqual(value, keyReference);
    assert.notEqual(value, signingInput);
  }
});

test("durable journal failure aborts signature return and masks recorder details", async () => {
  await assert.rejects(
    executeRecordedAuditedInternalTokenProviderSigning(
      provider(),
      command(),
      1_800_000_010,
      {
        async record() {
          throw new Error("postgres://secret-host/provider-journal-write-failed");
        },
      },
    ),
    (error) => {
      assert.match(error.message, /durable evidence recording failed/u);
      assert.doesNotMatch(error.message, /postgres|secret-host|journal-write-failed/u);
      return true;
    },
  );
});

test("record acknowledgement must be aggregate-only and bound to provider class and purpose", async () => {
  await assert.rejects(
    executeRecordedAuditedInternalTokenProviderSigning(
      provider(),
      command(),
      1_800_000_010,
      {
        async record(evidence) {
          return {
            schemaVersion: 1,
            providerClass: evidence.providerClass,
            purpose: evidence.purpose,
            recorded: true,
            identifiersIncluded: false,
            receiptDigestsIncluded: false,
            operationDigest: evidence.operationDigest,
          };
        },
      },
    ),
    /record acknowledgement fields are invalid/u,
  );

  await assert.rejects(
    executeRecordedAuditedInternalTokenProviderSigning(
      provider(),
      command(),
      1_800_000_010,
      {
        async record(evidence) {
          return {
            schemaVersion: 1,
            providerClass: "cloud-kms",
            purpose: evidence.purpose,
            recorded: true,
            identifiersIncluded: false,
            receiptDigestsIncluded: false,
          };
        },
      },
    ),
    /record acknowledgement is invalid/u,
  );
});
