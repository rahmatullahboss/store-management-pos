import type { StorefrontTransport } from "../../../packages/storefront-client/src/index.js";
import { requestStorefrontPublicCacheGenerations } from "../../../packages/storefront-client/src/public-cache.js";
import { normalizeStorefrontHostname } from "../../../packages/storefront-contracts/src/index.js";
import {
  classifyStorefrontPublicCacheFamily,
  createStorefrontCacheFamilyKey,
} from "./cache-family.js";

export interface StorefrontPublicCacheBindings {
  readonly STOREFRONT_API_BASE_URL: string;
  readonly STOREFRONT_BUILD_ID: string;
  readonly STOREFRONT_API?: StorefrontTransport;
}

function transport(value: unknown): StorefrontTransport | undefined {
  return typeof value === "object" && value !== null && "fetch" in value &&
      typeof value.fetch === "function"
    ? value as StorefrontTransport
    : undefined;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function responseWithHeaders(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bypass(response: Response, reason: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
  headers.delete("ETag");
  headers.set("X-Storefront-Cache-State", "bypass");
  headers.set("X-Storefront-Cache-Reason", reason.slice(0, 80));
  return responseWithHeaders(response, headers);
}

async function resourceToken(url: URL): Promise<string> {
  const pathname = url.pathname.replace(/^\/+|\/+$/gu, "") || "root";
  if (!url.search) return pathname;
  const sorted = new URLSearchParams(url.searchParams);
  sorted.sort();
  return `${pathname}/query-${(await sha256(sorted.toString())).slice(0, 24)}`;
}

export async function bindStorefrontPublicCacheGeneration(
  request: Request,
  bindings: StorefrontPublicCacheBindings,
  response: Response,
): Promise<Response> {
  if (
    response.status !== 200 ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return response;
  }
  const url = new URL(request.url);
  const family = classifyStorefrontPublicCacheFamily(url.pathname);
  if (!family) return response;

  try {
    const selectedTransport = transport(bindings.STOREFRONT_API);
    const bundle = await requestStorefrontPublicCacheGenerations(
      {
        baseUrl: bindings.STOREFRONT_API_BASE_URL,
        ...(selectedTransport ? { transport: selectedTransport } : {}),
        timeoutMs: 1_000,
      },
      normalizeStorefrontHostname(url.hostname),
      request.signal,
    );
    const generation = bundle.generations[family];
    const key = createStorefrontCacheFamilyKey({
      context: bundle.context,
      buildId: bindings.STOREFRONT_BUILD_ID,
      family,
      generation,
      resource: await resourceToken(url),
    });
    const headers = new Headers(response.headers);
    headers.set(
      "ETag",
      `W/\"${(await sha256(`${headers.get("etag") ?? "no-etag"}:${key}`)).slice(0, 32)}\"`,
    );
    headers.set("X-Storefront-Cache-State", "generation-bound");
    headers.set("X-Storefront-Cache-Family", family);
    return responseWithHeaders(response, headers);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.name : "generation-unavailable";
    return bypass(response, reason);
  }
}
