import {
  normalizeStorefrontHostname,
  parseStorefrontBootstrapV1,
  type StorefrontBootstrapV1,
} from "../../storefront-contracts/src/index.js";

export interface StorefrontTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface StorefrontClient {
  getBootstrap(
    requestHostname: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StorefrontBootstrapV1>;
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

export function createStorefrontClient(
  options: StorefrontClientOptions,
): StorefrontClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const transport = options.transport ?? { fetch: globalThis.fetch.bind(globalThis) };
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new StorefrontClientError("Invalid storefront client timeout.");
  }

  return Object.freeze({
    async getBootstrap(
      requestHostname: string,
      requestOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<StorefrontBootstrapV1> {
      const hostname = normalizeStorefrontHostname(requestHostname);
      const timed = createTimedSignal(requestOptions.signal, timeoutMs);
      try {
        const endpoint = new URL("/v1/storefront/bootstrap", baseUrl);
        endpoint.searchParams.set("hostname", hostname);
        const response = await transport.fetch(endpoint, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: timed.signal,
        });

        if (!response.ok) {
          await response.body?.cancel();
          throw new StorefrontClientError(
            "Storefront bootstrap request failed.",
            response.status,
          );
        }

        const payload: unknown = await response.json();
        return parseStorefrontBootstrapV1(payload);
      } catch (error: unknown) {
        if (error instanceof StorefrontClientError) throw error;
        if (timed.signal.aborted) {
          throw new StorefrontClientError("Storefront bootstrap request aborted.");
        }
        throw new StorefrontClientError("Storefront bootstrap request failed.");
      } finally {
        timed.dispose();
      }
    },
  });
}
