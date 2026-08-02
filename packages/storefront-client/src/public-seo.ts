import {
  StorefrontClientError,
  type StorefrontTransport,
} from "./index.js";
import { normalizeStorefrontHostname } from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontPublicSeoBundleV1,
  type StorefrontPublicSeoBundleV1,
} from "../../storefront-contracts/src/public-seo.js";

export interface StorefrontPublicSeoClientConfiguration {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
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
    throw new StorefrontClientError(
      "Storefront public SEO requires a safe HTTPS API base URL.",
      500,
    );
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function fetchTransport(): StorefrontTransport {
  return Object.freeze({
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return fetch(input, init);
    },
  });
}

export async function requestStorefrontPublicSeo(
  configuration: StorefrontPublicSeoClientConfiguration,
  hostname: string,
  signal?: AbortSignal,
): Promise<StorefrontPublicSeoBundleV1> {
  const target = normalizeBaseUrl(configuration.baseUrl);
  const basePath = target.pathname === "/"
    ? ""
    : target.pathname.replace(/\/$/u, "");
  target.pathname = `${basePath}/v1/storefront/seo`;
  target.search = "";
  target.hash = "";
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  target.searchParams.set("hostname", normalizedHostname);

  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort("storefront-seo-timeout"),
    configuration.timeoutMs ?? 5_000,
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
        `Storefront SEO request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const bundle = parseStorefrontPublicSeoBundleV1(await response.json());
    if (bundle.context.requestHostname !== normalizedHostname) {
      throw new StorefrontClientError("Storefront SEO hostname mismatch.");
    }
    return bundle;
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError) throw error;
    if (controller.signal.aborted) {
      throw new StorefrontClientError("Storefront SEO request aborted.");
    }
    throw new StorefrontClientError("Storefront SEO request failed.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
