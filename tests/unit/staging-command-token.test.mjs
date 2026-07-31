import assert from "node:assert/strict";
import test from "node:test";
import {
  issueStagingCommandToken,
  StagingCommandTokenVerifier,
  STAGING_COMMAND_TOKEN_LIFETIME_SECONDS,
} from "../../build/apps/api/src/staging-command-token.js";
import {
  decodeJwtHeader,
  generateTestRsaPair,
  serializeTestStagingTokenKeyset,
} from "../helpers/staging-token-keyset.mjs";

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
  permissions: ["inventory.stock.read"],
};

const now = 1_800_000_000;
const pair = await generateTestRsaPair("staging-command-0001");
const keyset = serializeTestStagingTokenKeyset({ active: pair, now });
const issuer = "https://staging.example.test/internal-identity";
const audience = "store-management-api-staging";

test("MFA command token is RS256, kid-bound and carries only reservation assurance", async () => {
  const token = await issueStagingCommandToken({
    keyset,
    issuer,
    audience,
    context,
    now: () => now,
  });
  assert.deepEqual(decodeJwtHeader(token), {
    alg: "RS256",
    typ: "ozzyl-staging-command+jwt",
    kid: pair.kid,
  });
  const verifier = new StagingCommandTokenVerifier({
    keyset,
    issuer,
    audience,
    freshContext: async () => context,
    now: () => now + 1,
  });
  const identity = await verifier.verify(token);
  assert.deepEqual(identity.permissions, ["inventory.reservation.manage"]);
  assert.deepEqual(identity.authenticationMethods, ["pwd", "otp"]);
  assert.equal(identity.authenticationContext, "urn:ozzyl:staging:mfa-step-up");
  assert.equal(identity.warehouseId, context.scope.warehouseId);
  assert.equal(STAGING_COMMAND_TOKEN_LIFETIME_SECONDS, 60);
});

test("tampered, expired and resource-drifted command tokens fail closed", async () => {
  const token = await issueStagingCommandToken({
    keyset,
    issuer,
    audience,
    context,
    now: () => now,
  });
  const [header, payload, signature] = token.split(".");
  assert.ok(header && payload && signature);
  const tampered = `${header}.${payload}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  const verifier = new StagingCommandTokenVerifier({
    keyset,
    issuer,
    audience,
    freshContext: async () => context,
    now: () => now + 1,
  });
  await assert.rejects(() => verifier.verify(tampered), /signature is invalid/u);

  const expired = new StagingCommandTokenVerifier({
    keyset,
    issuer,
    audience,
    freshContext: async () => context,
    now: () => now + 61,
  });
  await assert.rejects(() => expired.verify(token), /lifetime is invalid/u);

  const drifted = new StagingCommandTokenVerifier({
    keyset,
    issuer,
    audience,
    freshContext: async () => ({
      ...context,
      scope: {
        ...context.scope,
        warehouseId: "018f0000-0000-7000-8000-000000000499",
      },
    }),
    now: () => now + 1,
  });
  await assert.rejects(
    () => drifted.verify(token),
    /no longer matches database scope/u,
  );
});

test("legacy Worker binding carries the same asymmetric command keyset", async () => {
  const token = await issueStagingCommandToken({
    secret: keyset,
    issuer,
    audience,
    context,
    now: () => now,
  });
  assert.equal(decodeJwtHeader(token).alg, "RS256");
});
