import test from "node:test";
import assert from "node:assert/strict";
import { OidcTokenVerifier } from "../../build/apps/api/src/oidc.js";

const now = 1_800_000_000;
const issuer = "https://identity.example.test";
const audience = "store-management-api";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function fixture() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  publicJwk.kid = "key-1";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  async function token(overrides = {}, headerOverrides = {}) {
    const header = { alg: "RS256", kid: "key-1", typ: "at+jwt", ...headerOverrides };
    const claims = {
      iss: issuer,
      sub: "provider-subject-001",
      user_id: "018f0000-0000-7000-8000-000000000101",
      aud: audience,
      exp: now + 600,
      iat: now - 30,
      sid: "session-001",
      tenant_id: "018f0000-0000-7000-8000-000000000001",
      permissions: ["platform.reference.read"],
      scope: "platform.reference.create",
      amr: ["pwd", "mfa"],
      acr: "urn:example:aal2",
      device_id: "018f0000-0000-7000-8000-000000000701",
      ...overrides,
    };
    const encodedHeader = base64Url(JSON.stringify(header));
    const encodedClaims = base64Url(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signingInput));
    return `${signingInput}.${base64Url(signature)}`;
  }

  const fetcher = async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "cache-control": "max-age=300", "content-type": "application/json" } });
  return { token, fetcher };
}

function stateStore(revoked = false) {
  return { calls: [], async isRevoked(input) { this.calls.push(input); return revoked; } };
}

test("OIDC verifier validates RS256, claims, MFA, scopes and revocation state", async () => {
  const { token, fetcher } = await fixture();
  const state = stateStore(false);
  const verifier = new OidcTokenVerifier({ issuer, audience, jwksUri: `${issuer}/jwks`, now: () => now, fetcher }, state);
  const identity = await verifier.verify(await token());
  assert.equal(identity.tenantId, "018f0000-0000-7000-8000-000000000001");
  assert.equal(identity.identitySubject, "provider-subject-001");
  assert.equal(identity.userId, "018f0000-0000-7000-8000-000000000101");
  assert.equal(identity.sessionId, "session-001");
  assert.deepEqual(identity.permissions, ["platform.reference.create", "platform.reference.read"]);
  assert.deepEqual(state.calls, [{ tenantId: identity.tenantId, userId: identity.userId, sessionId: "session-001", deviceId: identity.deviceId }]);
});

test("OIDC verifier rejects algorithm confusion, wrong audience and missing MFA", async () => {
  const { token, fetcher } = await fixture();
  const verifier = new OidcTokenVerifier({ issuer, audience, jwksUri: `${issuer}/jwks`, now: () => now, fetcher }, stateStore(false));
  const wrongAlgorithm = await token({}, { alg: "none" });
  await assert.rejects(() => verifier.verify(wrongAlgorithm), /algorithm is not allowed/);
  const wrongAudience = await token({ aud: "other-api" });
  const missingMfa = await token({ amr: ["pwd"], acr: "urn:example:aal1" });
  await assert.rejects(() => verifier.verify(wrongAudience), /audience is invalid/);
  await assert.rejects(() => verifier.verify(missingMfa), /Multi-factor authentication is required/);
});

test("OIDC verifier fails closed for revoked sessions and stale tokens", async () => {
  const { token, fetcher } = await fixture();
  const revoked = new OidcTokenVerifier({ issuer, audience, jwksUri: `${issuer}/jwks`, now: () => now, fetcher }, stateStore(true));
  const validToken = await token();
  await assert.rejects(() => revoked.verify(validToken), /revoked/);
  const active = new OidcTokenVerifier({ issuer, audience, jwksUri: `${issuer}/jwks`, now: () => now, fetcher, maximumTokenAgeSeconds: 300 }, stateStore(false));
  const staleToken = await token({ iat: now - 1_000 });
  await assert.rejects(() => active.verify(staleToken), /issue time is invalid/);
});
