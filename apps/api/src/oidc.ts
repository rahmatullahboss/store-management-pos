import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { assertUuid } from "../../../packages/foundation/src/ids.js";
import type { TokenVerifier, VerifiedIdentity } from "./auth.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface JwtHeader {
  readonly alg: string;
  readonly kid: string;
  readonly typ: string;
}

interface JwtClaims extends Record<string, unknown> {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly nbf?: number;
  readonly jti?: string;
  readonly sid?: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly permissions?: readonly string[];
  readonly scope?: string;
  readonly amr?: readonly string[];
  readonly acr?: string;
  readonly legal_entity_id?: string;
  readonly store_id?: string;
  readonly warehouse_id?: string;
  readonly register_id?: string;
  readonly device_id?: string;
  readonly impersonator_id?: string;
}

interface JsonWebKeySet {
  readonly keys: readonly JsonWebKey[];
}

export interface IdentitySecurityStateInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly deviceId?: string;
}

export interface IdentitySecurityStateStore {
  isRevoked(input: IdentitySecurityStateInput): Promise<boolean>;
}

export class NeonIdentitySecurityStateStore implements IdentitySecurityStateStore {
  constructor(private readonly database: NeonDatabase) {}

  async isRevoked(input: IdentitySecurityStateInput): Promise<boolean> {
    const rows = await this.database.httpQuery<{ revoked: boolean }>(
      "SELECT platform.is_identity_revoked($1::uuid, $2::uuid, $3::text, $4::uuid) AS revoked",
      [input.tenantId, input.userId, input.sessionId, input.deviceId ?? null],
    );
    const row = rows[0];
    if (!row || typeof row.revoked !== "boolean") {
      throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "Identity security state could not be verified", 503);
    }
    return row.revoked;
  }
}

export interface OidcVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly requireMfa?: boolean;
  readonly acceptedMfaAcrValues?: readonly string[];
  readonly acceptedTokenTypes?: readonly string[];
  readonly clockToleranceSeconds?: number;
  readonly maximumTokenAgeSeconds?: number;
  readonly now?: () => number;
  readonly fetcher?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token encoding is invalid", 401);
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token encoding is invalid", 401);
  }
}

function parseJsonSegment(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(decoder.decode(decodeBase64Url(value))) as unknown;
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token JSON is invalid", 401);
  }
}

function integerClaim(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) throw new PlatformError("AUTHENTICATION_REQUIRED", `Bearer token ${name} claim is invalid`, 401);
  return value as number;
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new PlatformError("AUTHENTICATION_REQUIRED", `Bearer token ${name} claim is invalid`, 401);
  return value;
}

function uuidClaim(value: unknown, name: string): string {
  try { return assertUuid(stringClaim(value, name), name); } catch { throw new PlatformError("AUTHENTICATION_REQUIRED", `Bearer token ${name} claim is invalid`, 401); }
}

function optionalUuid(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return uuidClaim(value, name);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) return undefined;
  return value as readonly string[];
}

function parseHeader(value: Record<string, unknown>, acceptedTypes: ReadonlySet<string>): JwtHeader {
  const alg = stringClaim(value.alg, "alg");
  const kid = stringClaim(value.kid, "kid");
  const typ = stringClaim(value.typ, "typ");
  if (alg !== "RS256") throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token algorithm is not allowed", 401);
  if (!acceptedTypes.has(typ)) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token type is not allowed", 401);
  return { alg, kid, typ };
}

function parseClaims(value: Record<string, unknown>): JwtClaims {
  const audienceValue = value.aud;
  const audience = typeof audienceValue === "string" ? audienceValue : stringArray(audienceValue);
  if (!audience) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token aud claim is invalid", 401);
  return {
    ...value,
    iss: stringClaim(value.iss, "iss"),
    sub: stringClaim(value.sub, "sub"),
    aud: audience,
    exp: integerClaim(value.exp, "exp"),
    iat: integerClaim(value.iat, "iat"),
    ...(value.nbf === undefined ? {} : { nbf: integerClaim(value.nbf, "nbf") }),
    ...(optionalString(value.jti) ? { jti: optionalString(value.jti)! } : {}),
    ...(optionalString(value.sid) ? { sid: optionalString(value.sid)! } : {}),
    tenant_id: uuidClaim(value.tenant_id, "tenant_id"),
    user_id: uuidClaim(value.user_id, "user_id"),
    ...(stringArray(value.permissions) ? { permissions: stringArray(value.permissions)! } : {}),
    ...(optionalString(value.scope) ? { scope: optionalString(value.scope)! } : {}),
    ...(stringArray(value.amr) ? { amr: stringArray(value.amr)! } : {}),
    ...(optionalString(value.acr) ? { acr: optionalString(value.acr)! } : {}),
    ...(optionalUuid(value.legal_entity_id, "legal_entity_id") ? { legal_entity_id: optionalUuid(value.legal_entity_id, "legal_entity_id")! } : {}),
    ...(optionalUuid(value.store_id, "store_id") ? { store_id: optionalUuid(value.store_id, "store_id")! } : {}),
    ...(optionalUuid(value.warehouse_id, "warehouse_id") ? { warehouse_id: optionalUuid(value.warehouse_id, "warehouse_id")! } : {}),
    ...(optionalUuid(value.register_id, "register_id") ? { register_id: optionalUuid(value.register_id, "register_id")! } : {}),
    ...(optionalUuid(value.device_id, "device_id") ? { device_id: optionalUuid(value.device_id, "device_id")! } : {}),
    ...(optionalUuid(value.impersonator_id, "impersonator_id") ? { impersonator_id: optionalUuid(value.impersonator_id, "impersonator_id")! } : {}),
  };
}

function cacheSeconds(headers: Headers): number {
  const match = headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : 300;
  return Number.isFinite(seconds) ? Math.max(60, Math.min(seconds, 3_600)) : 300;
}

class JwksCache {
  private keys = new Map<string, JsonWebKey>();
  private expiresAt = 0;

  constructor(private readonly uri: URL, private readonly fetcher: typeof fetch, private readonly now: () => number) {}

  async key(kid: string): Promise<JsonWebKey> {
    if (this.now() >= this.expiresAt || !this.keys.has(kid)) await this.refresh();
    const key = this.keys.get(kid);
    if (!key) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token signing key is unknown", 401);
    return key;
  }

  private async refresh(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(this.uri, { headers: { accept: "application/json" }, redirect: "error" });
    } catch {
      throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "Identity signing keys are unavailable", 503);
    }
    if (!response.ok) throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "Identity signing keys are unavailable", 503);
    const body = await response.json() as unknown;
    if (!isRecord(body) || !Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 64) {
      throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "Identity signing key set is invalid", 503);
    }
    const next = new Map<string, JsonWebKey>();
    for (const candidate of (body as unknown as JsonWebKeySet).keys) {
      if (!isRecord(candidate)) continue;
      const kid = optionalString(candidate.kid);
      if (!kid || candidate.kty !== "RSA" || (candidate.use !== undefined && candidate.use !== "sig") || (candidate.alg !== undefined && candidate.alg !== "RS256")) continue;
      if (Array.isArray(candidate.key_ops) && !candidate.key_ops.includes("verify")) continue;
      next.set(kid, candidate);
    }
    if (next.size === 0) throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "Identity signing key set has no usable keys", 503);
    this.keys = next;
    this.expiresAt = this.now() + cacheSeconds(response.headers);
  }
}

export class OidcTokenVerifier implements TokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly acceptedTypes: ReadonlySet<string>;
  private readonly acceptedMfaAcrValues: ReadonlySet<string>;
  private readonly requireMfa: boolean;
  private readonly clockToleranceSeconds: number;
  private readonly maximumTokenAgeSeconds: number;
  private readonly now: () => number;
  private readonly jwks: JwksCache;

  constructor(options: OidcVerifierOptions, private readonly securityState: IdentitySecurityStateStore) {
    let issuerUrl: URL;
    try { issuerUrl = new URL(options.issuer); } catch { throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "OIDC issuer must be a valid HTTPS URL", 503); }
    if (issuerUrl.protocol !== "https:" || issuerUrl.search || issuerUrl.hash) throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "OIDC issuer must be a valid HTTPS URL", 503);
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.requireMfa = options.requireMfa ?? true;
    this.acceptedTypes = new Set(options.acceptedTokenTypes ?? ["at+jwt", "JWT"]);
    this.acceptedMfaAcrValues = new Set(options.acceptedMfaAcrValues ?? []);
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 60;
    this.maximumTokenAgeSeconds = options.maximumTokenAgeSeconds ?? 3_600;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    const jwksUri = new URL(options.jwksUri);
    if (jwksUri.protocol !== "https:") throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "OIDC JWKS URI must use HTTPS", 503);
    if (!this.audience) throw new PlatformError("IDENTITY_PROVIDER_UNAVAILABLE", "OIDC audience is required", 503);
    this.jwks = new JwksCache(jwksUri, options.fetcher ?? fetch, this.now);
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    if (token.length > 16_384) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token is too large", 401);
    const segments = token.split(".");
    if (segments.length !== 3) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token structure is invalid", 401);
    const [encodedHeader, encodedClaims, encodedSignature] = segments;
    if (!encodedHeader || !encodedClaims || !encodedSignature) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token structure is invalid", 401);

    const header = parseHeader(parseJsonSegment(encodedHeader), this.acceptedTypes);
    const claims = parseClaims(parseJsonSegment(encodedClaims));
    const jwk = await this.jwks.key(header.kid);
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signatureValid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      decodeBase64Url(encodedSignature),
      encoder.encode(`${encodedHeader}.${encodedClaims}`),
    );
    if (!signatureValid) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token signature is invalid", 401);

    const now = this.now();
    if (claims.iss !== this.issuer) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token issuer is invalid", 401);
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (!audiences.includes(this.audience)) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token audience is invalid", 401);
    if (claims.exp <= now - this.clockToleranceSeconds) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token has expired", 401);
    if (claims.nbf !== undefined && claims.nbf > now + this.clockToleranceSeconds) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token is not active", 401);
    if (claims.iat > now + this.clockToleranceSeconds || now - claims.iat > this.maximumTokenAgeSeconds + this.clockToleranceSeconds) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token issue time is invalid", 401);
    }
    if (this.requireMfa) {
      const explicitMfa = claims.amr?.includes("mfa") ?? false;
      const acceptedAcr = claims.acr !== undefined && this.acceptedMfaAcrValues.has(claims.acr);
      if (!explicitMfa && !acceptedAcr) throw new PlatformError("AUTHENTICATION_REQUIRED", "Multi-factor authentication is required", 401);
    }

    const sessionId = claims.sid ?? claims.jti;
    if (!sessionId || sessionId.length > 256) throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer token session identifier is required", 401);
    if (await this.securityState.isRevoked({ tenantId: claims.tenant_id, userId: claims.user_id, sessionId, ...(claims.device_id ? { deviceId: claims.device_id } : {}) })) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Bearer session or device is revoked", 401);
    }

    const permissions = new Set<string>(claims.permissions ?? []);
    for (const scope of claims.scope?.split(/\s+/).filter(Boolean) ?? []) permissions.add(scope);
    return {
      userId: claims.user_id,
      identitySubject: claims.sub,
      tenantId: claims.tenant_id,
      sessionId,
      permissions: [...permissions].sort(),
      authenticationMethods: claims.amr ?? [],
      ...(claims.acr ? { authenticationContext: claims.acr } : {}),
      ...(claims.legal_entity_id ? { legalEntityId: claims.legal_entity_id } : {}),
      ...(claims.store_id ? { storeId: claims.store_id } : {}),
      ...(claims.warehouse_id ? { warehouseId: claims.warehouse_id } : {}),
      ...(claims.register_id ? { registerId: claims.register_id } : {}),
      ...(claims.device_id ? { deviceId: claims.device_id } : {}),
      ...(claims.impersonator_id ? { impersonatorId: claims.impersonator_id } : {}),
    };
  }
}
