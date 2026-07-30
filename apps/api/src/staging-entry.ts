import stagingWorker, { type StagingEnvironment } from "./staging.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  handleStagingMfaRequest,
  type StagingMfaEnvironment,
} from "./staging-mfa.js";
import {
  handleOperationalStagingRequest,
  type OperationalStagingEnvironment,
} from "./staging-operational-worker.js";
import {
  handleStagingProtectedApi,
  type StagingProtectedApiEnvironment,
} from "./staging-protected-api.js";
import {
  handleStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";
import { handleStagingReservationUi } from "./staging-reservation-ui.js";
import {
  handleExactStagingPos,
  type StagingPosReleaseEnvironment,
} from "./staging-pos-release.js";

export interface PersistentStagingEnvironment
  extends StagingEnvironment,
    StagingReadContextEnvironment,
    StagingMfaEnvironment,
    OperationalStagingEnvironment,
    StagingPosReleaseEnvironment,
    StagingProtectedApiEnvironment {}

function statusHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

async function mfaCryptoSelfCheck(
  request: Request,
  env: PersistentStagingEnvironment,
): Promise<Response> {
  if (env.APP_ENV !== "staging") return new Response(null, { status: 404 });
  try {
    const secret = new Uint8Array(20);
    crypto.getRandomValues(secret);
    const factorId = crypto.randomUUID();
    const encrypted = await encryptTotpSecret(
      secret,
      "staging-crypto-self-check-password",
      factorId,
    );
    const decrypted = await decryptTotpSecret(
      {
        id: factorId,
        userId: crypto.randomUUID(),
        tenantId: crypto.randomUUID(),
        status: "pending",
        label: "Self check",
        ...encrypted,
      },
      "staging-crypto-self-check-password",
    );
    const passed =
      decrypted.length === secret.length &&
      decrypted.every((value, index) => value === secret[index]);
    return new Response(
      request.method === "HEAD"
        ? null
        : JSON.stringify({
            status: passed ? "passed" : "failed",
            algorithm: "PBKDF2-SHA256+A256GCM",
            iterations: encrypted.iterations,
            ciphertextLength: encrypted.ciphertext.length,
            ivLength: encrypted.iv.length,
            saltLength: encrypted.salt.length,
          }),
      { status: passed ? 200 : 500, headers: statusHeaders() },
    );
  } catch (error) {
    return new Response(
      request.method === "HEAD"
        ? null
        : JSON.stringify({
            status: "failed",
            stage: "worker-web-crypto",
            errorName: error instanceof Error ? error.name : "unknown",
            errorMessage: error instanceof Error
              ? error.message.slice(0, 180)
              : "Unknown Web Crypto error",
          }),
      { status: 500, headers: statusHeaders() },
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: PersistentStagingEnvironment,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/auth/context") {
      return await handleStagingReadContext(request, env);
    }
    if (
      url.pathname === "/staging/mfa-crypto-check" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return await mfaCryptoSelfCheck(request, env);
    }
    const mfa = await handleStagingMfaRequest(request, url, env);
    if (mfa) return mfa;
    if (url.pathname === "/staging/status") {
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({
              status: "healthy",
              service: "persistent-admin-pos-staging",
              version: env.STAGING_GIT_SHA?.slice(0, 12) || "local",
              database: "dedicated-neon-staging",
              browserMode: "controlled-reservation-release-candidate",
              dataMode: "deterministic-synthetic-module-records",
              authentication:
                env.STAGING_AUTH_REQUIRED === "1"
                  ? "custom-auth-required"
                  : "not-required",
              authorization: "database-resolved-read-plus-mfa-step-up",
              mfa: "encrypted-totp-current-password-step-up",
              protectedReadTransport: "short-lived-internal-token",
              internalReadTokenLifetimeSeconds: 300,
              internalCommandTokenLifetimeSeconds: 60,
              stepUpGrantLifetimeSeconds: 300,
              controlledWrites: [
                "inventory.reservation.create",
                "inventory.reservation.release",
              ],
              authoritativeWrites: false,
            }),
        { status: 200, headers: statusHeaders() },
      );
    }
    const reservationUi = await handleStagingReservationUi(request, url, env);
    if (reservationUi) return reservationUi;
    const protectedApi = await handleStagingProtectedApi(request, env);
    if (protectedApi) return protectedApi;
    const exactPos = await handleExactStagingPos(request, env);
    if (exactPos) return exactPos;
    const operational = await handleOperationalStagingRequest(request, env);
    if (operational) return operational;
    return await stagingWorker.fetch(request, env);
  },
};
