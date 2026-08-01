export async function generateTestRsaPair(kid) {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2_048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const [privateJwk, publicJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", keys.privateKey),
    crypto.subtle.exportKey("jwk", keys.publicKey),
  ]);
  return {
    kid,
    privateJwk: {
      ...privateJwk,
      kid,
      alg: "RS256",
      use: "sig",
      key_ops: ["sign"],
    },
    publicJwk: {
      ...publicJwk,
      kid,
      alg: "RS256",
      use: "sig",
      key_ops: ["verify"],
    },
  };
}

export function serializeTestStagingTokenKeyset({
  active,
  previous = null,
  now,
  revokedKids = [],
  signUntil = now + 3_600,
  activeVerifyUntil = signUntil + 300,
  previousVerifyUntil = now + 600,
}) {
  const notBefore = now - 60;
  return JSON.stringify({
    schemaVersion: 1,
    activeKid: active.kid,
    signingKey: {
      kid: active.kid,
      notBefore,
      signUntil,
      privateJwk: active.privateJwk,
    },
    verificationKeys: [
      {
        kid: active.kid,
        status: "active",
        notBefore,
        verifyUntil: activeVerifyUntil,
        publicJwk: active.publicJwk,
      },
      ...(previous
        ? [{
            kid: previous.kid,
            status: "previous",
            notBefore: now - 7_200,
            verifyUntil: previousVerifyUntil,
            publicJwk: previous.publicJwk,
          }]
        : []),
    ],
    revokedKids,
  });
}

export function decodeJwtHeader(token) {
  const [header] = token.split(".");
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

export function replaceJwtHeader(token, header) {
  const [, payload, signature] = token.split(".");
  return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${payload}.${signature}`;
}
