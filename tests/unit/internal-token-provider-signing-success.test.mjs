import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  executeAuditedInternalTokenProviderSigning,
} from "../../tooling/scripts/internal-token-provider-signing.mjs";

function digest(value) {
  return createHash("sha256").update(value).digest("base64url");
}

const keyReference = "kms://production/internal-token/signing-key/version/42";
const signingInput = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJzdG9yZS1hcGkifQ";

test("audited non-exportable provider signing returns runtime signature and aggregate-only summary", async () => {
  const signature = new Uint8Array(256).fill(7);
  let providerRequest;
  const result = await executeAuditedInternalTokenProviderSigning(
    {
      async sign(request) {
        providerRequest = request;
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
            latencyMs: 42,
            requestDigest: request.requestDigest,
            signingInputDigest: request.signingInputDigest,
            keyReferenceDigest: request.keyReferenceDigest,
            keyVersionDigest: digest("key-version-42"),
            auditReferenceDigest: digest("provider-audit-event-9001"),
            operationDigest: digest("provider-sign-operation-9001"),
            signatureDigest: digest(signature),
          },
        };
      },
    },
    {
      signingInput,
      keyReference,
      keyReferenceDigest: digest(keyReference),
      purpose: "command-token",
      requestedAt: 1_800_000_000,
      expiresAt: 1_800_000_030,
    },
    1_800_000_010,
  );

  assert.equal(providerRequest.keyReference, keyReference);
  assert.equal(providerRequest.signingInput, signingInput);
  assert.equal(providerRequest.algorithm, "RS256");
  assert.equal(providerRequest.digestAlgorithm, "SHA-256");
  assert.equal(providerRequest.purpose, "command-token");
  assert.deepEqual(result.signature, signature);
  assert.deepEqual(result.summary, {
    schemaVersion: 1,
    algorithm: "RS256",
    digestAlgorithm: "SHA-256",
    providerClass: "managed-hsm",
    receiptValidated: true,
    nonExportable: true,
    hardwareProtected: true,
    auditReferencePresent: true,
    requestBound: true,
    signatureByteLength: 256,
    latencyMs: 42,
    identifiersIncluded: false,
    signingInputIncluded: false,
    signatureIncluded: false,
    receiptDigestsIncluded: false,
  });
  const persisted = JSON.stringify(result.summary);
  assert.doesNotMatch(persisted, /kms:\/\/|version\/42|eyJ|provider-audit|provider-sign/u);
  assert.doesNotMatch(persisted, new RegExp(digest(keyReference), "u"));
});
