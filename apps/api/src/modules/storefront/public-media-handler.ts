import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import { SqlStorefrontPublicMediaRepository } from "../../../../../modules/storefront/src/public-media.js";

const MEDIA_PATH = /^\/v1\/storefront\/products\/([^/]+)\/media$/u;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;

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

function productSlug(pathname: string): string | null {
  const match = pathname.match(MEDIA_PATH);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    throw new PlatformError("VALIDATION_FAILED", "Product media slug is invalid.", 400);
  }
  if (!SLUG.test(decoded) || decoded === "." || decoded === "..") {
    throw new PlatformError("VALIDATION_FAILED", "Product media slug is invalid.", 400);
  }
  return decoded;
}

export async function handlePublicStorefrontMediaRequest(
  request: Request,
  url: URL,
  database: NeonDatabase,
): Promise<Response | null> {
  const slug = productSlug(url.pathname);
  if (slug === null) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return withoutBody(
      request,
      Response.json(
        { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } },
        { status: 405, headers: { ...headers("no-store"), Allow: "GET, HEAD" } },
      ),
    );
  }

  const repository = new SqlStorefrontPublicMediaRepository(database);
  const manifest = await repository.resolveProductMedia(hostname(url), slug);
  if (!manifest) {
    return withoutBody(
      request,
      Response.json(
        { error: { code: "PRODUCT_MEDIA_NOT_FOUND", message: "Published product media was not found." } },
        {
          status: 404,
          headers: headers("public, max-age=0, s-maxage=30, stale-while-revalidate=60"),
        },
      ),
    );
  }

  return withoutBody(
    request,
    Response.json(manifest, {
      status: 200,
      headers: headers("public, max-age=0, s-maxage=300, stale-while-revalidate=900"),
    }),
  );
}
