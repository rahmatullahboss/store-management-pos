import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type { StorefrontPublicContentBundleV1 } from "../../../packages/storefront-contracts/src/public-content.js";
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

export interface StorefrontWorkerOptions {
  readonly resolverFactory?: StorefrontResolverFactory;
  readonly contentResolverFactory?: StorefrontContentResolverFactory;
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
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    throw new StorefrontContractError("Storefront content path is invalid.");
  }
  if (decoded.includes("/") || decoded.includes("\\")) {
    throw new StorefrontContractError("Storefront content path is invalid.");
  }
  return decoded;
}

function assertContentScope(
  bootstrap: Parameters<typeof storefrontShellResponse>[1],
  content: StorefrontPublicContentBundleV1,
): void {
  const expected = bootstrap.context;
  const actual = content.context;
  if (
    actual.tenantId !== expected.tenantId ||
    actual.storefrontId !== expected.storefrontId ||
    actual.salesChannelId !== expected.salesChannelId ||
    actual.requestHostname !== expected.requestHostname ||
    actual.canonicalHostname !== expected.canonicalHostname ||
    actual.locale !== expected.locale ||
    actual.currency !== expected.currency ||
    actual.priceListRevision !== expected.priceListRevision ||
    actual.publicationGeneration !== expected.publicationGeneration ||
    content.themeRevision !== bootstrap.themeRevision ||
    content.layoutRevision !== bootstrap.layoutRevision
  ) {
    throw new StorefrontContractError("Storefront public content scope mismatch.");
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
        if (shouldResolveContent) {
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

        const renderOptions = {
          buildId: environment.buildId,
          headOnly,
          ...(content ? { content } : {}),
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
