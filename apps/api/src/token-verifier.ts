import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import {
  DevelopmentTokenVerifier,
  type TokenVerifier,
} from "./auth.js";
import { NeonIdentitySecurityStateStore, OidcTokenVerifier } from "./oidc.js";

export interface IdentityEnvironment {
  readonly APP_ENV: string;
  readonly OIDC_ISSUER?: string;
  readonly OIDC_AUDIENCE?: string;
  readonly OIDC_JWKS_URI?: string;
  readonly OIDC_MFA_ACR_VALUES?: string;
  readonly STAGING_TOKEN_VERIFIER?: TokenVerifier;
}

export function createTokenVerifier(
  env: IdentityEnvironment,
  database: NeonDatabase,
): TokenVerifier {
  if (env.APP_ENV === "staging" && env.STAGING_TOKEN_VERIFIER) {
    return env.STAGING_TOKEN_VERIFIER;
  }
  if (
    env.APP_ENV === "local" ||
    env.APP_ENV === "development" ||
    env.APP_ENV === "preview"
  ) {
    return new DevelopmentTokenVerifier(true);
  }
  if (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE || !env.OIDC_JWKS_URI) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "OIDC identity provider configuration is incomplete",
      503,
    );
  }
  return new OidcTokenVerifier(
    {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
      jwksUri: env.OIDC_JWKS_URI,
      requireMfa: true,
      acceptedMfaAcrValues:
        env.OIDC_MFA_ACR_VALUES?.split(",")
          .map((value) => value.trim())
          .filter(Boolean) ?? [],
    },
    new NeonIdentitySecurityStateStore(database),
  );
}
