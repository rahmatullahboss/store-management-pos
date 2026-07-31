import { PlatformError } from "../../../packages/foundation/src/errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const RSA_PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth"] as const;
const KEY_ID = /^[A-Za-z0-9._-]{8,80}$/u;
const BASE64_URL = /^[A-Za-z0-9_-]+$/u;
const MAX_KEYSET_LENGTH = 65_536;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_TOKEN_TYPE_LENGTH = 128;
const MAX_VERIFICATION_KEYS = 2;
const MAX_REVOKED_KEYS = 8;
const MIN_RSA_MODULUS_BASE64URL_LENGTH = 342;
const MAX_RSA_MODULUS_BASE64URL_LENGTH = 683;
const RSA_ALGORITHM: RsaHashedImportParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
};

export const STAGING_ASYMMETRIC_TOKEN_ALGORITHM = "RS256";
export const STAGING_INTERNAL_JWKS_PATH = "/internal-identity/.well-known/jwks.json";
export const STAGING_TOKEN_KEYSET_SCHEMA_VERSION = 1;

interface RsaPublicJwk extends JsonWebKey {
  readonly kty: "RSA";
  readonly alg: typeof STAGING_ASYMMETRIC_TOKEN_ALGORITHM;
  readonly use: "sig";
  readonly kid: string;
  readonly n: string;
  readonly e: string;
}

interface RsaPrivateJwk extends RsaPublicJwk {
  readonly d: string;
  readonly p: string;
  readonly q: string;
  readonly dp: string;
  readonly dq: string;
  readonly qi: string;
}

interface SerializedVerificationKey {
  readonly kid: string;
  readonly status: "active" | "previous";
  readonly notBefore: number;
  readonly verifyUntil: number;
  readonly publicJwk: RsaPublicJwk;
}

interface SerializedSigningKey {
  readonly kid: string;
  readonly notBefore: number;
  readonly signUntil: number;
  readonly privateJwk: RsaPrivateJwk;
}

interface ParsedVerificationKey extends SerializedVerificationKey {}

interface ParsedKeyset {
  readonly activeKid: string;
  readonly signingKey: SerializedSigningKey;
  readonly verificationKeys: ReadonlyMap<string, ParsedVerificationKey>;
  readonly revokedKids: ReadonlySet<string>;
}

export interface StagingAsymmetricTokenSigningOptions {
  readonly keyset: string;
  readonly tokenType: string;
  readonly claims: object;
  readonly now?: () => number;
}

export interface StagingAsymmetricTokenVerificationOptions {
  readonly keyset: string;
  readonly tokenType: string;
  readonly token: string;
  readonly now?: () => number;
}

export interface StagingTokenKeysetMetadata {
  readonly schemaVersion: typeof STAGING_TOKEN_KEYSET_SCHEMA_VERSION;
  readonly algorithm: typeof STAGING_ASYMMETRIC_TOKEN_ALGORITHM;
  readonly activeSigningKeyCount: number;
  readonly activeVerificationKeyCount: number;
  readonly previousVerificationKeyCount: number;
  readonly publishedKeyCount: number;
  readonly revokedKeyCount: number;
  readonly privateFieldsPublished: 0;
}

let cachedRaw = "";
let cachedParsed: ParsedKeyset | undefined;

function unavailable(message: string): PlatformError {
  return new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", message, 503);
}

function unauthenticated(message: string): PlatformError {
  return new PlatformError("AUTHENTICATION_REQUIRED", message, 401);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw unavailable(message);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, name: string, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw unavailable(`Staging token ${name} is invalid`);
  }
  return value;
}

function keyId(value: unknown, name: string): string {
  const kid = boundedString(value, name, 80);
  if (!KEY_ID.test(kid)) throw unavailable(`Staging token ${name} is invalid`);
  return kid;
}

function safeTime(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw unavailable(`Staging token ${name} is invalid`);
  }
  return Number(value);
}

function assertNow(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw unavailable("Staging token clock is invalid");
  }
  return value;
}

function keyMaterial(value: unknown, name: string, minimum: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !BASE64_URL.test(value)
  ) {
    throw unavailable(`Staging token ${name} is invalid`);
  }
  return value;
}

function exactKeyOps(value: unknown, expected: "sign" | "verify"): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.length === 1 && value[0] === expected);
}

function privateJwk(value: unknown, kid: string): RsaPrivateJwk {
  const jwk = record(value, "Staging token private JWK is invalid");
  if (
    jwk.kty !== "RSA" ||
    jwk.alg !== STAGING_ASYMMETRIC_TOKEN_ALGORITHM ||
    jwk.use !== "sig" ||
    jwk.kid !== kid ||
    !exactKeyOps(jwk.key_ops, "sign") ||
    jwk.oth !== undefined
  ) {
    throw unavailable("Staging token private JWK is invalid");
  }
  const n = keyMaterial(jwk.n, "RSA modulus", MIN_RSA_MODULUS_BASE64URL_LENGTH, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  const e = keyMaterial(jwk.e, "RSA exponent", 2, 16);
  const d = keyMaterial(jwk.d, "RSA private exponent", 100, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  const p = keyMaterial(jwk.p, "RSA prime p", 100, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  const q = keyMaterial(jwk.q, "RSA prime q", 100, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  const dp = keyMaterial(jwk.dp, "RSA exponent dp", 100, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  const dq = keyMaterial(jwk.dq, "RSA exponent dq", 100, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  const qi = keyMaterial(jwk.qi, "RSA coefficient", 100, MAX_RSA_MODULUS_BASE64URL_LENGTH);
  return {
    ...jwk,
    kty: "RSA",
    alg: STAGING_ASYMMETRIC_TOKEN_ALGORITHM,
    use: "sig",
    kid,
    n,
    e,
    d,
    p,
    q,
    dp,
    dq,
    qi,
  };
}

function publicJwk(value: unknown, kid: string): RsaPublicJwk {
  const jwk = record(value, "Staging token public JWK is invalid");
  if (
    jwk.kty !== "RSA" ||
    jwk.alg !== STAGING_ASYMMETRIC_TOKEN_ALGORITHM ||
    jwk.use !== "sig" ||
    jwk.kid !== kid ||
    !exactKeyOps(jwk.key_ops, "verify") ||
    RSA_PRIVATE_FIELDS.some((field) => jwk[field] !== undefined)
  ) {
    throw unavailable("Staging token public JWK is invalid");
  }
  return {
    kty: "RSA",
    alg: STAGING_ASYMMETRIC_TOKEN_ALGORITHM,
    use: "sig",
    kid,
    n: keyMaterial(jwk.n, "RSA modulus", MIN_RSA_MODULUS_BASE64URL_LENGTH, MAX_RSA_MODULUS_BASE64URL_LENGTH),
    e: keyMaterial(jwk.e, "RSA exponent", 2, 16),
    key_ops: ["verify"],
  };
}

function samePublicMaterial(privateKey: RsaPrivateJwk, publicKey: RsaPublicJwk): boolean {
  return privateKey.kty === publicKey.kty &&
    privateKey.kid === publicKey.kid &&
    privateKey.alg === publicKey.alg &&
    privateKey.use === publicKey.use &&
    privateKey.n === publicKey.n &&
    privateKey.e === publicKey.e;
}

function parseKeyset(raw: string): ParsedKeyset {
  if (raw === cachedRaw && cachedParsed) return cachedParsed;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_KEYSET_LENGTH) {
    throw unavailable("Staging asymmetric token keyset is unavailable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw unavailable("Staging asymmetric token keyset is invalid");
  }
  const root = record(parsed, "Staging asymmetric token keyset is invalid");
  if (root.schemaVersion !== STAGING_TOKEN_KEYSET_SCHEMA_VERSION) {
    throw unavailable("Staging asymmetric token keyset schema is unsupported");
  }
  const activeKid = keyId(root.activeKid, "active kid");
  const signingRecord = record(root.signingKey, "Staging token signing key is invalid");
  const signingKid = keyId(signingRecord.kid, "signing kid");
  const signingNotBefore = safeTime(signingRecord.notBefore, "signing not-before");
  const signUntil = safeTime(signingRecord.signUntil, "signing expiry");
  if (signingKid !== activeKid || signUntil <= signingNotBefore) {
    throw unavailable("Staging token signing-key lifecycle is invalid");
  }
  const signingPrivateJwk = privateJwk(signingRecord.privateJwk, signingKid);

  if (!Array.isArray(root.verificationKeys) || root.verificationKeys.length < 1 || root.verificationKeys.length > MAX_VERIFICATION_KEYS) {
    throw unavailable("Staging token verification key count is invalid");
  }
  const verificationKeys = new Map<string, ParsedVerificationKey>();
  let activeCount = 0;
  let previousCount = 0;
  for (const [index, value] of root.verificationKeys.entries()) {
    const item = record(value, `Staging token verification key ${index + 1} is invalid`);
    const kid = keyId(item.kid, `verification kid ${index + 1}`);
    if (verificationKeys.has(kid)) {
      throw unavailable("Staging token verification key IDs must be unique");
    }
    if (item.status !== "active" && item.status !== "previous") {
      throw unavailable("Staging token verification key status is invalid");
    }
    if (item.status === "active") activeCount += 1;
    else previousCount += 1;
    const notBefore = safeTime(item.notBefore, `verification not-before ${index + 1}`);
    const verifyUntil = safeTime(item.verifyUntil, `verification expiry ${index + 1}`);
    if (verifyUntil <= notBefore) {
      throw unavailable("Staging token verification-key lifecycle is invalid");
    }
    const verificationJwk = publicJwk(item.publicJwk, kid);
    verificationKeys.set(kid, {
      kid,
      status: item.status,
      notBefore,
      verifyUntil,
      publicJwk: verificationJwk,
    });
  }
  if (activeCount !== 1 || previousCount > 1) {
    throw unavailable("Staging token active/previous key lifecycle is invalid");
  }
  const activeVerification = verificationKeys.get(activeKid);
  if (
    !activeVerification ||
    activeVerification.status !== "active" ||
    activeVerification.notBefore !== signingNotBefore ||
    activeVerification.verifyUntil < signUntil + 300 ||
    !samePublicMaterial(signingPrivateJwk, activeVerification.publicJwk)
  ) {
    throw unavailable("Staging token active signing and verification keys do not match");
  }

  if (!Array.isArray(root.revokedKids) || root.revokedKids.length > MAX_REVOKED_KEYS) {
    throw unavailable("Staging token revoked-key list is invalid");
  }
  const revokedKids = new Set<string>();
  for (const [index, value] of root.revokedKids.entries()) {
    const kid = keyId(value, `revoked kid ${index + 1}`);
    if (revokedKids.has(kid)) {
      throw unavailable("Staging token revoked-key IDs must be unique");
    }
    revokedKids.add(kid);
  }
  if (revokedKids.has(activeKid)) {
    throw unavailable("Staging token active key cannot be revoked");
  }

  const keyset: ParsedKeyset = {
    activeKid,
    signingKey: {
      kid: signingKid,
      notBefore: signingNotBefore,
      signUntil,
      privateJwk: signingPrivateJwk,
    },
    verificationKeys,
    revokedKids,
  };
  cachedRaw = raw;
  cachedParsed = keyset;
  return keyset;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string, message: string): Uint8Array {
  if (!BASE64_URL.test(value)) throw unauthenticated(message);
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    if (base64Url(output) !== value) throw new Error("non-canonical");
    return output;
  } catch {
    throw unauthenticated(message);
  }
}

function encodeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") throw new Error("not serializable");
    return base64Url(encoder.encode(json));
  } catch {
    throw unavailable("Staging token JSON encoding failed");
  }
}

function decodeJson(value: string, message: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(decoder.decode(decodeBase64Url(value, message))) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw unauthenticated(message);
  }
}

function tokenType(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TOKEN_TYPE_LENGTH) {
    throw unavailable("Staging token type is invalid");
  }
  return value;
}

function verificationKey(keyset: ParsedKeyset, kid: string, now: number): ParsedVerificationKey {
  if (keyset.revokedKids.has(kid)) {
    throw unauthenticated("Staging token signing key is revoked");
  }
  const key = keyset.verificationKeys.get(kid);
  if (!key) throw unauthenticated("Staging token signing key is unknown");
  if (now < key.notBefore || now > key.verifyUntil) {
    throw unauthenticated("Staging token signing key is outside its verification window");
  }
  return key;
}

export async function issueStagingAsymmetricToken(
  options: StagingAsymmetricTokenSigningOptions,
): Promise<string> {
  const keyset = parseKeyset(options.keyset);
  const now = assertNow((options.now ?? (() => Math.floor(Date.now() / 1_000)))());
  if (now < keyset.signingKey.notBefore || now > keyset.signingKey.signUntil) {
    throw unavailable("Staging token active signing key is outside its signing window");
  }
  if (typeof options.claims !== "object" || options.claims === null || Array.isArray(options.claims)) {
    throw unavailable("Staging token claims are invalid");
  }
  const header = encodeJson({
    alg: STAGING_ASYMMETRIC_TOKEN_ALGORITHM,
    typ: tokenType(options.tokenType),
    kid: keyset.activeKid,
  });
  const payload = encodeJson(options.claims);
  const signingInput = `${header}.${payload}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      keyset.signingKey.privateJwk,
      RSA_ALGORITHM,
      false,
      ["sign"],
    );
  } catch {
    throw unavailable("Staging token private signing key could not be imported");
  }
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput)),
  );
  const token = `${signingInput}.${base64Url(signature)}`;
  if (token.length > MAX_TOKEN_LENGTH) {
    throw unavailable("Staging token exceeds its size limit");
  }
  return token;
}

export async function verifyStagingAsymmetricToken(
  options: StagingAsymmetricTokenVerificationOptions,
): Promise<Record<string, unknown>> {
  if (typeof options.token !== "string" || options.token.length === 0 || options.token.length > MAX_TOKEN_LENGTH) {
    throw unauthenticated("Staging token structure is invalid");
  }
  const segments = options.token.split(".");
  if (segments.length !== 3) throw unauthenticated("Staging token structure is invalid");
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw unauthenticated("Staging token structure is invalid");
  }
  const header = decodeJson(headerSegment, "Staging token header is invalid");
  const headerNames = Object.keys(header).sort();
  if (
    headerNames.length !== 3 ||
    headerNames[0] !== "alg" ||
    headerNames[1] !== "kid" ||
    headerNames[2] !== "typ" ||
    header.alg !== STAGING_ASYMMETRIC_TOKEN_ALGORITHM ||
    header.typ !== tokenType(options.tokenType)
  ) {
    throw unauthenticated("Staging token header is invalid");
  }
  const kid = typeof header.kid === "string" && KEY_ID.test(header.kid)
    ? header.kid
    : "";
  if (!kid) throw unauthenticated("Staging token key ID is invalid");
  const now = assertNow((options.now ?? (() => Math.floor(Date.now() / 1_000)))());
  const keyset = parseKeyset(options.keyset);
  const selected = verificationKey(keyset, kid, now);
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      selected.publicJwk,
      RSA_ALGORITHM,
      false,
      ["verify"],
    );
  } catch {
    throw unavailable("Staging token public verification key could not be imported");
  }
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const decodedSignature = decodeBase64Url(
    signatureSegment,
    "Staging token signature is invalid",
  );
  const signature = new Uint8Array(decodedSignature.byteLength);
  signature.set(decodedSignature);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature.buffer,
    encoder.encode(signingInput),
  );
  if (!verified) throw unauthenticated("Staging token signature is invalid");
  return decodeJson(payloadSegment, "Staging token claims are invalid");
}

function availablePublicKeys(keyset: ParsedKeyset, now: number): readonly RsaPublicJwk[] {
  return [...keyset.verificationKeys.values()]
    .filter((key) => !keyset.revokedKids.has(key.kid) && now <= key.verifyUntil)
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "active" ? -1 : 1;
      return left.kid.localeCompare(right.kid);
    })
    .map((key) => key.publicJwk);
}

export function inspectStagingTokenKeyset(
  raw: string,
  now = Math.floor(Date.now() / 1_000),
): StagingTokenKeysetMetadata {
  const timestamp = assertNow(now);
  const keyset = parseKeyset(raw);
  const available = [...keyset.verificationKeys.values()]
    .filter((key) => !keyset.revokedKids.has(key.kid) && timestamp <= key.verifyUntil);
  return {
    schemaVersion: STAGING_TOKEN_KEYSET_SCHEMA_VERSION,
    algorithm: STAGING_ASYMMETRIC_TOKEN_ALGORITHM,
    activeSigningKeyCount:
      timestamp >= keyset.signingKey.notBefore && timestamp <= keyset.signingKey.signUntil ? 1 : 0,
    activeVerificationKeyCount: available.filter((key) => key.status === "active").length,
    previousVerificationKeyCount: available.filter((key) => key.status === "previous").length,
    publishedKeyCount: available.length,
    revokedKeyCount: keyset.revokedKids.size,
    privateFieldsPublished: 0,
  };
}

function jwksHeaders(cacheControl: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": cacheControl,
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "application/jwk-set+json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}

export async function handleStagingInternalJwks(
  request: Request,
  rawKeyset: string | undefined,
  now = Math.floor(Date.now() / 1_000),
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const headers = jwksHeaders("no-store, max-age=0");
    headers.set("Allow", "GET, HEAD");
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers },
    );
  }
  try {
    if (!rawKeyset) throw unavailable("Staging asymmetric token keyset is unavailable");
    const timestamp = assertNow(now);
    const keys = availablePublicKeys(parseKeyset(rawKeyset), timestamp);
    if (keys.length === 0) throw unavailable("Staging public verification keys are unavailable");
    const body = JSON.stringify({ keys });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
    const etag = `"${base64Url(digest)}"`;
    const headers = jwksHeaders("public, max-age=60, stale-while-revalidate=60");
    headers.set("ETag", etag);
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  } catch {
    const headers = jwksHeaders("no-store, max-age=0");
    return new Response(
      request.method === "HEAD" ? null : JSON.stringify({ error: "IDENTITY_PROVIDER_UNAVAILABLE" }),
      { status: 503, headers },
    );
  }
}
