import {
  StorefrontClientError,
  type StorefrontTransport,
} from "./index.js";
import { normalizeStorefrontHostname } from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontCheckoutCapabilityEnvelopeV1,
  parseStorefrontCheckoutCapabilityRequestV1,
  type StorefrontCheckoutCapabilityEnvelopeV1,
  type StorefrontCheckoutCapabilityRequestV1,
} from "../../storefront-contracts/src/checkout-capabilities.js";

export interface StorefrontCheckoutCapabilityClientConfiguration {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorefrontClientError(
      "Invalid storefront checkout capability API base URL.",
      500,
    );
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
      "Storefront checkout capability requires a safe HTTPS API base URL.",
      500,
    );
  }
  return url;
}

function appendBasePath(target: URL, pathname: string): void {
  const basePath = target.pathname.replace(/\/+$/u, "");
  target.pathname = `${basePath}${pathname}`;
}

function fetchTransport(): StorefrontTransport {
  return Object.freeze({
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return fetch(input, init);
    },
  });
}

export async function requestStorefrontCheckoutCapabilities(
  configuration: StorefrontCheckoutCapabilityClientConfiguration,
  hostname: string,
  payload: StorefrontCheckoutCapabilityRequestV1 | unknown,
  signal?: AbortSignal,
): Promise<StorefrontCheckoutCapabilityEnvelopeV1> {
  const target = normalizeBaseUrl(configuration.baseUrl);
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  const request = parseStorefrontCheckoutCapabilityRequestV1(payload);
  appendBasePath(target, "/v1/storefront/checkout/capabilities");
  target.search = "";
  target.hash = "";
  target.searchParams.set("hostname", normalizedHostname);

  const timeoutMs = configuration.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new StorefrontClientError(
      "Invalid storefront checkout capability timeout.",
      500,
    );
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort("storefront-checkout-capability-timeout"),
    timeoutMs,
  );

  try {
    const response = await (configuration.transport ?? fetchTransport()).fetch(
      target,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new StorefrontClientError(
        `Storefront checkout capability request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const envelope = parseStorefrontCheckoutCapabilityEnvelopeV1(
      await response.json(),
    );
    if (
      envelope.context.requestHostname !== normalizedHostname ||
      envelope.quoteId !== request.quoteId ||
      envelope.quoteRevision !== request.quoteRevision
    ) {
      throw new StorefrontClientError(
        "Storefront checkout capability scope mismatch.",
      );
    }
    return envelope;
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError) throw error;
    if (controller.signal.aborted) {
      throw new StorefrontClientError(
        "Storefront checkout capability request aborted.",
      );
    }
    throw new StorefrontClientError(
      "Storefront checkout capability request failed.",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
