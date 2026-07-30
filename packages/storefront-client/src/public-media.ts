import {
  StorefrontClientError,
  type StorefrontTransport,
} from "./index.js";
import { normalizeStorefrontHostname } from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontPublicMediaManifestV1,
  type StorefrontPublicMediaManifestV1,
} from "../../storefront-contracts/src/public-media.js";

export interface StorefrontPublicMediaClientConfiguration {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorefrontClientError("Invalid storefront media API base URL.", 500);
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
      "Storefront public media requires a safe HTTPS API base URL.",
      500,
    );
  }
  url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  return url;
}

function normalizeSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SLUG.test(normalized) || normalized === "." || normalized === "..") {
    throw new StorefrontClientError("Storefront media product slug is invalid.", 400);
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

export async function requestStorefrontPublicMedia(
  configuration: StorefrontPublicMediaClientConfiguration,
  hostname: string,
  publicSlug: string,
  signal?: AbortSignal,
): Promise<StorefrontPublicMediaManifestV1> {
  const target = normalizeBaseUrl(configuration.baseUrl);
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  const normalizedSlug = normalizeSlug(publicSlug);
  target.pathname = `${target.pathname}/v1/storefront/products/${encodeURIComponent(normalizedSlug)}/media`;
  target.search = "";
  target.hash = "";
  target.searchParams.set("hostname", normalizedHostname);

  const timeoutMs = configuration.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new StorefrontClientError("Invalid storefront media request timeout.", 500);
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort("storefront-media-timeout"),
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
        `Storefront media request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const manifest = parseStorefrontPublicMediaManifestV1(await response.json());
    if (
      manifest.context.requestHostname !== normalizedHostname ||
      manifest.slug !== normalizedSlug
    ) {
      throw new StorefrontClientError("Storefront media scope mismatch.");
    }
    return manifest;
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError) throw error;
    if (controller.signal.aborted) {
      throw new StorefrontClientError("Storefront media request aborted.");
    }
    throw new StorefrontClientError("Storefront media request failed.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
