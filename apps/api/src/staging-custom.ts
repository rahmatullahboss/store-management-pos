import stagingWorker, { type StagingEnvironment } from "./staging.js";

function statusHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

export default {
  async fetch(request: Request, env: StagingEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/staging/status") {
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({
              status: "healthy",
              service: "persistent-admin-pos-staging",
              version: env.STAGING_GIT_SHA?.slice(0, 12) || "local",
              database: "dedicated-neon-staging",
              browserMode: "synthetic-read-only",
              authentication:
                env.STAGING_AUTH_REQUIRED === "1"
                  ? "custom-auth-required"
                  : "not-required",
            }),
        { status: 200, headers: statusHeaders() },
      );
    }
    return await stagingWorker.fetch(request, env);
  },
};
