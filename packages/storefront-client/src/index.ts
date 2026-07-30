import {
  normalizeStorefrontHostname,
  parseStorefrontBootstrapV1,
  type StorefrontBootstrapV1,
} from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontPublicContentBundleV1,
  type StorefrontPublicContentBundleV1,
} from "../../storefront-contracts/src/public-content.js";

export interface StorefrontTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface StorefrontContentRequestOptions {
  readonly signal?: AbortSignal;
  readonly slug?: string;
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

function normalizeContentSlug(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u.test(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new StorefrontClientError("Invalid storefront content slug.");
  }
  return normalized;
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
      const slug = normalizeContentSlug(requestOptions.slug);
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
  });
}
