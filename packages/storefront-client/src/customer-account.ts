import {
  StorefrontClientError,
  type StorefrontTransport,
} from "./index.js";
import { normalizeStorefrontHostname } from "../../storefront-contracts/src/index.js";
import {
  parseStorefrontCustomerAccountV1,
  parseStorefrontOrderDetailV1,
  parseStorefrontOrderHistoryPageV1,
  parseStorefrontOrderHistoryRequestV1,
  type StorefrontCustomerAccountV1,
  type StorefrontOrderDetailV1,
  type StorefrontOrderHistoryPageV1,
} from "../../storefront-contracts/src/customer-account.js";

export interface StorefrontCustomerAccountClientConfiguration {
  readonly baseUrl: string;
  readonly transport?: StorefrontTransport;
  readonly timeoutMs?: number;
}

export interface StorefrontCustomerOrderHistoryOptions {
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorefrontClientError(
      "Invalid storefront customer account API base URL.",
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
      "Storefront customer account requires a safe HTTPS API base URL.",
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

function timeout(configuration: StorefrontCustomerAccountClientConfiguration): number {
  const value = configuration.timeoutMs ?? 5_000;
  if (!Number.isInteger(value) || value < 100 || value > 30_000) {
    throw new StorefrontClientError("Invalid storefront customer account timeout.", 500);
  }
  return value;
}

function orderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) {
    throw new StorefrontClientError("Invalid storefront customer order ID.");
  }
  return normalized;
}

async function requestJson<T>(input: {
  readonly configuration: StorefrontCustomerAccountClientConfiguration;
  readonly hostname: string;
  readonly pathname: string;
  readonly signal?: AbortSignal | undefined;
  readonly parse: (value: unknown) => T;
  readonly failureMessage: string;
}): Promise<T> {
  const target = normalizeBaseUrl(input.configuration.baseUrl);
  const hostname = normalizeStorefrontHostname(input.hostname);
  appendBasePath(target, input.pathname);
  target.search = "";
  target.hash = "";
  target.searchParams.set("hostname", hostname);

  const controller = new AbortController();
  const onAbort = (): void => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) onAbort();
  else input.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort("storefront-customer-account-timeout"),
    timeout(input.configuration),
  );

  try {
    const response = await (input.configuration.transport ?? fetchTransport()).fetch(
      target,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new StorefrontClientError(
        `${input.failureMessage} HTTP ${response.status}.`,
        response.status,
      );
    }
    const value = input.parse(await response.json());
    const scoped = value as { readonly context: { readonly requestHostname: string } };
    if (scoped.context.requestHostname !== hostname) {
      throw new StorefrontClientError("Storefront customer account hostname mismatch.");
    }
    return value;
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError) throw error;
    if (controller.signal.aborted) {
      throw new StorefrontClientError("Storefront customer account request aborted.");
    }
    throw new StorefrontClientError(input.failureMessage);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export async function requestStorefrontCustomerAccount(
  configuration: StorefrontCustomerAccountClientConfiguration,
  hostname: string,
  signal?: AbortSignal,
): Promise<StorefrontCustomerAccountV1> {
  return await requestJson({
    configuration,
    hostname,
    pathname: "/v1/storefront/account",
    signal,
    parse: parseStorefrontCustomerAccountV1,
    failureMessage: "Storefront customer account request failed.",
  });
}

export async function requestStorefrontCustomerOrders(
  configuration: StorefrontCustomerAccountClientConfiguration,
  hostname: string,
  options: StorefrontCustomerOrderHistoryOptions = {},
): Promise<StorefrontOrderHistoryPageV1> {
  const request = parseStorefrontOrderHistoryRequestV1({
    contractVersion: "storefront-order-history-request.v1",
    cursor: options.cursor ?? null,
    limit: options.limit ?? 20,
  });
  const target = normalizeBaseUrl(configuration.baseUrl);
  const normalizedHostname = normalizeStorefrontHostname(hostname);
  appendBasePath(target, "/v1/storefront/account/orders");
  target.search = "";
  target.hash = "";
  target.searchParams.set("hostname", normalizedHostname);
  target.searchParams.set("limit", String(request.limit));
  if (request.cursor) target.searchParams.set("cursor", request.cursor);

  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort("storefront-customer-orders-timeout"),
    timeout(configuration),
  );

  try {
    const response = await (configuration.transport ?? fetchTransport()).fetch(target, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new StorefrontClientError(
        `Storefront customer order history request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const page = parseStorefrontOrderHistoryPageV1(await response.json());
    if (page.context.requestHostname !== normalizedHostname) {
      throw new StorefrontClientError("Storefront customer order history hostname mismatch.");
    }
    return page;
  } catch (error: unknown) {
    if (error instanceof StorefrontClientError) throw error;
    if (controller.signal.aborted) {
      throw new StorefrontClientError("Storefront customer order history request aborted.");
    }
    throw new StorefrontClientError("Storefront customer order history request failed.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function requestStorefrontCustomerOrder(
  configuration: StorefrontCustomerAccountClientConfiguration,
  hostname: string,
  requestedOrderId: string,
  signal?: AbortSignal,
): Promise<StorefrontOrderDetailV1> {
  const normalizedOrderId = orderId(requestedOrderId);
  const detail = await requestJson({
    configuration,
    hostname,
    pathname: `/v1/storefront/account/orders/${encodeURIComponent(normalizedOrderId)}`,
    signal,
    parse: parseStorefrontOrderDetailV1,
    failureMessage: "Storefront customer order request failed.",
  });
  if (detail.orderId !== normalizedOrderId) {
    throw new StorefrontClientError("Storefront customer order identity mismatch.");
  }
  return detail;
}
