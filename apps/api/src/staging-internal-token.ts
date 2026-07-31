import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { TokenVerifier, VerifiedIdentity } from "./auth.js";
import {
  issueStagingAsymmetricToken,
  verifyStagingAsymmetricToken,
} from "./staging-asymmetric-token.js";
import type { StagingReadContext } from "./staging-read-context.js";

const TOKEN_TYPE = "ozzyl-staging-internal+jwt";
const TOKEN_LIFETIME_SECONDS = 300;

interface InternalTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly sid: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly permissions: readonly string[];
  readonly amr: readonly string[];
  readonly acr: string;
  readonly legal_entity_id?: string;
  readonly store_id?: string;
  readonly warehouse_id?: string;
  readonly register_id?: string;
}

export interface StagingInternalTokenOptions {
  readonly keyset?: string;
  /** @deprecated Migration compatibility for the existing Worker binding name. */
  readonly secret?: string;
  readonly issuer: string;
  readonly audience: string;
  readonly context: StagingReadContext;
  readonly now?: () => number;
}

export interface StagingInternalTokenVerifierOptions {
  readonly keyset?: string;
  /** @deprecated Migration compatibility for the existing Worker binding name. */
  readonly secret?: string;
  readonly issuer: string;
  readonly audience: string;
  readonly freshContext: () => Promise<StagingReadContext | null>;
  readonly now?: () => number;
}

function tokenKeyset(options: { readonly keyset?: string; readonly secret?: string }): string {
  const value = options.keyset ?? options.secret;
  if (!value) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Staging asymmetric token keyset is unavailable",
      503,
    );
  }
  return value;
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      `Internal token ${name} claim is invalid`,
      401,
    );
  }
  return value;
}

function integerClaim(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      `Internal token ${name} claim is invalid`,
      401,
    );
  }
  return value as number;
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      `Internal token ${name} claim is invalid`,
      401,
    );
  }
  return value as readonly string[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safePermissions(permissions: readonly string[]): readonly string[] {
  const normalized = [...new Set(permissions)].sort();
  if (
    normalized.length === 0 ||
    normalized.some(
      (permission) =>
        permission.includes(".write") ||
        permission.includes(".manage") ||
        permission.includes(".approve") ||
        permission.includes(".execute") ||
        permission.includes(".post") ||
        permission.includes(".capture") ||
        permission.includes(".refund") ||
        permission.includes(".close") ||
        permission.includes(".reopen"),
    )
  ) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      "Internal staging token contains a non-read permission",
      403,
    );
  }
  return normalized;
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const first = [...new Set(left)].sort();
  const second = [...new Set(right)].sort();
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

export async function issueStagingInternalToken(
  options: StagingInternalTokenOptions,
): Promise<string> {
  const now = (options.now ?? (() => Math.floor(Date.now() / 1_000)))();
  const permissions = safePermissions(options.context.permissions);
  const claims: InternalTokenClaims = {
    iss: options.issuer,
    aud: options.audience,
    sub: `custom-auth:${options.context.user.id}`,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    jti: crypto.randomUUID(),
    sid: options.context.sessionId,
    tenant_id: options.context.tenant.id,
    user_id: options.context.user.id,
    permissions,
    amr: ["pwd"],
    acr: "urn:ozzyl:staging:custom-auth",
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
  return await issueStagingAsymmetricToken({
    keyset: tokenKeyset(options),
    tokenType: TOKEN_TYPE,
    claims,
    now: () => now,
  });
}

export class StagingInternalTokenVerifier implements TokenVerifier {
  private readonly now: () => number;

  constructor(
    private readonly options: StagingInternalTokenVerifierOptions,
  ) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const record = await verifyStagingAsymmetricToken({
      keyset: tokenKeyset(this.options),
      tokenType: TOKEN_TYPE,
      token,
      now: this.now,
    });
    const issuer = stringClaim(record.iss, "iss");
    const audience = stringClaim(record.aud, "aud");
    const issuedAt = integerClaim(record.iat, "iat");
    const expiresAt = integerClaim(record.exp, "exp");
    const sessionId = stringClaim(record.sid, "sid");
    const tenantId = stringClaim(record.tenant_id, "tenant_id");
    const userId = stringClaim(record.user_id, "user_id");
    const subject = stringClaim(record.sub, "sub");
    stringClaim(record.jti, "jti");
    const permissions = safePermissions(
      stringArray(record.permissions, "permissions"),
    );
    const now = this.now();
    if (issuer !== this.options.issuer || audience !== this.options.audience) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Internal token issuer or audience is invalid",
        401,
      );
    }
    if (
      issuedAt > now + 5 ||
      expiresAt <= now ||
      expiresAt - issuedAt > TOKEN_LIFETIME_SECONDS ||
      now - issuedAt > TOKEN_LIFETIME_SECONDS
    ) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Internal token lifetime is invalid",
        401,
      );
    }

    const fresh = await this.options.freshContext();
    if (!fresh) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Custom staging session is no longer active",
        401,
      );
    }
    if (
      fresh.sessionId !== sessionId ||
      fresh.tenant.id !== tenantId ||
      fresh.user.id !== userId ||
      subject !== `custom-auth:${fresh.user.id}` ||
      !sameValues(fresh.permissions, permissions) ||
      !sameOptional(fresh.scope.legalEntityId, optionalString(record.legal_entity_id)) ||
      !sameOptional(fresh.scope.storeId, optionalString(record.store_id)) ||
      !sameOptional(fresh.scope.warehouseId, optionalString(record.warehouse_id)) ||
      !sameOptional(fresh.scope.registerId, optionalString(record.register_id))
    ) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Internal token no longer matches database authorization context",
        403,
      );
    }

    return {
      userId,
      identitySubject: subject,
      tenantId,
      sessionId,
      permissions,
      authenticationMethods: ["pwd"],
      authenticationContext: "urn:ozzyl:staging:custom-auth",
      ...(fresh.scope.legalEntityId
        ? { legalEntityId: fresh.scope.legalEntityId }
        : {}),
      ...(fresh.scope.storeId ? { storeId: fresh.scope.storeId } : {}),
      ...(fresh.scope.warehouseId
        ? { warehouseId: fresh.scope.warehouseId }
        : {}),
      ...(fresh.scope.registerId
        ? { registerId: fresh.scope.registerId }
        : {}),
    };
  }
}

export const STAGING_INTERNAL_TOKEN_LIFETIME_SECONDS = TOKEN_LIFETIME_SECONDS;
