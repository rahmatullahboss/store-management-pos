import {
  StorefrontClientError,
  type StorefrontTransport,
} from "./index.js";
import { normalizeStorefrontHostname } from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontPublicCacheGenerationBundleV1,
  type StorefrontPublicCacheGenerationBundleV1,
} from "../../storefront-contracts/src/public-cache.js";

export interface StorefrontPublicCacheClientConfiguration {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorefrontClientError("Invalid storefront cache API base URL.", 500);
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new StorefrontClientError(
      "Storefront cache generations require a safe HTTPS API base URL.",
      500,
    );
  }
  url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  return url;
}

function fetchTransport(): StorefrontTransport {
  return Object.freeze({
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return fetch(input, init);
    },
  });
}

export async function requestStorefrontPublicCacheGenerations(
  configuration: StorefrontPublicCacheClientConfiguration,
  hostname: string,
  signal?: AbortSignal,
): Promise<StorefrontPublicCacheGenerationBundleV1> {
  const target = normalizeBaseUrl(configuration.baseUrl);
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  target.pathname = `${target.pathname}/v1/storefront/cache-generations`;
  target.search = "";
  target.hash = "";
  target.searchParams.set("hostname", normalizedHostname);

  const timeoutMs = configuration.timeoutMs ?? 1_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new StorefrontClientError("Invalid storefront cache-generation timeout.", 500);
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort("storefront-cache-generation-timeout"),
    timeoutMs,
  );

  try {
    const response = await (configuration.transport ?? fetchTransport()).fetch(
      target,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new StorefrontClientError(
        `Storefront cache generation request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const bundle = parseStorefrontPublicCacheGenerationBundleV1(await response.json());
    if (bundle.context.requestHostname !== normalizedHostname) {
      throw new StorefrontClientError("Storefront cache generation hostname mismatch.");
    }
    return bundle;
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError) throw error;
    if (controller.signal.aborted) {
      throw new StorefrontClientError("Storefront cache generation request aborted.");
    }
    throw new StorefrontClientError("Storefront cache generation request failed.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
