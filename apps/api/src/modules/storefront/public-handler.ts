import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import type { StorefrontPublicAvailabilityFacetValueV1 } from "../../../../../packages/storefront-contracts/src/public-discovery.js";
import { SqlStorefrontPublicRepository } from "../../../../../modules/storefront/src/public.js";
import { resolveStorefrontPublicSearch } from "../../../../../modules/storefront/src/public-search.js";
import { resolveStorefrontPublicSeo } from "../../../../../modules/storefront/src/public-seo.js";

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

function publicJson(
  request: Request,
  value: unknown,
  cacheControl = "public, max-age=0, s-maxage=60, stale-while-revalidate=180",
): Response {
  return withoutBody(
    request,
    Response.json(value, {
      status: 200,
      headers: publicHeaders(cacheControl),
    }),
  );
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;
const AVAILABILITY = new Set<StorefrontPublicAvailabilityFacetValueV1>([
  "available",
  "limited",
  "unavailable",
  "preorder",
  "unknown",
]);

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

function routeSlug(pathname: string, route: string, label: string): string | null {
  const match = pathname.match(new RegExp(`^/v1/storefront/${route}/([^/]+)$`, "u"));
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    throw new PlatformError("VALIDATION_FAILED", `${label} slug is invalid.`, 400);
  }
  if (!SLUG.test(decoded) || decoded === "." || decoded === "..") {
    throw new PlatformError("VALIDATION_FAILED", `${label} slug is invalid.`, 400);
  }
  return decoded;
}

function searchQuery(url: URL): string {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (
    [...query].length < 2 ||
    [...query].length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(query)
  ) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      "q must contain between 2 and 120 visible characters.",
      400,
    );
  }
  return query;
}

function searchCategory(url: URL): string | undefined {
  const value = url.searchParams.get("category")?.trim().toLowerCase();
  if (!value) return undefined;
  if (!SLUG.test(value) || value === "." || value === "..") {
    throw new PlatformError("VALIDATION_FAILED", "category must be a public slug.", 400);
  }
  return value;
}

function searchAvailability(
  url: URL,
): StorefrontPublicAvailabilityFacetValueV1 | undefined {
  const value = url.searchParams.get("availability")?.trim().toLowerCase();
  if (!value) return undefined;
  if (!AVAILABILITY.has(value as StorefrontPublicAvailabilityFacetValueV1)) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      "availability is unsupported.",
      400,
    );
  }
  return value as StorefrontPublicAvailabilityFacetValueV1;
}

export async function handlePublicStorefrontRequest(
  request: Request,
  url: URL,
  database: NeonDatabase,
): Promise<Response | null> {
  const productSlug = routeSlug(url.pathname, "products", "Product");
  const categorySlug = routeSlug(url.pathname, "categories", "Category");
  const collectionSlug = routeSlug(url.pathname, "collections", "Collection");
  const exactRoute = new Set([
    "/v1/storefront/bootstrap",
    "/v1/storefront/content",
    "/v1/storefront/catalog",
    "/v1/storefront/search",
    "/v1/storefront/seo",
  ]).has(url.pathname);
  if (
    !exactRoute &&
    productSlug === null &&
    categorySlug === null &&
    collectionSlug === null
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
    return publicJson(
      request,
      bootstrap,
      "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
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
    return publicJson(
      request,
      content,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
  }

  if (url.pathname === "/v1/storefront/seo") {
    const seo = await resolveStorefrontPublicSeo(database, hostname);
    if (!seo) return unavailable(request);
    return publicJson(
      request,
      seo,
      "public, max-age=0, s-maxage=300, stale-while-revalidate=900",
    );
  }

  const cursor = catalogCursor(url);
  const pageOptions = {
    limit: catalogLimit(url),
    ...(cursor ? { cursor } : {}),
  };

  if (url.pathname === "/v1/storefront/catalog") {
    const catalog = await repository.resolveCatalog(hostname, pageOptions);
    if (!catalog) return unavailable(request);
    return publicJson(request, catalog);
  }

  if (url.pathname === "/v1/storefront/search") {
    const category = searchCategory(url);
    const availability = searchAvailability(url);
    const search = await resolveStorefrontPublicSearch(
      database,
      hostname,
      searchQuery(url),
      {
        ...pageOptions,
        ...(category ? { category } : {}),
        ...(availability ? { availability } : {}),
      },
    );
    if (!search) return unavailable(request);
    return publicJson(
      request,
      search,
      "public, max-age=0, s-maxage=30, stale-while-revalidate=90",
    );
  }

  if (productSlug !== null) {
    const product = await repository.resolveProduct(hostname, productSlug);
    if (!product) {
      return notFound(
        request,
        "PRODUCT_NOT_FOUND",
        "Published product was not found.",
      );
    }
    return publicJson(
      request,
      product,
      "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
    );
  }

  if (categorySlug !== null) {
    const category = await repository.resolveCategory(
      hostname,
      categorySlug,
      pageOptions,
    );
    if (!category) {
      return notFound(
        request,
        "CATEGORY_NOT_FOUND",
        "Published category was not found.",
      );
    }
    return publicJson(request, category);
  }

  const collection = await repository.resolveCollection(
    hostname,
    collectionSlug!,
    pageOptions,
  );
  if (!collection) {
    return notFound(
      request,
      "COLLECTION_NOT_FOUND",
      "Published collection was not found.",
    );
  }
  return publicJson(request, collection);
}
