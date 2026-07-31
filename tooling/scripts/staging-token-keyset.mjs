import { randomBytes, webcrypto } from "node:crypto";

const ALGORITHM = "RS256";
const KEYSET_SCHEMA_VERSION = 1;
const ACTIVE_SIGNING_SECONDS = 3_600;
const MAX_TOKEN_LIFETIME_SECONDS = 300;
const PREVIOUS_OVERLAP_SECONDS = 600;
const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth"];

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Staging token keyset time must be a positive safe integer");
  }
  return value;
}

function kid(prefix) {
  return `${prefix}-${randomBytes(18).toString("base64url")}`;
}

function publicJwk(value, keyId) {
  return {
    kty: "RSA",
    alg: ALGORITHM,
    use: "sig",
    kid: keyId,
    n: value.n,
    e: value.e,
    key_ops: ["verify"],
  };
}

function privateJwk(value, keyId) {
  return {
    ...value,
    kty: "RSA",
    alg: ALGORITHM,
    use: "sig",
    kid: keyId,
    key_ops: ["sign"],
  };
}

async function generatePair() {
  return await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2_048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

export async function generateStagingTokenKeyset(options = {}) {
  const now = timestamp(options.now ?? Math.floor(Date.now() / 1_000));
  const [activePair, previousPair] = await Promise.all([
    generatePair(),
    generatePair(),
  ]);
  const activeKid = kid("stg-active");
  const previousKid = kid("stg-previous");
  const [activePrivate, activePublic, previousPublic] = await Promise.all([
    webcrypto.subtle.exportKey("jwk", activePair.privateKey),
    webcrypto.subtle.exportKey("jwk", activePair.publicKey),
    webcrypto.subtle.exportKey("jwk", previousPair.publicKey),
  ]);
  const notBefore = now - 60;
  const signUntil = now + ACTIVE_SIGNING_SECONDS;
  const keyset = {
    schemaVersion: KEYSET_SCHEMA_VERSION,
    activeKid,
    signingKey: {
      kid: activeKid,
      notBefore,
      signUntil,
      privateJwk: privateJwk(activePrivate, activeKid),
    },
    verificationKeys: [
      {
        kid: activeKid,
        status: "active",
        notBefore,
        verifyUntil: signUntil + MAX_TOKEN_LIFETIME_SECONDS,
        publicJwk: publicJwk(activePublic, activeKid),
      },
      {
        kid: previousKid,
        status: "previous",
        notBefore: now - 7_200,
        verifyUntil: now + PREVIOUS_OVERLAP_SECONDS,
        publicJwk: publicJwk(previousPublic, previousKid),
      },
    ],
    revokedKids: [],
  };
  const serialized = JSON.stringify(keyset);
  if (serialized.length > 65_536) {
    throw new Error("Generated staging token keyset exceeds the size limit");
  }
  const publicPrivateFieldCount = keyset.verificationKeys.reduce(
    (total, key) => total + PRIVATE_FIELDS.filter((field) => key.publicJwk[field] !== undefined).length,
    0,
  );
  if (publicPrivateFieldCount !== 0) {
    throw new Error("Generated staging public verification keys contain private fields");
  }
  return {
    serialized,
    evidence: Object.freeze({
      schemaVersion: KEYSET_SCHEMA_VERSION,
      algorithm: ALGORITHM,
      activeSigningKeyCount: 1,
      activeVerificationKeyCount: 1,
      previousVerificationKeyCount: 1,
      publishedKeyCount: 2,
      revokedKeyCount: 0,
      rotationOverlapSeconds: PREVIOUS_OVERLAP_SECONDS,
      privateFieldsPublished: 0,
      privateKeyPersistedInArtifacts: false,
      keysetPersistedInArtifacts: false,
    }),
  };
}
