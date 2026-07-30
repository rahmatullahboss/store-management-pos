import assert from "node:assert/strict";
import test from "node:test";
import {
  issueStagingInternalToken,
  StagingInternalTokenVerifier,
  STAGING_INTERNAL_TOKEN_LIFETIME_SECONDS,
} from "../../build/apps/api/src/staging-internal-token.js";
import { createTokenVerifier } from "../../build/apps/api/src/token-verifier.js";

const context = {
  sessionId: "018f0000-0000-7000-8000-000000009002",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: {
    id: "018f0000-0000-7000-8000-000000009001",
    name: "Staging User",
    email: "staging.user@example.invalid",
  },
  tenant: {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Synthetic Beta Retail",
  },
  membershipId: "018f0000-0000-7000-8000-000000009003",
  role: "staging-read-only",
  scope: {
    legalEntityId: "018f0000-0000-7000-8000-000000000202",
    storeId: "018f0000-0000-7000-8000-000000000302",
    warehouseId: "018f0000-0000-7000-8000-000000000402",
    registerId: "018f0000-0000-7000-8000-000000000502",
  },
  permissions: [
    "catalog.product.read",
    "inventory.stock.read",
    "procurement.purchase_order.read",
    "procurement.supplier.read",
  ],
};

const secret = "s".repeat(64);
const issuer = "https://staging.example.test/internal-identity";
const audience = "store-management-api-staging";

test("internal token is audience-bound, short-lived and resolves a verified identity", async () => {
  const now = 1_800_000_000;
  const token = await issueStagingInternalToken({
    secret,
    issuer,
    audience,
    context,
    now: () => now,
  });
  const verifier = new StagingInternalTokenVerifier({
    secret,
    issuer,
    audience,
    freshContext: async () => context,
    now: () => now + 1,
  });
  const identity = await verifier.verify(token);
  assert.equal(identity.userId, context.user.id);
  assert.equal(identity.tenantId, context.tenant.id);
  assert.equal(identity.sessionId, context.sessionId);
  assert.deepEqual(identity.permissions, [...context.permissions].sort());
  assert.equal(identity.warehouseId, context.scope.warehouseId);
  assert.equal(STAGING_INTERNAL_TOKEN_LIFETIME_SECONDS, 300);
});

test("tampered and expired internal tokens fail closed", async () => {
  const now = 1_800_000_000;
  const token = await issueStagingInternalToken({
    secret,
    issuer,
    audience,
    context,
    now: () => now,
  });
  const verifier = new StagingInternalTokenVerifier({
    secret,
    issuer,
    audience,
    freshContext: async () => context,
    now: () => now + 1,
  });
  const [header, claims, signature] = token.split(".");
  assert.ok(header && claims && signature);
  const first = signature[0];
  const tamperedSignature = `${first === "a" ? "b" : "a"}${signature.slice(1)}`;
  const tampered = `${header}.${claims}.${tamperedSignature}`;
  await assert.rejects(() => verifier.verify(tampered), /signature is invalid/u);

  const expiredVerifier = new StagingInternalTokenVerifier({
    secret,
    issuer,
    audience,
    freshContext: async () => context,
    now: () => now + 301,
  });
  await assert.rejects(() => expiredVerifier.verify(token), /lifetime is invalid/u);
});

test("revoked session and changed database permissions invalidate an issued token", async () => {
  const now = 1_800_000_000;
  const token = await issueStagingInternalToken({
    secret,
    issuer,
    audience,
    context,
    now: () => now,
  });
  const revoked = new StagingInternalTokenVerifier({
    secret,
    issuer,
    audience,
    freshContext: async () => null,
    now: () => now + 1,
  });
  await assert.rejects(() => revoked.verify(token), /no longer active/u);

  const changed = new StagingInternalTokenVerifier({
    secret,
    issuer,
    audience,
    freshContext: async () => ({
      ...context,
      permissions: ["inventory.stock.read"],
    }),
    now: () => now + 1,
  });
  await assert.rejects(
    () => changed.verify(token),
    /no longer matches database authorization context/u,
  );
});

test("non-read permissions cannot be issued", async () => {
  await assert.rejects(
    () =>
      issueStagingInternalToken({
        secret,
        issuer,
        audience,
        context: {
          ...context,
          permissions: [...context.permissions, "inventory.stock.post"],
        },
      }),
    /non-read permission/u,
  );
});

test("in-process verifier injection is staging-only", () => {
  const injected = { verify: async () => ({ userId: "u", tenantId: "t", permissions: [] }) };
  const fakeDatabase = {};
  assert.equal(
    createTokenVerifier(
      { APP_ENV: "staging", STAGING_TOKEN_VERIFIER: injected },
      fakeDatabase,
    ),
    injected,
  );
  assert.throws(
    () =>
      createTokenVerifier(
        { APP_ENV: "production", STAGING_TOKEN_VERIFIER: injected },
        fakeDatabase,
      ),
    /OIDC identity provider configuration is incomplete/u,
  );
});
