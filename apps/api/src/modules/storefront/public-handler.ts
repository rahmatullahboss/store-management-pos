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

function notFound(request: Request, code: string, message: string): Response {
  return withoutBody(
    request,
    Response.json(
      { error: { code, message } },
      {
        status: 404,
        headers: publicHeaders(
          "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
        ),
      },
    ),
  );
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;

function catalogLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 24;
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new PlatformError("VALIDATION_FAILED", "limit must be an integer between 1 and 48.", 400);
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit > 48) {
    throw new PlatformError("VALIDATION_FAILED", "limit must be an integer between 1 and 48.", 400);
  }
  return limit;
}

function catalogCursor(url: URL): string | undefined {
  const raw = url.searchParams.get("cursor")?.trim().toLowerCase();
  if (!raw) return undefined;
  if (!UUID.test(raw)) {
    throw new PlatformError("VALIDATION_FAILED", "cursor must be a UUID.", 400);
  }
  return raw;
}

function productSlug(pathname: string): string | null {
  const match = pathname.match(/^\/v1\/storefront\/products\/([^/]+)$/u);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "Product slug is invalid.", 400);
  }
  if (!SLUG.test(decoded) || decoded === "." || decoded === "..") {
    throw new PlatformError("VALIDATION_FAILED", "Product slug is invalid.", 400);
  }
  return decoded;
}

export async function handlePublicStorefrontRequest(
  request: Request,
  url: URL,
  database: NeonDatabase,
): Promise<Response | null> {
  const slug = productSlug(url.pathname);
  if (
    url.pathname !== "/v1/storefront/bootstrap" &&
    url.pathname !== "/v1/storefront/content" &&
    url.pathname !== "/v1/storefront/catalog" &&
    slug === null
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

  if (url.pathname === "/v1/storefront/content") {
    const contentSlug = url.searchParams.get("slug")?.trim() || undefined;
    const content = await repository.resolveContentBundle(hostname, contentSlug);
    if (!content) return unavailable(request);
    if (contentSlug !== undefined && content.page === null) {
      return notFound(
        request,
        "CONTENT_NOT_FOUND",
        "Published content was not found.",
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

  if (url.pathname === "/v1/storefront/catalog") {
    const cursor = catalogCursor(url);
    const catalog = await repository.resolveCatalog(hostname, {
      limit: catalogLimit(url),
      ...(cursor ? { cursor } : {}),
    });
    if (!catalog) return unavailable(request);
    return withoutBody(
      request,
      Response.json(catalog, {
        status: 200,
        headers: publicHeaders(
          "public, max-age=0, s-maxage=60, stale-while-revalidate=180",
        ),
      }),
    );
  }

  const product = await repository.resolveProduct(hostname, slug!);
  if (!product) {
    return notFound(
      request,
      "PRODUCT_NOT_FOUND",
      "Published product was not found.",
    );
  }
  return withoutBody(
    request,
    Response.json(product, {
      status: 200,
      headers: publicHeaders(
        "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
      ),
    }),
  );
}
