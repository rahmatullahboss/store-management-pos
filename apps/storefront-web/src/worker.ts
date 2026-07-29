import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
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

export interface StorefrontWorkerOptions {
  readonly resolverFactory?: StorefrontResolverFactory;
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

export function createStorefrontWorker(
  options: StorefrontWorkerOptions = {},
): StorefrontWorker {
  const resolverFactory = options.resolverFactory ?? defaultResolverFactory;

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

        const renderOptions =
          options.theme === undefined
            ? { buildId: environment.buildId, headOnly }
            : { buildId: environment.buildId, headOnly, theme: options.theme };
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
