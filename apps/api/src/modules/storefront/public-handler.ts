import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import { SqlStorefrontPublicRepository } from "../../../../../modules/storefront/src/public.js";

function publicHeaders(cacheControl: string): HeadersInit {
  return {
    "Cache-Control": cacheControl,
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

export async function handlePublicStorefrontRequest(
  request: Request,
  url: URL,
  database: NeonDatabase,
): Promise<Response | null> {
  if (url.pathname !== "/v1/storefront/bootstrap") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } },
      {
        status: 405,
        headers: { ...publicHeaders("no-store"), Allow: "GET, HEAD" },
      },
    );
  }

  const hostname = url.searchParams.get("hostname")?.trim();
  if (!hostname) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      "hostname is required.",
      400,
    );
  }
  const bootstrap = await new SqlStorefrontPublicRepository(database).resolveBootstrap(hostname);
  if (!bootstrap) {
    const response = Response.json(
      { error: { code: "STOREFRONT_UNAVAILABLE", message: "This storefront is not available." } },
      { status: 404, headers: publicHeaders("private, no-cache, no-store, must-revalidate") },
    );
    return request.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  }

  const response = Response.json(bootstrap, {
    status: 200,
    headers: publicHeaders(
      "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
    ),
  });
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}
