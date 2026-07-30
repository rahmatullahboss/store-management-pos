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

function withoutBody(request: Request, response: Response): Response {
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}

function methodNotAllowed(request: Request): Response {
  return withoutBody(
    request,
    Response.json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } },
      {
        status: 405,
        headers: { ...publicHeaders("no-store"), Allow: "GET, HEAD" },
      },
    ),
  );
}

function requiredHostname(url: URL): string {
  const hostname = url.searchParams.get("hostname")?.trim();
  if (!hostname) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      "hostname is required.",
      400,
    );
  }
  return hostname;
}

function unavailable(request: Request): Response {
  return withoutBody(
    request,
    Response.json(
      { error: { code: "STOREFRONT_UNAVAILABLE", message: "This storefront is not available." } },
      { status: 404, headers: publicHeaders("private, no-cache, no-store, must-revalidate") },
    ),
  );
}

export async function handlePublicStorefrontRequest(
  request: Request,
  url: URL,
  database: NeonDatabase,
): Promise<Response | null> {
  if (
    url.pathname !== "/v1/storefront/bootstrap" &&
    url.pathname !== "/v1/storefront/content"
  ) {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(request);
  }

  const hostname = requiredHostname(url);
  const repository = new SqlStorefrontPublicRepository(database);

  if (url.pathname === "/v1/storefront/bootstrap") {
    const bootstrap = await repository.resolveBootstrap(hostname);
    if (!bootstrap) return unavailable(request);
    return withoutBody(
      request,
      Response.json(bootstrap, {
        status: 200,
        headers: publicHeaders(
          "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
        ),
      }),
    );
  }

  const slug = url.searchParams.get("slug")?.trim() || undefined;
  const content = await repository.resolveContentBundle(hostname, slug);
  if (!content) return unavailable(request);
  if (slug !== undefined && content.page === null) {
    return withoutBody(
      request,
      Response.json(
        { error: { code: "CONTENT_NOT_FOUND", message: "Published content was not found." } },
        {
          status: 404,
          headers: publicHeaders(
            "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
          ),
        },
      ),
    );
  }
  return withoutBody(
    request,
    Response.json(content, {
      status: 200,
      headers: publicHeaders(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ),
    }),
  );
}
