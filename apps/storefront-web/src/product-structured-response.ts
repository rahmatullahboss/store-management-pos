import {
  createStorefrontClient,
  StorefrontClientError,
  type StorefrontTransport,
} from "../../../packages/storefront-client/src/index.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontRuntimeEnvironment,
  StorefrontEnvironmentError,
} from "./environment.js";
import { storefrontRequestHostname } from "./runtime.js";
import {
  renderStorefrontProductStructuredData,
  serializeStorefrontProductStructuredData,
} from "./seo.js";
import type { StorefrontWorkerBindings } from "./worker.js";

const PRODUCT_PATH = /^\/products\/([^/]+)$/u;
const ROBOTS_MARKER = '<meta name="robots" content="noindex,follow">';

function isStorefrontTransport(value: unknown): value is StorefrontTransport {
  return (
    typeof value === "object" &&
    value !== null &&
    "fetch" in value &&
    typeof value.fetch === "function"
  );
}

function productSlug(pathname: string): string | null {
  const match = pathname.match(PRODUCT_PATH);
  if (!match?.[1]) return null;
  try {
    const slug = decodeURIComponent(match[1]).trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u.test(slug) &&
        slug !== "." &&
        slug !== ".."
      ? slug
      : null;
  } catch {
    return null;
  }
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function structuredEtag(
  currentEtag: string | null,
  structuredData: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${currentEtag ?? ""}:${structuredData}`),
  );
  const prefix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `W/\"${prefix}\"`;
}

function responseFromText(
  original: Response,
  body: string | null,
  headers: Headers,
): Response {
  headers.delete("Content-Length");
  return new Response(body, {
    status: original.status,
    statusText: original.statusText,
    headers,
  });
}

export async function enrichStorefrontProductStructuredData(
  request: Request,
  bindings: StorefrontWorkerBindings,
  response: Response,
): Promise<Response> {
  const slug = productSlug(new URL(request.url).pathname);
  if (
    slug === null ||
    response.status !== 200 ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return response;
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/html")) return response;

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
    const detail = await client.getProduct(hostname, slug, {
      signal: request.signal,
    });
    if (
      detail.context.requestHostname !== hostname ||
      detail.context.canonicalHostname !== hostname
    ) {
      throw new StorefrontContractError(
        "Storefront structured-data hostname scope mismatch.",
      );
    }

    const structuredDataJson = serializeStorefrontProductStructuredData(detail);
    const scriptHash = await sha256Base64(structuredDataJson);
    const headers = new Headers(response.headers);
    const currentPolicy = headers.get("Content-Security-Policy") ?? "";
    const cspMarker = "script-src 'none'";
    if (currentPolicy.split(cspMarker).length !== 2) return response;
    headers.set(
      "Content-Security-Policy",
      currentPolicy.replace(cspMarker, `script-src 'sha256-${scriptHash}'`),
    );
    headers.set(
      "ETag",
      await structuredEtag(headers.get("ETag"), structuredDataJson),
    );
    headers.set("X-Storefront-Structured-Data", "product.v1");

    if (request.method === "HEAD") {
      return responseFromText(response, null, headers);
    }

    const html = await response.text();
    const headMarker = "</head>";
    const markerIndex = html.indexOf(headMarker);
    if (
      markerIndex < 0 ||
      markerIndex !== html.lastIndexOf(headMarker) ||
      html.split(ROBOTS_MARKER).length !== 2
    ) {
      return responseFromText(response, html, new Headers(response.headers));
    }
    const structuredData = renderStorefrontProductStructuredData(detail);
    const indexedHtml = html.replace(
      ROBOTS_MARKER,
      '<meta name="robots" content="index,follow">',
    );
    const indexedMarker = indexedHtml.indexOf(headMarker);
    const body = `${indexedHtml.slice(0, indexedMarker)}  ${structuredData}\n${indexedHtml.slice(indexedMarker)}`;
    return responseFromText(response, body, headers);
  } catch (error: unknown) {
    if (
      error instanceof StorefrontClientError ||
      error instanceof StorefrontContractError ||
      error instanceof StorefrontEnvironmentError
    ) {
      return response;
    }
    throw error;
  }
}
