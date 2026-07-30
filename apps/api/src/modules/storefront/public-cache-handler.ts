import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import { SqlStorefrontPublicCacheRepository } from "../../../../../modules/storefront/src/public-cache.js";

const PATH = "/v1/storefront/cache-generations";

function headers(cacheControl: string): HeadersInit {
  return {
    "Cache-Control": cacheControl,
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function withoutBody(request: Request, response: Response): Response {
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}

function hostname(url: URL): string {
  const value = url.searchParams.get("hostname")?.trim();
  if (!value) {
    throw new PlatformError("VALIDATION_FAILED", "hostname is required.", 400);
  }
  return value;
}

export async function handlePublicStorefrontCacheRequest(
  request: Request,
  url: URL,
  database: NeonDatabase,
): Promise<Response | null> {
  if (url.pathname !== PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return withoutBody(
      request,
      Response.json(
        { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } },
        { status: 405, headers: { ...headers("no-store"), Allow: "GET, HEAD" } },
      ),
    );
  }
  const repository = new SqlStorefrontPublicCacheRepository(database);
  const bundle = await repository.resolveGenerations(hostname(url));
  if (!bundle) {
    return withoutBody(
      request,
      Response.json(
        { error: { code: "CACHE_GENERATIONS_UNAVAILABLE", message: "Public cache generations are unavailable." } },
        { status: 404, headers: headers("private, no-cache, no-store, must-revalidate") },
      ),
    );
  }
  return withoutBody(
    request,
    Response.json(bundle, {
      status: 200,
      headers: headers("private, no-cache, no-store, must-revalidate"),
    }),
  );
}
