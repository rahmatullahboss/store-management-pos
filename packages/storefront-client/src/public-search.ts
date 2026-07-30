import {
  StorefrontClientError,
  type StorefrontTransport,
} from "./index.js";
import {
  parseStorefrontPublicSearchPageV1,
  type StorefrontPublicAvailabilityFacetValueV1,
  type StorefrontPublicSearchPageV1,
} from "../../storefront-contracts/src/public-discovery.js";

export interface StorefrontPublicSearchClientOptions {
  readonly category?: string;
  readonly availability?: StorefrontPublicAvailabilityFacetValueV1;
  readonly limit?: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface StorefrontPublicSearchClientConfiguration {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

export interface StorefrontPublicSearchSelectionV1
  extends StorefrontPublicSearchPageV1 {
  readonly selectedCategory: string | null;
  readonly selectedAvailability: StorefrontPublicAvailabilityFacetValueV1 | null;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new StorefrontClientError(
      "STOREFRONT_CLIENT_CONFIGURATION",
      "Storefront client requires an HTTPS API base URL.",
      500,
    );
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  url.search = "";
  url.hash = "";
  return url;
}

function normalizeHostname(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  if (normalized.length === 0) {
    throw new StorefrontClientError(
      "STOREFRONT_CLIENT_REQUEST",
      "Storefront hostname is required.",
      400,
    );
  }
  return normalized;
}

function normalizeQuery(value: string): string {
  const normalized = value.trim();
  if (
    [...normalized].length < 2 ||
    [...normalized].length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontClientError(
      "STOREFRONT_CLIENT_REQUEST",
      "Storefront search query is invalid.",
      400,
    );
  }
  return normalized;
}

function fetchTransport(): StorefrontTransport {
  return Object.freeze({
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return fetch(input, init);
    },
  });
}

export async function requestStorefrontPublicSearch(
  configuration: StorefrontPublicSearchClientConfiguration,
  hostname: string,
  query: string,
  options: StorefrontPublicSearchClientOptions = {},
): Promise<StorefrontPublicSearchSelectionV1> {
  const baseUrl = normalizeBaseUrl(configuration.baseUrl);
  const target = new URL(`${baseUrl.pathname}/v1/storefront/search`, baseUrl);
  target.searchParams.set("hostname", normalizeHostname(hostname));
  target.searchParams.set("q", normalizeQuery(query));
  if (options.category) target.searchParams.set("category", options.category);
  if (options.availability) {
    target.searchParams.set("availability", options.availability);
  }
  if (options.limit !== undefined) {
    target.searchParams.set("limit", String(options.limit));
  }
  if (options.cursor) target.searchParams.set("cursor", options.cursor);

  const timeoutMs = configuration.timeoutMs ?? 5_000;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort("storefront-search-timeout"), timeoutMs);
  try {
    const response = await (configuration.transport ?? fetchTransport()).fetch(
      target,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new StorefrontClientError(
        "STOREFRONT_CLIENT_HTTP",
        `Storefront search failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const page = parseStorefrontPublicSearchPageV1(await response.json());
    return Object.freeze({
      ...page,
      selectedCategory: options.category ?? null,
      selectedAvailability: options.availability ?? null,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
