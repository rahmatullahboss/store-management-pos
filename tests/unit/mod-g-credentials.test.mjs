import assert from "node:assert/strict";
import test from "node:test";
import {
  assertApiClientCredentialBinding,
  assertApiClientCredentialReference,
  rotateApiClientCredentialBinding,
  verifyApiClientCredential,
} from "../../build/modules/integrations/src/index.js";

const client = {
  schemaVersion: "1.0",
  clientId: "client-1",
  tenantId: "tenant-1",
  displayName: "Reporting partner",
  authentication: "api_key",
  scopes: ["reporting.*"],
  status: "active",
  rateLimitPerMinute: 120,
  createdAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2027-07-29T12:00:00.000Z",
};

const binding = {
  schemaVersion: "1.0",
  bindingId: "binding-1",
  tenantId: "tenant-1",
  clientId: "client-1",
  authentication: "api_key",
  credentialReference: "secret://integration/api-client-1/v1",
  credentialVersion: 1,
  status: "active",
  validFrom: "2026-07-29T12:00:00.000Z",
};

test("API client credentials require external references instead of raw key material", () => {
  assert.doesNotThrow(() => assertApiClientCredentialReference("vault://tenant-1/clients/client-1/v2"));
  assert.throws(() => assertApiClientCredentialReference("sk_live_raw_secret_value"), /external secret reference/i);
  assert.throws(() => assertApiClientCredentialReference("secret://single-token"), /external secret reference/i);
  assert.throws(() => assertApiClientCredentialReference("https://example.test/secret"), /external secret reference/i);
  assert.doesNotThrow(() => assertApiClientCredentialBinding(binding));
});

test("API client credential verification is tenant-bound and fail-closed", async () => {
  const calls = [];
  const verifier = {
    async verify(input) {
      calls.push(input);
      return "match";
    },
  };
  const verified = await verifyApiClientCredential({
    client,
    binding,
    tenantId: "tenant-1",
    clientId: "client-1",
    authentication: "api_key",
    presentedCredential: "presented-key-material",
    observedAt: "2026-07-29T12:05:00.000Z",
    verifier,
  });
  assert.deepEqual(verified, {
    verified: true,
    reason: "verified",
    clientId: "client-1",
    credentialVersion: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].credentialReference, binding.credentialReference);
  assert.equal(JSON.stringify(verified).includes("presented-key-material"), false);

  const tenantDenied = await verifyApiClientCredential({
    client,
    binding,
    tenantId: "tenant-2",
    clientId: "client-1",
    authentication: "api_key",
    presentedCredential: "presented-key-material",
    observedAt: "2026-07-29T12:05:00.000Z",
    verifier,
  });
  assert.equal(tenantDenied.reason, "tenant_mismatch");
  assert.equal(calls.length, 1, "secret provider must not run for an invalid tenant");

  const unavailable = await verifyApiClientCredential({
    client,
    binding,
    tenantId: "tenant-1",
    clientId: "client-1",
    authentication: "api_key",
    presentedCredential: "presented-key-material",
    observedAt: "2026-07-29T12:05:00.000Z",
    verifier: { async verify() { throw new Error("provider unavailable"); } },
  });
  assert.equal(unavailable.reason, "credential_unavailable");
  assert.equal(unavailable.verified, false);
});

test("API client credential rotation retires the old binding and increments version", () => {
  const rotated = rotateApiClientCredentialBinding({
    current: binding,
    expectedCredentialVersion: 1,
    nextBindingId: "binding-2",
    nextCredentialReference: "secret://integration/api-client-1/v2",
    observedAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(rotated.previous.status, "retired");
  assert.equal(rotated.previous.validUntil, "2026-08-01T00:00:00.000Z");
  assert.equal(rotated.current.status, "active");
  assert.equal(rotated.current.credentialVersion, 2);
  assert.equal(rotated.current.credentialReference, "secret://integration/api-client-1/v2");
  assert.throws(() => rotateApiClientCredentialBinding({
    current: binding,
    expectedCredentialVersion: 2,
    nextBindingId: "binding-2",
    nextCredentialReference: "secret://integration/api-client-1/v2",
    observedAt: "2026-08-01T00:00:00.000Z",
  }), /version conflict/i);
});
