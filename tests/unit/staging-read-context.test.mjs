import assert from "node:assert/strict";
import test from "node:test";
import stagingEntry from "../../build/apps/api/src/staging-entry.js";

const context = {
  sessionId: "018f0000-0000-7000-8000-000000009002",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: {
    id: "018f0000-0000-7000-8000-000000009001",
    name: "Staging User",
    email: "staging.user@example.com",
  },
  tenant: {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Synthetic Beta Retail",
  },
  membershipId: "018f0000-0000-7000-8000-000000009003",
  role: "synthetic-store-manager",
  scope: {
    legalEntityId: "018f0000-0000-7000-8000-000000000202",
    storeId: "018f0000-0000-7000-8000-000000000302",
    warehouseId: "018f0000-0000-7000-8000-000000000402",
    registerId: "018f0000-0000-7000-8000-000000000502",
  },
  permissions: [
    "catalog.product.read",
    "inventory.stock.read",
    "pricing.discount.approve",
    "pricing.promotion.manage",
  ],
};

function environment(resolver) {
  return {
    DATABASE_URL: "postgresql://unused.invalid/neondb",
    APP_ENV: "staging-test",
    REGION: "test",
    STAGING_GIT_SHA: "0123456789abcdef",
    STAGING_AUTH_REQUIRED: "1",
    STAGING_READ_CONTEXT_RESOLVER: resolver,
  };
}

async function request(path, init, resolver = async () => context) {
  return await stagingEntry.fetch(
    new Request(`https://staging.example.test${path}`, init),
    environment(resolver),
  );
}

test("RBAC context requires the opaque custom session cookie", async () => {
  const response = await request("/auth/context");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
});

test("RBAC context returns database-resolved identity, role, scope and assigned permissions", async () => {
  let observedHash = "";
  const response = await request(
    "/auth/context",
    { headers: { Cookie: `ozzyl_staging_session=${"a".repeat(43)}` } },
    async (tokenHash) => {
      observedHash = tokenHash;
      return context;
    },
  );
  assert.equal(response.status, 200);
  assert.match(observedHash, /^[A-Za-z0-9_-]{43}$/u);
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.authorizationMode, "database-resolved-rbac");
  assert.equal(body.context.role, "synthetic-store-manager");
  assert.equal(body.context.scope.storeId, context.scope.storeId);
  assert.deepEqual(body.context.permissions, context.permissions);
  assert.ok(body.context.permissions.includes("pricing.discount.approve"));
  assert.ok(body.context.permissions.includes("pricing.promotion.manage"));
});

test("missing or ambiguous active role context fails closed", async () => {
  const response = await request(
    "/auth/context",
    { headers: { Cookie: `ozzyl_staging_session=${"a".repeat(43)}` } },
    async () => null,
  );
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "PERMISSION_DENIED");
});

test("RBAC context is GET and HEAD only", async () => {
  const head = await request("/auth/context", {
    method: "HEAD",
    headers: { Cookie: `ozzyl_staging_session=${"a".repeat(43)}` },
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const post = await request("/auth/context", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

test("persistent status advertises database RBAC, MFA-gated controlled reservations and bounded recovery", async () => {
  const response = await request("/staging/status");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "healthy",
    service: "persistent-admin-pos-staging",
    version: "0123456789ab",
    database: "dedicated-neon-staging",
    browserMode: "controlled-reservation-release-candidate",
    dataMode: "deterministic-synthetic-module-records",
    authentication: "custom-auth-required",
    authorization: "database-resolved-rbac-plus-mfa-step-up",
    mfa: "encrypted-totp-current-password-step-up",
    accountRecovery: "hashed-single-use-token-lifecycle",
    productionEmailDelivery: false,
    protectedReadTransport: "short-lived-rs256-internal-token",
    internalTokenSigning: "RS256",
    internalTokenKidRequired: true,
    internalTokenJwksPath: "/internal-identity/.well-known/jwks.json",
    internalTokenKeyLifecycle: "active-plus-previous-overlap-and-revocation",
    internalTokenPrivateKeyPublished: false,
    internalReadTokenLifetimeSeconds: 300,
    internalCommandTokenLifetimeSeconds: 60,
    stepUpGrantLifetimeSeconds: 300,
    passwordRecoveryLifetimeSeconds: 900,
    emailVerificationLifetimeSeconds: 86_400,
    controlledWrites: [
      "inventory.reservation.create",
      "inventory.reservation.release",
    ],
    authoritativeWrites: false,
  });
});