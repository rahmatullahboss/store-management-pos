import assert from "node:assert/strict";
import test from "node:test";
import {
  handleStagingInternalJwks,
  inspectStagingTokenKeyset,
  issueStagingAsymmetricToken,
  STAGING_ASYMMETRIC_TOKEN_ALGORITHM,
  STAGING_INTERNAL_JWKS_PATH,
  verifyStagingAsymmetricToken,
} from "../../build/apps/api/src/staging-asymmetric-token.js";
import { generateStagingTokenKeyset } from "../../tooling/scripts/staging-token-keyset.mjs";
import {
  decodeJwtHeader,
  generateTestRsaPair,
  replaceJwtHeader,
  serializeTestStagingTokenKeyset,
} from "../helpers/staging-token-keyset.mjs";

const now = 1_800_000_000;
const [oldPair, activePair, unknownPair] = await Promise.all([
  generateTestRsaPair("staging-old-0001"),
  generateTestRsaPair("staging-active-0002"),
  generateTestRsaPair("staging-unknown-0003"),
]);
const activeKeyset = serializeTestStagingTokenKeyset({
  active: activePair,
  previous: oldPair,
  now,
});

test("active RS256 token uses one mandatory kid and verifies exact claims", async () => {
  const token = await issueStagingAsymmetricToken({
    keyset: activeKeyset,
    tokenType: "ozzyl-test+jwt",
    claims: { purpose: "asymmetric-contract" },
    now: () => now,
  });
  assert.deepEqual(decodeJwtHeader(token), {
    alg: "RS256",
    typ: "ozzyl-test+jwt",
    kid: activePair.kid,
  });
  assert.deepEqual(
    await verifyStagingAsymmetricToken({
      keyset: activeKeyset,
      tokenType: "ozzyl-test+jwt",
      token,
      now: () => now + 1,
    }),
    { purpose: "asymmetric-contract" },
  );
  assert.equal(STAGING_ASYMMETRIC_TOKEN_ALGORITHM, "RS256");
  assert.equal(STAGING_INTERNAL_JWKS_PATH, "/internal-identity/.well-known/jwks.json");
});

test("rotation accepts the previous key only during overlap and rejects explicit revocation", async () => {
  const oldKeyset = serializeTestStagingTokenKeyset({ active: oldPair, now });
  const oldToken = await issueStagingAsymmetricToken({
    keyset: oldKeyset,
    tokenType: "ozzyl-test+jwt",
    claims: { generation: "previous" },
    now: () => now,
  });
  assert.deepEqual(
    await verifyStagingAsymmetricToken({
      keyset: activeKeyset,
      tokenType: "ozzyl-test+jwt",
      token: oldToken,
      now: () => now + 1,
    }),
    { generation: "previous" },
  );
  await assert.rejects(
    () => verifyStagingAsymmetricToken({
      keyset: activeKeyset,
      tokenType: "ozzyl-test+jwt",
      token: oldToken,
      now: () => now + 601,
    }),
    /outside its verification window/u,
  );
  const revokedKeyset = serializeTestStagingTokenKeyset({
    active: activePair,
    previous: oldPair,
    now,
    revokedKids: [oldPair.kid],
  });
  await assert.rejects(
    () => verifyStagingAsymmetricToken({
      keyset: revokedKeyset,
      tokenType: "ozzyl-test+jwt",
      token: oldToken,
      now: () => now + 1,
    }),
    /revoked/u,
  );
});

test("unknown kid, algorithm confusion, extra protected headers and signature tampering fail closed", async () => {
  const token = await issueStagingAsymmetricToken({
    keyset: activeKeyset,
    tokenType: "ozzyl-test+jwt",
    claims: { purpose: "header-hardening" },
    now: () => now,
  });
  for (const [header, pattern] of [
    [{ alg: "RS256", typ: "ozzyl-test+jwt", kid: unknownPair.kid }, /unknown/u],
    [{ alg: "HS256", typ: "ozzyl-test+jwt", kid: activePair.kid }, /header is invalid/u],
    [{ alg: "RS256", typ: "ozzyl-test+jwt", kid: activePair.kid, jku: "https://attacker.invalid/jwks" }, /header is invalid/u],
  ]) {
    await assert.rejects(
      () => verifyStagingAsymmetricToken({
        keyset: activeKeyset,
        tokenType: "ozzyl-test+jwt",
        token: replaceJwtHeader(token, header),
        now: () => now + 1,
      }),
      pattern,
    );
  }
  const [encodedHeader, payload, signature] = token.split(".");
  const tamperedSignature = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  await assert.rejects(
    () => verifyStagingAsymmetricToken({
      keyset: activeKeyset,
      tokenType: "ozzyl-test+jwt",
      token: `${encodedHeader}.${payload}.${tamperedSignature}`,
      now: () => now + 1,
    }),
    /signature is invalid/u,
  );
});

test("public JWKS is bounded, cacheable and never publishes RSA private fields", async () => {
  const metadata = inspectStagingTokenKeyset(activeKeyset, now);
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    algorithm: "RS256",
    activeSigningKeyCount: 1,
    activeVerificationKeyCount: 1,
    previousVerificationKeyCount: 1,
    publishedKeyCount: 2,
    revokedKeyCount: 0,
    privateFieldsPublished: 0,
  });
  const request = new Request(`https://staging.example.test${STAGING_INTERNAL_JWKS_PATH}`);
  const response = await handleStagingInternalJwks(request, activeKeyset, now);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("cache-control") ?? "", /max-age=60/u);
  assert.equal(response.headers.get("content-type"), "application/jwk-set+json; charset=utf-8");
  const body = await response.json();
  assert.equal(body.keys.length, 2);
  for (const key of body.keys) {
    assert.equal(key.alg, "RS256");
    assert.deepEqual(key.key_ops, ["verify"]);
    for (const field of ["d", "p", "q", "dp", "dq", "qi", "oth"]) {
      assert.equal(key[field], undefined, `${field} leaked from public JWKS`);
    }
  }
  const etag = response.headers.get("etag");
  assert.ok(etag);
  const notModified = await handleStagingInternalJwks(
    new Request(request.url, { headers: { "if-none-match": etag } }),
    activeKeyset,
    now,
  );
  assert.equal(notModified.status, 304);
  const head = await handleStagingInternalJwks(
    new Request(request.url, { method: "HEAD" }),
    activeKeyset,
    now,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const method = await handleStagingInternalJwks(
    new Request(request.url, { method: "POST" }),
    activeKeyset,
    now,
  );
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");
  const unavailable = await handleStagingInternalJwks(request, undefined, now);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "IDENTITY_PROVIDER_UNAVAILABLE" });
});

test("generated deployment keyset retains private material only in the secret payload", async () => {
  const generated = await generateStagingTokenKeyset({ now });
  assert.deepEqual(generated.evidence, {
    schemaVersion: 1,
    algorithm: "RS256",
    activeSigningKeyCount: 1,
    activeVerificationKeyCount: 1,
    previousVerificationKeyCount: 1,
    publishedKeyCount: 2,
    revokedKeyCount: 0,
    rotationOverlapSeconds: 600,
    privateFieldsPublished: 0,
    privateKeyPersistedInArtifacts: false,
    keysetPersistedInArtifacts: false,
  });
  const parsed = JSON.parse(generated.serialized);
  assert.equal(parsed.signingKey.privateJwk.d.length > 100, true);
  for (const key of parsed.verificationKeys) {
    assert.equal(key.publicJwk.d, undefined);
  }
  assert.equal(inspectStagingTokenKeyset(generated.serialized, now).publishedKeyCount, 2);
});

test("malformed, weak, mismatched and duplicate keysets fail before token issuance", async () => {
  const base = JSON.parse(activeKeyset);
  const invalid = [
    { ...base, schemaVersion: 2 },
    { ...base, verificationKeys: [base.verificationKeys[0], base.verificationKeys[0]] },
    { ...base, activeKid: oldPair.kid },
    {
      ...base,
      signingKey: {
        ...base.signingKey,
        privateJwk: { ...base.signingKey.privateJwk, n: "AQAB" },
      },
    },
    {
      ...base,
      verificationKeys: base.verificationKeys.map((key, index) =>
        index === 0
          ? { ...key, publicJwk: { ...key.publicJwk, d: base.signingKey.privateJwk.d } }
          : key),
    },
  ];
  for (const keyset of invalid) {
    await assert.rejects(
      () => issueStagingAsymmetricToken({
        keyset: JSON.stringify(keyset),
        tokenType: "ozzyl-test+jwt",
        claims: { invalid: true },
        now: () => now,
      }),
      /Staging token|keyset/u,
    );
  }
});
