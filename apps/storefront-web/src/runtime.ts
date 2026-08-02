import type { StorefrontBootstrapV1 } from "../../../packages/storefront-contracts/src/index.js";
import { normalizeStorefrontHostname } from "../../../packages/storefront-contracts/src/index.js";
import type { StorefrontClient } from "../../../packages/storefront-client/src/index.js";

export interface StorefrontResolvedRequest {
  readonly hostname: string;
  readonly bootstrap: StorefrontBootstrapV1;
}

export function storefrontRequestHostname(request: Request): string {
  return normalizeStorefrontHostname(new URL(request.url).hostname);
}

export async function resolveStorefrontRequest(
  request: Request,
  client: StorefrontClient,
): Promise<StorefrontResolvedRequest> {
  const hostname = storefrontRequestHostname(request);
  const bootstrap = await client.getBootstrap(hostname, {
    signal: request.signal,
  });
  if (bootstrap.context.requestHostname !== hostname) {
    throw new Error("Storefront bootstrap hostname mismatch.");
  }
  return Object.freeze({ hostname, bootstrap });
}

export function storefrontHealthResponse(): Response {
  return Response.json(
    {
      service: "storefront-web",
      status: "ok",
      contractVersion: "storefront-runtime.v1",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function unavailableHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function publicNotFoundResponse(code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status: 404,
      headers: {
        ...unavailableHeaders(),
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}

export function storefrontUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "STOREFRONT_UNAVAILABLE",
        message: "This storefront is not available.",
      },
    },
    {
      status: 404,
      headers: unavailableHeaders(),
    },
  );
}

export function storefrontContentNotFoundResponse(): Response {
  return publicNotFoundResponse(
    "CONTENT_NOT_FOUND",
    "Published content was not found.",
  );
}

export function storefrontProductNotFoundResponse(): Response {
  return publicNotFoundResponse(
    "PRODUCT_NOT_FOUND",
    "Published product was not found.",
  );
}

export function storefrontCategoryNotFoundResponse(): Response {
  return publicNotFoundResponse(
    "CATEGORY_NOT_FOUND",
    "Published category was not found.",
  );
}

export function storefrontCollectionNotFoundResponse(): Response {
  return publicNotFoundResponse(
    "COLLECTION_NOT_FOUND",
    "Published collection was not found.",
  );
}

export function storefrontServiceUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: "STOREFRONT_TEMPORARILY_UNAVAILABLE",
        message: "This storefront is temporarily unavailable.",
      },
    },
    {
      status: 503,
      headers: {
        ...unavailableHeaders(),
        "Retry-After": "30",
      },
    },
  );
}
