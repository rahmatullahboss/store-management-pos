import stagingWorker, { type StagingEnvironment } from "./staging.js";
import {
  handleOperationalStagingRequest,
  type OperationalStagingEnvironment,
} from "./staging-operational-worker.js";
import {
  handleStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";

export interface PersistentStagingEnvironment
  extends StagingEnvironment,
    StagingReadContextEnvironment,
    OperationalStagingEnvironment {}

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
    if (url.pathname === "/staging/status") {
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({
              status: "healthy",
              service: "persistent-admin-pos-staging",
              version: env.STAGING_GIT_SHA?.slice(0, 12) || "local",
              database: "dedicated-neon-staging",
              browserMode: "operational-release-candidate",
              dataMode: "deterministic-synthetic-module-records",
              authentication:
                env.STAGING_AUTH_REQUIRED === "1"
                  ? "custom-auth-required"
                  : "not-required",
              authorization: "database-resolved-read-only",
              authoritativeWrites: false,
            }),
        { status: 200, headers: statusHeaders() },
      );
    }
    const operational = await handleOperationalStagingRequest(request, env);
    if (operational) return operational;
    return await stagingWorker.fetch(request, env);
  },
};
