import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { TokenVerifier, VerifiedIdentity } from "./auth.js";
import type { StagingReadContext } from "./staging-read-context.js";
import { STAGING_RESERVATION_PERMISSION } from "./staging-mfa.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_TYPE = "ozzyl-staging-step-up+jwt";
const TOKEN_ALGORITHM = "HS256";
const TOKEN_LIFETIME_SECONDS = 60;

interface CommandTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly sid: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly permission: typeof STAGING_RESERVATION_PERMISSION;
  readonly amr: readonly ["pwd", "otp"];
  readonly acr: "urn:ozzyl:staging:mfa-step-up";
  readonly legal_entity_id?: string;
  readonly store_id?: string;
  readonly warehouse_id?: string;
  readonly register_id?: string;
}

export interface StagingCommandTokenOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly context: StagingReadContext;
  readonly now?: () => number;
}

export interface StagingCommandTokenVerifierOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly freshContext: () => Promise<StagingReadContext | null>;
  readonly now?: () => number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token encoding is invalid", 401);
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (base64Url(bytes) !== value) throw new Error("non-canonical");
    return bytes;
  } catch {
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token encoding is invalid", 401);
  }
}

function encodeJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(decoder.decode(decodeBase64Url(value))) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token JSON is invalid", 401);
  }
}

function assertSecret(secret: string): void {
  if (secret.length < 43) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Staging command token secret is unavailable",
      503,
    );
  }
}

async function hmac(secret: string, input: string): Promise<Uint8Array> {
  assertSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(input)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      `Command token ${name} claim is invalid`,
      401,
    );
  }
  return value;
}

function integerClaim(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      `Command token ${name} claim is invalid`,
      401,
    );
  }
  return value as number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

export async function issueStagingCommandToken(
  options: StagingCommandTokenOptions,
): Promise<string> {
  assertSecret(options.secret);
  const now = (options.now ?? (() => Math.floor(Date.now() / 1_000)))();
  const claims: CommandTokenClaims = {
    iss: options.issuer,
    aud: options.audience,
    sub: `custom-auth:${options.context.user.id}`,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    jti: crypto.randomUUID(),
    sid: options.context.sessionId,
    tenant_id: options.context.tenant.id,
    user_id: options.context.user.id,
    permission: STAGING_RESERVATION_PERMISSION,
    amr: ["pwd", "otp"],
    acr: "urn:ozzyl:staging:mfa-step-up",
    ...(options.context.scope.legalEntityId
      ? { legal_entity_id: options.context.scope.legalEntityId }
      : {}),
    ...(options.context.scope.storeId
      ? { store_id: options.context.scope.storeId }
      : {}),
    ...(options.context.scope.warehouseId
      ? { warehouse_id: options.context.scope.warehouseId }
      : {}),
    ...(options.context.scope.registerId
      ? { register_id: options.context.scope.registerId }
      : {}),
  };
  const header = encodeJson({ alg: TOKEN_ALGORITHM, typ: TOKEN_TYPE });
  const payload = encodeJson(claims);
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${base64Url(await hmac(options.secret, signingInput))}`;
}

export class StagingCommandTokenVerifier implements TokenVerifier {
  private readonly now: () => number;

  constructor(private readonly options: StagingCommandTokenVerifierOptions) {
    assertSecret(options.secret);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    if (token.length > 8_192) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token is too large", 401);
    }
    const segments = token.split(".");
    if (segments.length !== 3) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token structure is invalid", 401);
    }
    const [headerSegment, payloadSegment, signatureSegment] = segments;
    if (!headerSegment || !payloadSegment || !signatureSegment) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token structure is invalid", 401);
    }
    const header = decodeJson(headerSegment);
    if (header.alg !== TOKEN_ALGORITHM || header.typ !== TOKEN_TYPE) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token type is invalid", 401);
    }
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const expected = await hmac(this.options.secret, signingInput);
    if (!constantTimeEqual(expected, decodeBase64Url(signatureSegment))) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token signature is invalid", 401);
    }

    const claims = decodeJson(payloadSegment);
    const issuer = stringClaim(claims.iss, "iss");
    const audience = stringClaim(claims.aud, "aud");
    const userId = stringClaim(claims.user_id, "user_id");
    const tenantId = stringClaim(claims.tenant_id, "tenant_id");
    const sessionId = stringClaim(claims.sid, "sid");
    const subject = stringClaim(claims.sub, "sub");
    const issuedAt = integerClaim(claims.iat, "iat");
    const expiresAt = integerClaim(claims.exp, "exp");
    stringClaim(claims.jti, "jti");
    if (
      issuer !== this.options.issuer ||
      audience !== this.options.audience ||
      claims.permission !== STAGING_RESERVATION_PERMISSION ||
      claims.acr !== "urn:ozzyl:staging:mfa-step-up" ||
      !Array.isArray(claims.amr) ||
      claims.amr.length !== 2 ||
      claims.amr[0] !== "pwd" ||
      claims.amr[1] !== "otp"
    ) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token assurance is invalid", 401);
    }
    const now = this.now();
    if (
      issuedAt > now + 5 ||
      expiresAt <= now ||
      expiresAt - issuedAt > TOKEN_LIFETIME_SECONDS ||
      now - issuedAt > TOKEN_LIFETIME_SECONDS
    ) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Command token lifetime is invalid", 401);
    }
    const fresh = await this.options.freshContext();
    if (!fresh) {
      throw new PlatformError("AUTHENTICATION_REQUIRED", "Custom session is no longer active", 401);
    }
    if (
      fresh.sessionId !== sessionId ||
      fresh.user.id !== userId ||
      fresh.tenant.id !== tenantId ||
      subject !== `custom-auth:${fresh.user.id}` ||
      !sameOptional(fresh.scope.legalEntityId, optionalString(claims.legal_entity_id)) ||
      !sameOptional(fresh.scope.storeId, optionalString(claims.store_id)) ||
      !sameOptional(fresh.scope.warehouseId, optionalString(claims.warehouse_id)) ||
      !sameOptional(fresh.scope.registerId, optionalString(claims.register_id))
    ) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Command token no longer matches database scope",
        403,
      );
    }
    return {
      userId,
      identitySubject: subject,
      tenantId,
      sessionId,
      permissions: [STAGING_RESERVATION_PERMISSION],
      authenticationMethods: ["pwd", "otp"],
      authenticationContext: "urn:ozzyl:staging:mfa-step-up",
      ...(fresh.scope.legalEntityId ? { legalEntityId: fresh.scope.legalEntityId } : {}),
      ...(fresh.scope.storeId ? { storeId: fresh.scope.storeId } : {}),
      ...(fresh.scope.warehouseId ? { warehouseId: fresh.scope.warehouseId } : {}),
      ...(fresh.scope.registerId ? { registerId: fresh.scope.registerId } : {}),
    };
  }
}

export const STAGING_COMMAND_TOKEN_LIFETIME_SECONDS = TOKEN_LIFETIME_SECONDS;
