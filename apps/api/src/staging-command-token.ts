import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { TokenVerifier, VerifiedIdentity } from "./auth.js";
import {
  issueStagingAsymmetricToken,
  verifyStagingAsymmetricToken,
} from "./staging-asymmetric-token.js";
import { STAGING_RESERVATION_PERMISSION } from "./staging-mfa.js";
import type { StagingReadContext } from "./staging-read-context.js";

const TOKEN_TYPE = "ozzyl-staging-command+jwt";
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
  readonly keyset?: string;
  /** @deprecated Migration compatibility for the existing Worker binding name. */
  readonly secret?: string;
  readonly issuer: string;
  readonly audience: string;
  readonly context: StagingReadContext;
  readonly now?: () => number;
}

export interface StagingCommandTokenVerifierOptions {
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
  return await issueStagingAsymmetricToken({
    keyset: tokenKeyset(options),
    tokenType: TOKEN_TYPE,
    claims,
    now: () => now,
  });
}

export class StagingCommandTokenVerifier implements TokenVerifier {
  private readonly now: () => number;

  constructor(private readonly options: StagingCommandTokenVerifierOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const claims = await verifyStagingAsymmetricToken({
      keyset: tokenKeyset(this.options),
      tokenType: TOKEN_TYPE,
      token,
      now: this.now,
    });
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
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Command token assurance is invalid",
        401,
      );
    }
    const now = this.now();
    if (
      issuedAt > now + 5 ||
      expiresAt <= now ||
      expiresAt - issuedAt > TOKEN_LIFETIME_SECONDS ||
      now - issuedAt > TOKEN_LIFETIME_SECONDS
    ) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Command token lifetime is invalid",
        401,
      );
    }
    const fresh = await this.options.freshContext();
    if (!fresh) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Custom session is no longer active",
        401,
      );
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
