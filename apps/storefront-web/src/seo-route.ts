import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import { requestStorefrontPublicSeo } from "../../../packages/storefront-client/src/public-seo.js";
import type { StorefrontHostContextV1 } from "../../../packages/storefront-contracts/src/index.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import type { StorefrontPublicSeoBundleV1 } from "../../../packages/storefront-contracts/src/public-seo.js";
import {
  parseStorefrontRuntimeEnvironment,
  StorefrontEnvironmentError,
} from "./environment.js";
import {
  renderStorefrontRobotsTxt,
  renderStorefrontSitemapXml,
} from "./seo.js";
import { storefrontRequestHostname } from "./runtime.js";
import type { StorefrontWorkerBindings } from "./worker.js";

function isStorefrontTransport(value: unknown): value is StorefrontTransport {
  return (
    typeof value === "object" &&
    value !== null &&
    "fetch" in value &&
    typeof value.fetch === "function"
  );
}

function withoutBody(request: Request, response: Response): Response {
  return request.method === "HEAD"
    ? new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response;
}

function publicFailure(
  request: Request,
  status: 404 | 405 | 503,
  code: string,
  message: string,
): Response {
  return withoutBody(
    request,
    Response.json(
      { error: { code, message } },
      {
        status,
        headers: {
          ...(status === 405 ? { Allow: "GET, HEAD" } : {}),
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        },
      },
    ),
  );
}

function assertSamePublicContext(
  expected: StorefrontHostContextV1,
  actual: StorefrontHostContextV1,
): void {
  for (const key of [
    "tenantId",
    "storefrontId",
    "salesChannelId",
    "requestHostname",
    "canonicalHostname",
    "locale",
    "currency",
    "priceListRevision",
    "publicationGeneration",
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new StorefrontContractError(
        `Storefront public SEO ${key} scope mismatch.`,
      );
    }
  }
}

async function weakEtag(bundle: StorefrontPublicSeoBundleV1, path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode([
      bundle.context.tenantId,
      bundle.context.storefrontId,
      bundle.context.canonicalHostname,
      bundle.context.locale,
      bundle.context.currency,
      bundle.context.priceListRevision,
      bundle.context.publicationGeneration,
      path,
    ].join(":")),
  );
  const value = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `W/\"${value}\"`;
}

function canonicalRedirect(request: Request, hostname: string): Response {
  const target = new URL(request.url);
  target.protocol = "https:";
  target.hostname = hostname;
  target.port = "";
  target.search = "";
  target.hash = "";
  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=300",
      Location: target.toString(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleStorefrontSeoRoute(
  request: Request,
  bindings: StorefrontWorkerBindings,
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = url.pathname === "/robots.txt"
    ? "robots"
    : url.pathname === "/sitemap.xml"
      ? "sitemap"
      : null;
  if (route === null) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return publicFailure(
      request,
      405,
      "METHOD_NOT_ALLOWED",
      "Only GET and HEAD are supported.",
    );
  }

  try {
    const environment = parseStorefrontRuntimeEnvironment(bindings);
    const hostname = storefrontRequestHostname(request);
    const transport = isStorefrontTransport(bindings.STOREFRONT_API)
      ? bindings.STOREFRONT_API
      : undefined;
    const client = createStorefrontClient({
      baseUrl: environment.apiBaseUrl,
      ...(transport ? { transport } : {}),
    });
    const bootstrap = await client.getBootstrap(hostname, {
      signal: request.signal,
    });
    if (bootstrap.context.canonicalHostname !== hostname) {
      return canonicalRedirect(request, bootstrap.context.canonicalHostname);
    }
    const seo = await requestStorefrontPublicSeo(
      {
        baseUrl: environment.apiBaseUrl,
        ...(transport ? { transport } : {}),
      },
      hostname,
      request.signal,
    );
    assertSamePublicContext(bootstrap.context, seo.context);

    const body = route === "robots"
      ? renderStorefrontRobotsTxt(seo)
      : renderStorefrontSitemapXml(seo);
    const response = new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": route === "robots"
          ? "public, max-age=0, s-maxage=300, stale-while-revalidate=900"
          : "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
        "Content-Language": seo.context.locale,
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Content-Type": route === "robots"
          ? "text/plain; charset=utf-8"
          : "application/xml; charset=utf-8",
        ETag: await weakEtag(seo, url.pathname),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    });
    return withoutBody(request, response);
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError && error.status === 404) {
      return publicFailure(
        request,
        404,
        "STOREFRONT_UNAVAILABLE",
        "This storefront is not available.",
      );
    }
    if (
      error instanceof StorefrontEnvironmentError ||
      error instanceof StorefrontClientError ||
      error instanceof StorefrontContractError
    ) {
      return publicFailure(
        request,
        503,
        "STOREFRONT_TEMPORARILY_UNAVAILABLE",
        "This storefront is temporarily unavailable.",
      );
    }
    throw error;
  }
}
