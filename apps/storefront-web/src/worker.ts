import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type {
  StorefrontPublicCatalogPageV1,
  StorefrontPublicProductDetailV1,
} from "../../../packages/storefront-contracts/src/public-catalog.js";
import type { StorefrontPublicContentBundleV1 } from "../../../packages/storefront-contracts/src/public-content.js";
import {
  createStorefrontCatalogResolver,
  createStorefrontCatalogTransportResolver,
  type StorefrontCatalogResolver,
} from "./catalog-resolver.js";
import {
  createStorefrontContentResolver,
  createStorefrontContentTransportResolver,
  type StorefrontContentResolver,
} from "./content-resolver.js";
import {
  parseStorefrontRuntimeEnvironment,
  StorefrontEnvironmentError,
  type StorefrontRuntimeEnvironment,
} from "./environment.js";
import {
  createStorefrontHostResolver,
  createStorefrontTransportResolver,
  type StorefrontHostResolver,
} from "./host-resolver.js";
import { storefrontShellResponse } from "./render.js";
import {
  storefrontContentNotFoundResponse,
  storefrontHealthResponse,
  storefrontProductNotFoundResponse,
  storefrontRequestHostname,
  storefrontServiceUnavailableResponse,
  storefrontUnavailableResponse,
} from "./runtime.js";

export interface StorefrontWorkerBindings {
  readonly [key: string]: unknown;
  readonly STOREFRONT_STAGE: string;
  readonly STOREFRONT_API_BASE_URL: string;
  readonly STOREFRONT_PLATFORM_BASE_DOMAIN: string;
  readonly STOREFRONT_BUILD_ID: string;
  readonly STOREFRONT_API?: StorefrontTransport;
}

export type StorefrontResolverFactory = (
  bindings: StorefrontWorkerBindings,
  environment: StorefrontRuntimeEnvironment,
) => StorefrontHostResolver;

export type StorefrontContentResolverFactory = (
  bindings: StorefrontWorkerBindings,
  environment: StorefrontRuntimeEnvironment,
) => StorefrontContentResolver;

export type StorefrontCatalogResolverFactory = (
  bindings: StorefrontWorkerBindings,
  environment: StorefrontRuntimeEnvironment,
) => StorefrontCatalogResolver;

export interface StorefrontWorkerOptions {
  readonly resolverFactory?: StorefrontResolverFactory;
  readonly contentResolverFactory?: StorefrontContentResolverFactory;
  readonly catalogResolverFactory?: StorefrontCatalogResolverFactory;
  readonly theme?: unknown;
}

export interface StorefrontWorker {
  fetch(request: Request, bindings: StorefrontWorkerBindings): Promise<Response>;
}

function isStorefrontTransport(value: unknown): value is StorefrontTransport {
  return (
    typeof value === "object" &&
    value !== null &&
    "fetch" in value &&
    typeof value.fetch === "function"
  );
}

function defaultResolverFactory(
  bindings: StorefrontWorkerBindings,
  environment: StorefrontRuntimeEnvironment,
): StorefrontHostResolver {
  if (isStorefrontTransport(bindings.STOREFRONT_API)) {
    return createStorefrontTransportResolver({
      baseUrl: environment.apiBaseUrl,
      transport: bindings.STOREFRONT_API,
    });
  }

  return createStorefrontHostResolver(
    createStorefrontClient({ baseUrl: environment.apiBaseUrl }),
  );
}

function defaultContentResolverFactory(
  bindings: StorefrontWorkerBindings,
  environment: StorefrontRuntimeEnvironment,
): StorefrontContentResolver {
  if (isStorefrontTransport(bindings.STOREFRONT_API)) {
    return createStorefrontContentTransportResolver({
      baseUrl: environment.apiBaseUrl,
      transport: bindings.STOREFRONT_API,
    });
  }
  return createStorefrontContentResolver(
    createStorefrontClient({ baseUrl: environment.apiBaseUrl }),
  );
}

function defaultCatalogResolverFactory(
  bindings: StorefrontWorkerBindings,
  environment: StorefrontRuntimeEnvironment,
): StorefrontCatalogResolver {
  if (isStorefrontTransport(bindings.STOREFRONT_API)) {
    return createStorefrontCatalogTransportResolver({
      baseUrl: environment.apiBaseUrl,
      transport: bindings.STOREFRONT_API,
    });
  }
  return createStorefrontCatalogResolver(
    createStorefrontClient({ baseUrl: environment.apiBaseUrl }),
  );
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function methodNotAllowedResponse(headOnly: boolean): Response {
  const response = Response.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Only GET and HEAD are supported.",
      },
    },
    {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
  return headOnly ? withoutBody(response) : response;
}

function canonicalRedirectResponse(
  request: Request,
  canonicalHostname: string,
): Response {
  const target = new URL(request.url);
  target.protocol = "https:";
  target.hostname = canonicalHostname;
  target.port = "";
  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=300",
      Location: target.toString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function asHeadResponse(request: Request, response: Response): Response {
  return request.method === "HEAD" ? withoutBody(response) : response;
}

function publicContentSlug(url: URL): string | undefined {
  const match = url.pathname.match(/^\/pages\/([^/]+)$/u);
  if (!match?.[1]) return undefined;
  return decodePublicSlug(match[1], "content");
}

type CatalogRoute =
  | { readonly kind: "listing" }
  | { readonly kind: "detail"; readonly slug: string };

function publicCatalogRoute(url: URL): CatalogRoute | null {
  if (url.pathname === "/products" || url.pathname === "/products/") {
    return { kind: "listing" };
  }
  const match = url.pathname.match(/^\/products\/([^/]+)$/u);
  if (!match?.[1]) return null;
  return { kind: "detail", slug: decodePublicSlug(match[1], "product") };
}

function decodePublicSlug(value: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value).trim().toLowerCase();
  } catch {
    throw new StorefrontContractError(`Storefront ${label} path is invalid.`);
  }
  if (
    !/^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u.test(decoded) ||
    decoded === "." ||
    decoded === ".."
  ) {
    throw new StorefrontContractError(`Storefront ${label} path is invalid.`);
  }
  return decoded;
}

function catalogRequestOptions(
  url: URL,
  signal: AbortSignal,
): { readonly signal: AbortSignal; readonly limit?: number; readonly cursor?: string } {
  const rawLimit = url.searchParams.get("limit");
  let limit: number | undefined;
  if (rawLimit !== null) {
    if (!/^[1-9][0-9]*$/u.test(rawLimit)) {
      throw new StorefrontContractError("Storefront catalog limit is invalid.");
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit > 48) {
      throw new StorefrontContractError("Storefront catalog limit is invalid.");
    }
  }
  const rawCursor = url.searchParams.get("cursor")?.trim().toLowerCase();
  if (
    rawCursor &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(rawCursor)
  ) {
    throw new StorefrontContractError("Storefront catalog cursor is invalid.");
  }
  return {
    signal,
    ...(limit === undefined ? {} : { limit }),
    ...(rawCursor ? { cursor: rawCursor } : {}),
  };
}

type PublicContext = StorefrontPublicContentBundleV1["context"];

function assertPublicScope(
  bootstrap: Parameters<typeof storefrontShellResponse>[1],
  actual: PublicContext,
  label: string,
): void {
  const expected = bootstrap.context;
  if (
    actual.tenantId !== expected.tenantId ||
    actual.storefrontId !== expected.storefrontId ||
    actual.salesChannelId !== expected.salesChannelId ||
    actual.requestHostname !== expected.requestHostname ||
    actual.canonicalHostname !== expected.canonicalHostname ||
    actual.locale !== expected.locale ||
    actual.currency !== expected.currency ||
    actual.priceListRevision !== expected.priceListRevision ||
    actual.publicationGeneration !== expected.publicationGeneration
  ) {
    throw new StorefrontContractError(`Storefront public ${label} scope mismatch.`);
  }
}

function assertContentScope(
  bootstrap: Parameters<typeof storefrontShellResponse>[1],
  content: StorefrontPublicContentBundleV1,
): void {
  assertPublicScope(bootstrap, content.context, "content");
  if (
    content.themeRevision !== bootstrap.themeRevision ||
    content.layoutRevision !== bootstrap.layoutRevision
  ) {
    throw new StorefrontContractError("Storefront public content revision mismatch.");
  }
}

export function createStorefrontWorker(
  options: StorefrontWorkerOptions = {},
): StorefrontWorker {
  const resolverFactory = options.resolverFactory ?? defaultResolverFactory;
  const shouldResolveContent =
    options.contentResolverFactory !== undefined || options.resolverFactory === undefined;
  const contentResolverFactory =
    options.contentResolverFactory ?? defaultContentResolverFactory;
  const shouldResolveCatalog =
    options.catalogResolverFactory !== undefined || options.resolverFactory === undefined;
  const catalogResolverFactory =
    options.catalogResolverFactory ?? defaultCatalogResolverFactory;

  return Object.freeze({
    async fetch(
      request: Request,
      bindings: StorefrontWorkerBindings,
    ): Promise<Response> {
      const url = new URL(request.url);
      const headOnly = request.method === "HEAD";

      if (url.pathname === "/__health") {
        return asHeadResponse(request, storefrontHealthResponse());
      }
      if (request.method !== "GET" && !headOnly) {
        return methodNotAllowedResponse(headOnly);
      }

      try {
        const environment = parseStorefrontRuntimeEnvironment(bindings);
        const hostname = storefrontRequestHostname(request);
        const resolver = resolverFactory(bindings, environment);
        const bootstrap = await resolver.resolve(hostname, {
          signal: request.signal,
        });

        if (!bootstrap) {
          return asHeadResponse(request, storefrontUnavailableResponse());
        }
        if (bootstrap.context.requestHostname !== hostname) {
          throw new StorefrontContractError(
            "Storefront host resolution returned a mismatched hostname.",
          );
        }
        if (bootstrap.context.canonicalHostname !== hostname) {
          return canonicalRedirectResponse(
            request,
            bootstrap.context.canonicalHostname,
          );
        }

        let content: StorefrontPublicContentBundleV1 | undefined;
        const contentEnabled =
          options.contentResolverFactory !== undefined ||
          bootstrap.capabilities.includes("content.read");
        if (shouldResolveContent && contentEnabled) {
          const slug = publicContentSlug(url);
          const contentResolver = contentResolverFactory(bindings, environment);
          const resolved = await contentResolver.resolve(hostname, {
            signal: request.signal,
            ...(slug === undefined ? {} : { slug }),
          });
          if (!resolved) {
            return asHeadResponse(
              request,
              slug === undefined
                ? storefrontUnavailableResponse()
                : storefrontContentNotFoundResponse(),
            );
          }
          assertContentScope(bootstrap, resolved);
          content = resolved;
        }

        let catalog: StorefrontPublicCatalogPageV1 | undefined;
        let product: StorefrontPublicProductDetailV1 | undefined;
        const catalogRoute = publicCatalogRoute(url);
        if (catalogRoute) {
          if (
            !shouldResolveCatalog ||
            (!bootstrap.capabilities.includes("catalog.read") &&
              options.catalogResolverFactory === undefined)
          ) {
            return asHeadResponse(request, storefrontUnavailableResponse());
          }
          const catalogResolver = catalogResolverFactory(bindings, environment);
          if (catalogRoute.kind === "listing") {
            const resolved = await catalogResolver.resolveCatalog(
              hostname,
              catalogRequestOptions(url, request.signal),
            );
            if (!resolved) {
              return asHeadResponse(request, storefrontUnavailableResponse());
            }
            assertPublicScope(bootstrap, resolved.context, "catalog");
            catalog = resolved;
          } else {
            const resolved = await catalogResolver.resolveProduct(
              hostname,
              catalogRoute.slug,
              { signal: request.signal },
            );
            if (!resolved) {
              return asHeadResponse(request, storefrontProductNotFoundResponse());
            }
            assertPublicScope(bootstrap, resolved.context, "product");
            product = resolved;
          }
        }

        const renderOptions = {
          buildId: environment.buildId,
          headOnly,
          ...(content ? { content } : {}),
          ...(catalog ? { catalog } : {}),
          ...(product ? { product } : {}),
          ...(options.theme === undefined ? {} : { theme: options.theme }),
        };
        return await storefrontShellResponse(request, bootstrap, renderOptions);
      } catch (error: unknown) {
        if (error instanceof StorefrontContractError) {
          return asHeadResponse(request, storefrontUnavailableResponse());
        }
        if (
          error instanceof StorefrontEnvironmentError ||
          error instanceof StorefrontClientError
        ) {
          return asHeadResponse(
            request,
            storefrontServiceUnavailableResponse(),
          );
        }
        return asHeadResponse(request, storefrontServiceUnavailableResponse());
      }
    },
  });
}

const storefrontWorker = createStorefrontWorker();

export default storefrontWorker;
