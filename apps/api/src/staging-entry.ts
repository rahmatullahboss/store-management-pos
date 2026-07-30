import stagingWorker, { type StagingEnvironment } from "./staging.js";
import {
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

export default {
  async fetch(
    request: Request,
    env: PersistentStagingEnvironment,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/auth/context") {
      return await handleStagingReadContext(request, env);
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
