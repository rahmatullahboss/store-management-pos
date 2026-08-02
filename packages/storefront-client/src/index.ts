import {
  normalizeStorefrontHostname,
  parseStorefrontBootstrapV1,
  type StorefrontBootstrapV1,
} from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontPublicCatalogPageV1,
  parseStorefrontPublicProductDetailV1,
  type StorefrontPublicCatalogPageV1,
  type StorefrontPublicProductDetailV1,
} from "../../storefront-contracts/src/public-catalog.js";
import {
  parseStorefrontPublicContentBundleV1,
  type StorefrontPublicContentBundleV1,
} from "../../storefront-contracts/src/public-content.js";
import {
  parseStorefrontPublicCategoryPageV1,
  parseStorefrontPublicCollectionPageV1,
  parseStorefrontPublicSearchPageV1,
  type StorefrontPublicCategoryPageV1,
  type StorefrontPublicCollectionPageV1,
  type StorefrontPublicSearchPageV1,
} from "../../storefront-contracts/src/public-discovery.js";

export interface StorefrontTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface StorefrontContentRequestOptions {
  readonly signal?: AbortSignal;
  readonly slug?: string;
}

export interface StorefrontCatalogRequestOptions {
  readonly signal?: AbortSignal;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface StorefrontClient {
  getBootstrap(
    requestHostname: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StorefrontBootstrapV1>;
  getContent(
    requestHostname: string,
    options?: StorefrontContentRequestOptions,
  ): Promise<StorefrontPublicContentBundleV1>;
  getCatalog(
    requestHostname: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicCatalogPageV1>;
  getProduct(
    requestHostname: string,
    publicSlug: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StorefrontPublicProductDetailV1>;
  getCategory(
    requestHostname: string,
    publicSlug: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicCategoryPageV1>;
  getCollection(
    requestHostname: string,
    publicSlug: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicCollectionPageV1>;
  search(
    requestHostname: string,
    query: string,
    options?: StorefrontCatalogRequestOptions,
  ): Promise<StorefrontPublicSearchPageV1>;
}

export interface StorefrontClientOptions {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

export class StorefrontClientError extends Error {
  public readonly status: number | null;

  public constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "StorefrontClientError";
    this.status = status;
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorefrontClientError("Invalid storefront API base URL.");
  }

  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new StorefrontClientError("Unsafe storefront API base URL.");
  }

  return url.toString().replace(/\/$/, "");
}

function createTimedSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  const timeout = setTimeout(
    () => controller.abort(new Error("Storefront request timed out.")),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizePublicSlug(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    !PUBLIC_SLUG.test(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new StorefrontClientError(`Invalid storefront ${label} slug.`);
  }
  return normalized;
}

function normalizeSearchQuery(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontClientError("Invalid storefront search query.");
  }
  return normalized;
}

function normalizeCatalogLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 48) {
    throw new StorefrontClientError("Invalid storefront catalog limit.");
  }
  return value;
}

function normalizeCatalogCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) {
    throw new StorefrontClientError("Invalid storefront catalog cursor.");
  }
  return normalized;
}

function applyPageOptions(
  endpoint: URL,
  options: StorefrontCatalogRequestOptions,
): void {
  const limit = normalizeCatalogLimit(options.limit);
  const cursor = normalizeCatalogCursor(options.cursor);
  if (limit !== undefined) endpoint.searchParams.set("limit", String(limit));
  if (cursor !== undefined) endpoint.searchParams.set("cursor", cursor);
}

export function createStorefrontClient(
  options: StorefrontClientOptions,
): StorefrontClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const transport = options.transport ?? { fetch: globalThis.fetch.bind(globalThis) };
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new StorefrontClientError("Invalid storefront client timeout.");
  }

  async function requestJson<T>(
    endpoint: URL,
    signal: AbortSignal | undefined,
    parse: (payload: unknown) => T,
    failureMessage: string,
  ): Promise<T> {
    const timed = createTimedSignal(signal, timeoutMs);
    try {
      const response = await transport.fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: timed.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new StorefrontClientError(failureMessage, response.status);
      }
      return parse(await response.json());
    } catch (error: unknown) {
      if (error instanceof StorefrontClientError) throw error;
      if (timed.signal.aborted) {
        throw new StorefrontClientError("Storefront request aborted.");
      }
      throw new StorefrontClientError(failureMessage);
    } finally {
      timed.dispose();
    }
  }

  async function pageRequest<T>(input: {
    readonly hostname: string;
    readonly endpoint: URL;
    readonly options: StorefrontCatalogRequestOptions;
    readonly parse: (payload: unknown) => T;
    readonly failureMessage: string;
    readonly mismatchMessage: string;
  }): Promise<T> {
    input.endpoint.searchParams.set("hostname", input.hostname);
    applyPageOptions(input.endpoint, input.options);
    const page = await requestJson(
      input.endpoint,
      input.options.signal,
      input.parse,
      input.failureMessage,
    );
    const scoped = page as { readonly context: { readonly requestHostname: string } };
    if (scoped.context.requestHostname !== input.hostname) {
      throw new StorefrontClientError(input.mismatchMessage);
    }
    return page;
  }

  return Object.freeze({
    async getBootstrap(
      requestHostname: string,
      requestOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<StorefrontBootstrapV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const endpoint = new URL("/v1/storefront/bootstrap", baseUrl);
      endpoint.searchParams.set("hostname", hostname);
      return await requestJson(
        endpoint,
        requestOptions.signal,
        parseStorefrontBootstrapV1,
        "Storefront bootstrap request failed.",
      );
    },

    async getContent(
      requestHostname: string,
      requestOptions: StorefrontContentRequestOptions = {},
    ): Promise<StorefrontPublicContentBundleV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const endpoint = new URL("/v1/storefront/content", baseUrl);
      endpoint.searchParams.set("hostname", hostname);
      const slug = normalizePublicSlug(requestOptions.slug, "content");
      if (slug !== undefined) endpoint.searchParams.set("slug", slug);
      const content = await requestJson(
        endpoint,
        requestOptions.signal,
        parseStorefrontPublicContentBundleV1,
        "Storefront content request failed.",
      );
      if (content.context.requestHostname !== hostname) {
        throw new StorefrontClientError("Storefront content hostname mismatch.");
      }
      return content;
    },

    async getCatalog(
      requestHostname: string,
      requestOptions: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCatalogPageV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      return await pageRequest({
        hostname,
        endpoint: new URL("/v1/storefront/catalog", baseUrl),
        options: requestOptions,
        parse: parseStorefrontPublicCatalogPageV1,
        failureMessage: "Storefront catalog request failed.",
        mismatchMessage: "Storefront catalog hostname mismatch.",
      });
    },

    async getProduct(
      requestHostname: string,
      publicSlug: string,
      requestOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<StorefrontPublicProductDetailV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const slug = normalizePublicSlug(publicSlug, "product");
      if (slug === undefined) {
        throw new StorefrontClientError("Storefront product slug is required.");
      }
      const endpoint = new URL(
        `/v1/storefront/products/${encodeURIComponent(slug)}`,
        baseUrl,
      );
      endpoint.searchParams.set("hostname", hostname);
      const product = await requestJson(
        endpoint,
        requestOptions.signal,
        parseStorefrontPublicProductDetailV1,
        "Storefront product request failed.",
      );
      if (product.context.requestHostname !== hostname) {
        throw new StorefrontClientError("Storefront product hostname mismatch.");
      }
      return product;
    },

    async getCategory(
      requestHostname: string,
      publicSlug: string,
      requestOptions: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCategoryPageV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const slug = normalizePublicSlug(publicSlug, "category");
      if (slug === undefined) {
        throw new StorefrontClientError("Storefront category slug is required.");
      }
      return await pageRequest({
        hostname,
        endpoint: new URL(
          `/v1/storefront/categories/${encodeURIComponent(slug)}`,
          baseUrl,
        ),
        options: requestOptions,
        parse: parseStorefrontPublicCategoryPageV1,
        failureMessage: "Storefront category request failed.",
        mismatchMessage: "Storefront category hostname mismatch.",
      });
    },

    async getCollection(
      requestHostname: string,
      publicSlug: string,
      requestOptions: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicCollectionPageV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const slug = normalizePublicSlug(publicSlug, "collection");
      if (slug === undefined) {
        throw new StorefrontClientError("Storefront collection slug is required.");
      }
      return await pageRequest({
        hostname,
        endpoint: new URL(
          `/v1/storefront/collections/${encodeURIComponent(slug)}`,
          baseUrl,
        ),
        options: requestOptions,
        parse: parseStorefrontPublicCollectionPageV1,
        failureMessage: "Storefront collection request failed.",
        mismatchMessage: "Storefront collection hostname mismatch.",
      });
    },

    async search(
      requestHostname: string,
      query: string,
      requestOptions: StorefrontCatalogRequestOptions = {},
    ): Promise<StorefrontPublicSearchPageV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const endpoint = new URL("/v1/storefront/search", baseUrl);
      endpoint.searchParams.set("q", normalizeSearchQuery(query));
      return await pageRequest({
        hostname,
        endpoint,
        options: requestOptions,
        parse: parseStorefrontPublicSearchPageV1,
        failureMessage: "Storefront search request failed.",
        mismatchMessage: "Storefront search hostname mismatch.",
      });
    },
  });
}
