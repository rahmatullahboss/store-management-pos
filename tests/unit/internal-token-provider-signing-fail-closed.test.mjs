import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  executeAuditedInternalTokenProviderSigning,
} from "../../tooling/scripts/internal-token-provider-signing.mjs";

function digest(value) {
  return createHash("sha256").update(value).digest("base64url");
}

const keyReference = "hsm://cluster-01/internal-token/key-version-7";
const signingInput = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ";

function command(overrides = {}) {
  return {
    signingInput,
    keyReference,
    keyReferenceDigest: digest(keyReference),
    purpose: "read-token",
    requestedAt: 1_800_000_000,
    expiresAt: 1_800_000_030,
    ...overrides,
  };
}

function signingProvider(mutateReceipt = (receipt) => receipt, mutateResponse = (response) => response) {
  return {
    async sign(request) {
      const signature = new Uint8Array(256).fill(9);
      const receipt = {
        schemaVersion: 1,
        algorithm: "RS256",
        digestAlgorithm: "SHA-256",
        providerClass: "pkcs11-hsm",
        status: "succeeded",
        nonExportable: true,
        hardwareProtected: true,
        occurredAt: 1_800_000_010,
        latencyMs: 10,
        requestDigest: request.requestDigest,
        signingInputDigest: request.signingInputDigest,
        keyReferenceDigest: request.keyReferenceDigest,
        keyVersionDigest: digest("key-version-7"),
        auditReferenceDigest: digest("audit-reference-7"),
        operationDigest: digest("operation-7"),
        signatureDigest: digest(signature),
      };
      return mutateResponse({ signature, receipt: mutateReceipt(receipt) });
    },
  };
}

test("provider receipt must attest hardware non-exportability and bind every signing digest", async () => {
  const invalidReceipts = [
    (receipt) => ({ ...receipt, nonExportable: false }),
    (receipt) => ({ ...receipt, hardwareProtected: false }),
    (receipt) => ({ ...receipt, providerClass: "software-library" }),
    (receipt) => ({ ...receipt, requestDigest: digest("forged-request") }),
    (receipt) => ({ ...receipt, signatureDigest: digest("forged-signature") }),
    (receipt) => ({ ...receipt, occurredAt: 1_800_000_031 }),
    (receipt) => ({ ...receipt, auditReferenceDigest: receipt.operationDigest }),
  ];

  for (const mutate of invalidReceipts) {
    await assert.rejects(
      executeAuditedInternalTokenProviderSigning(
        signingProvider(mutate),
        command(),
        1_800_000_010,
      ),
      /Internal-token provider signing:/u,
    );
  }
});

test("provider objects and responses reject private material while provider errors are masked", async () => {
  let calls = 0;
  await assert.rejects(
    executeAuditedInternalTokenProviderSigning(
      {
        async sign() { calls += 1; },
        privateKey: "must-not-be-accepted",
      },
      command(),
      1_800_000_010,
    ),
    /provider fields are invalid/u,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    executeAuditedInternalTokenProviderSigning(
      {
        async sign() {
          throw new Error("hsm://cluster-01/private/secret-provider-message");
        },
      },
      command(),
      1_800_000_010,
    ),
    (error) => {
      assert.match(error.message, /provider signing operation failed/u);
      assert.doesNotMatch(error.message, /cluster-01|secret-provider-message/u);
      return true;
    },
  );

  await assert.rejects(
    executeAuditedInternalTokenProviderSigning(
      signingProvider(
        (receipt) => receipt,
        (response) => ({ ...response, privateJwk: { d: "forbidden" } }),
      ),
      command(),
      1_800_000_010,
    ),
    /provider response fields are invalid/u,
  );
});

test("invalid or expired signing commands fail before the provider is invoked", async () => {
  let calls = 0;
  const provider = { async sign() { calls += 1; } };

  await assert.rejects(
    executeAuditedInternalTokenProviderSigning(
      provider,
      command({ keyReferenceDigest: digest("different-key") }),
      1_800_000_010,
    ),
    /key reference digest does not match/u,
  );
  await assert.rejects(
    executeAuditedInternalTokenProviderSigning(
      provider,
      command(),
      1_800_000_031,
    ),
    /outside its signing window/u,
  );
  await assert.rejects(
    executeAuditedInternalTokenProviderSigning(
      provider,
      command({ signingInput: "not-a-compact-jwt" }),
      1_800_000_010,
    ),
    /compact JWT header and payload/u,
  );
  assert.equal(calls, 0);
});
