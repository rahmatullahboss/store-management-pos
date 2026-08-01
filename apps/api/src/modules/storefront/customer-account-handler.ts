import type { CustomerService } from "../../../../../modules/customer/src/index.js";
import {
  listStorefrontCustomerOrdersV1,
  readStorefrontCustomerAccountV1,
  readStorefrontCustomerOrderV1,
  type StorefrontAccountPrincipalV1,
  type StorefrontCustomerOrderReadPort,
} from "../../../../../modules/storefront/src/customer-account.js";
import type { StorefrontPublicRepository } from "../../../../../modules/storefront/src/public.js";
import {
  StorefrontContractError,
  normalizeStorefrontHostname,
  type StorefrontHostContextV1,
} from "../../../../../packages/storefront-contracts/src/index.js";
import { parseStorefrontOrderHistoryRequestV1 } from "../../../../../packages/storefront-contracts/src/customer-account.js";

export interface StorefrontAccountPrincipalResolverPort {
  resolve(input: {
    readonly request: Request;
    readonly context: StorefrontHostContextV1;
  }): Promise<StorefrontAccountPrincipalV1 | null>;
}

export interface StorefrontCustomerAccountHandlerDependencies {
  readonly repository: Pick<StorefrontPublicRepository, "resolveBootstrap">;
  readonly principalResolver: StorefrontAccountPrincipalResolverPort;
  readonly customerService: Pick<CustomerService, "get">;
  readonly orderRead: StorefrontCustomerOrderReadPort;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACCOUNT_PATH = "/v1/storefront/account";
const ORDERS_PATH = "/v1/storefront/account/orders";
const ORDER_DETAIL_PREFIX = "/v1/storefront/account/orders/";

function privateHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    Vary: "Authorization, Cookie",
    "X-Content-Type-Options": "nosniff",
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: privateHeaders(),
  });
}

function errorResponse(code: string, status: number, message?: string): Response {
  return jsonResponse(
    { error: { code, ...(message ? { message } : {}) } },
    status,
  );
}

function assertAllowedQuery(url: URL, allowed: ReadonlySet<string>): void {
  const unexpected = [...url.searchParams.keys()].filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Storefront customer account request contains unsupported query parameters: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function historyRequest(url: URL) {
  assertAllowedQuery(url, new Set(["hostname", "cursor", "limit"]));
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? 20 : Number(rawLimit);
  return parseStorefrontOrderHistoryRequestV1({
    contractVersion: "storefront-order-history-request.v1",
    cursor: url.searchParams.get("cursor"),
    limit,
  });
}

function detailOrderId(pathname: string): string | null {
  if (!pathname.startsWith(ORDER_DETAIL_PREFIX)) return null;
  const raw = pathname.slice(ORDER_DETAIL_PREFIX.length);
  if (raw.length === 0 || raw.includes("/")) {
    throw new StorefrontContractError("Storefront customer order path is invalid.");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    throw new StorefrontContractError("Storefront customer order path is invalid.");
  }
  if (!UUID.test(decoded)) {
    throw new StorefrontContractError("Storefront customer order ID must be a UUID.");
  }
  return decoded;
}

async function resolvePrivateContext(
  dependencies: StorefrontCustomerAccountHandlerDependencies,
  request: Request,
  url: URL,
): Promise<
  | { readonly context: StorefrontHostContextV1; readonly principal: StorefrontAccountPrincipalV1 }
  | Response
> {
  const hostname = normalizeStorefrontHostname(url.searchParams.get("hostname") ?? "");
  const bootstrap = await dependencies.repository.resolveBootstrap(hostname);
  if (!bootstrap) {
    return errorResponse("STOREFRONT_NOT_FOUND", 404);
  }
  if (bootstrap.context.requestHostname !== hostname) {
    throw new StorefrontContractError("Storefront customer account hostname scope mismatch.");
  }
  const principal = await dependencies.principalResolver.resolve({
    request,
    context: bootstrap.context,
  });
  if (!principal) {
    return errorResponse("AUTHENTICATION_REQUIRED", 401);
  }
  return { context: bootstrap.context, principal };
}

export async function handleStorefrontCustomerAccountRequest(
  dependencies: StorefrontCustomerAccountHandlerDependencies,
  request: Request,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") {
    const headers = privateHeaders();
    headers.set("Allow", "GET");
    return new Response(
      JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED" } }),
      { status: 405, headers },
    );
  }

  try {
    const pathname = url.pathname.replace(/\/+$/u, "") || "/";
    if (pathname === ACCOUNT_PATH) {
      assertAllowedQuery(url, new Set(["hostname"]));
    } else if (pathname === ORDERS_PATH) {
      historyRequest(url);
    } else {
      const orderId = detailOrderId(pathname);
      if (!orderId) return errorResponse("ACCOUNT_ROUTE_NOT_FOUND", 404);
      assertAllowedQuery(url, new Set(["hostname"]));
    }

    const resolved = await resolvePrivateContext(dependencies, request, url);
    if (resolved instanceof Response) return resolved;

    if (pathname === ACCOUNT_PATH) {
      return jsonResponse(
        await readStorefrontCustomerAccountV1(dependencies.customerService, {
          principal: resolved.principal,
          context: resolved.context,
        }),
      );
    }

    if (pathname === ORDERS_PATH) {
      return jsonResponse(
        await listStorefrontCustomerOrdersV1(dependencies.orderRead, {
          principal: resolved.principal,
          context: resolved.context,
          request: historyRequest(url),
        }),
      );
    }

    const orderId = detailOrderId(pathname);
    if (!orderId) return errorResponse("ACCOUNT_ROUTE_NOT_FOUND", 404);
    const order = await readStorefrontCustomerOrderV1(dependencies.orderRead, {
      principal: resolved.principal,
      context: resolved.context,
      orderId,
    });
    if (!order) return errorResponse("ORDER_NOT_FOUND", 404);
    return jsonResponse(order);
  } catch (error: unknown) {
    if (error instanceof StorefrontContractError) {
      const message = error.message;
      const malformed =
        message.includes("query parameters") ||
        message.startsWith("orderHistoryRequest.") ||
        message.includes("Unsupported storefront order history request contract") ||
        message.includes("request is invalid") ||
        message.includes("path is invalid") ||
        message.includes("ID must be a UUID") ||
        message.includes("hostname");
      if (malformed) {
        return errorResponse("INVALID_ACCOUNT_REQUEST", 400, message);
      }
      return errorResponse("ACCOUNT_ACCESS_DENIED", 403);
    }
    throw error;
  }
}
