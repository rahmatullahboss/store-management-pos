import {
  StorefrontContractError,
  type StorefrontHostContextV1,
} from "../../../packages/storefront-contracts/src/index.js";

export type StorefrontAbusePolicyClassV1 =
  | "public_read"
  | "public_search"
  | "public_media"
  | "private_read"
  | "checkout_quote"
  | "checkout_submit"
  | "admin_mutation";

export type StorefrontAbuseUnavailableModeV1 =
  | "fail_open_observe"
  | "fail_closed";

export type StorefrontAbuseKeySourceV1 =
  | "trusted_edge"
  | "authenticated_session";

export interface StorefrontAbuseKeyV1 {
  readonly keyVersion: "storefront-abuse-key.v1";
  readonly source: StorefrontAbuseKeySourceV1;
  readonly opaqueKey: string;
}

export interface StorefrontAbuseControlRequestV1 {
  readonly requestVersion: "storefront-abuse-control-request.v1";
  readonly policyClass: StorefrontAbusePolicyClassV1;
  readonly unavailableMode: StorefrontAbuseUnavailableModeV1;
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly requestHostname: string;
  readonly authenticated: boolean;
  readonly abuseKey: StorefrontAbuseKeyV1;
}

export type StorefrontAbuseDecisionStateV1 = "allow" | "deny" | "unavailable";
export type StorefrontAbuseDecisionReasonV1 =
  | "within_limit"
  | "rate_limited"
  | "provider_unavailable"
  | "configuration_error";

export interface StorefrontAbuseControlDecisionV1 {
  readonly decisionVersion: "storefront-abuse-control-decision.v1";
  readonly state: StorefrontAbuseDecisionStateV1;
  readonly reason: StorefrontAbuseDecisionReasonV1;
  readonly policyRevision: string;
  readonly retryAfterSeconds: number | null;
}

const OPAQUE_KEY = /^[A-Za-z0-9_-]{16,256}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function policyDescriptor(
  policyClass: StorefrontAbusePolicyClassV1,
): { readonly unavailableMode: StorefrontAbuseUnavailableModeV1 } {
  switch (policyClass) {
    case "checkout_quote":
    case "checkout_submit":
    case "admin_mutation":
      return Object.freeze({ unavailableMode: "fail_closed" });
    case "public_read":
    case "public_search":
    case "public_media":
    case "private_read":
      return Object.freeze({ unavailableMode: "fail_open_observe" });
  }
}

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function isAccountPath(pathname: string): boolean {
  return (
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/v1/storefront/account" ||
    pathname.startsWith("/v1/storefront/account/")
  );
}

function isSearchPath(pathname: string): boolean {
  return (
    pathname === "/search" ||
    pathname === "/v1/storefront/public/search" ||
    pathname.startsWith("/v1/storefront/public/search/")
  );
}

function isMediaPath(pathname: string): boolean {
  return pathname.startsWith("/media/") || pathname.startsWith("/v1/storefront/public/media/");
}

function isCheckoutQuotePath(pathname: string): boolean {
  return (
    pathname === "/v1/storefront/cart/quote" ||
    pathname === "/v1/storefront/checkout/capabilities"
  );
}

function isCheckoutSubmitPath(pathname: string): boolean {
  return (
    pathname === "/v1/storefront/checkout/submit" ||
    pathname === "/v1/storefront/orders/submit"
  );
}

function isPublicReadPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/products" ||
    pathname.startsWith("/products/") ||
    pathname.startsWith("/categories/") ||
    pathname.startsWith("/collections/") ||
    pathname.startsWith("/pages/") ||
    pathname.startsWith("/v1/storefront/public/")
  );
}

export function classifyStorefrontAbusePolicyV1(input: {
  readonly method: string;
  readonly pathname: string;
  readonly authenticated: boolean;
}): StorefrontAbusePolicyClassV1 | null {
  const method = input.method.trim().toUpperCase();
  const pathname = input.pathname;
  if (!pathname.startsWith("/") || pathname.includes("\\")) {
    throw new StorefrontContractError("Storefront abuse-control pathname is invalid.");
  }

  if (isAccountPath(pathname) && isReadMethod(method)) {
    return input.authenticated ? "private_read" : null;
  }
  if (isCheckoutQuotePath(pathname) && method === "POST") return "checkout_quote";
  if (isCheckoutSubmitPath(pathname) && method === "POST") return "checkout_submit";
  if (isSearchPath(pathname) && isReadMethod(method)) return "public_search";
  if (isMediaPath(pathname) && isReadMethod(method)) return "public_media";
  if (isPublicReadPath(pathname) && isReadMethod(method)) return "public_read";
  if (pathname.startsWith("/v1/storefront/") && !isReadMethod(method)) {
    return "admin_mutation";
  }
  return null;
}

export function parseStorefrontAbuseKeyV1(value: unknown): StorefrontAbuseKeyV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError("Storefront abuse key must be an object.");
  }
  const source = value as Record<string, unknown>;
  const allowed = new Set(["keyVersion", "source", "opaqueKey"]);
  const unexpected = Object.keys(source).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Storefront abuse key contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (source.keyVersion !== "storefront-abuse-key.v1") {
    throw new StorefrontContractError("Unsupported storefront abuse key version.");
  }
  if (source.source !== "trusted_edge" && source.source !== "authenticated_session") {
    throw new StorefrontContractError("Storefront abuse key source is unsupported.");
  }
  if (typeof source.opaqueKey !== "string" || !OPAQUE_KEY.test(source.opaqueKey)) {
    throw new StorefrontContractError(
      "Storefront abuse key must be a bounded opaque base64url-like token.",
    );
  }
  return Object.freeze({
    keyVersion: "storefront-abuse-key.v1",
    source: source.source,
    opaqueKey: source.opaqueKey,
  });
}

export function createStorefrontAbuseControlRequestV1(input: {
  readonly request: Request;
  readonly context: StorefrontHostContextV1;
  readonly authenticated: boolean;
  readonly abuseKey: unknown;
}): StorefrontAbuseControlRequestV1 | null {
  const url = new URL(input.request.url);
  const policyClass = classifyStorefrontAbusePolicyV1({
    method: input.request.method,
    pathname: url.pathname,
    authenticated: input.authenticated,
  });
  if (!policyClass) return null;
  const abuseKey = parseStorefrontAbuseKeyV1(input.abuseKey);
  if (input.authenticated && abuseKey.source !== "authenticated_session") {
    throw new StorefrontContractError(
      "Authenticated storefront abuse control requires an authenticated-session key.",
    );
  }
  if (!input.authenticated && abuseKey.source !== "trusted_edge") {
    throw new StorefrontContractError(
      "Anonymous storefront abuse control requires a trusted-edge key.",
    );
  }
  return Object.freeze({
    requestVersion: "storefront-abuse-control-request.v1",
    policyClass,
    unavailableMode: policyDescriptor(policyClass).unavailableMode,
    tenantId: input.context.tenantId,
    storefrontId: input.context.storefrontId,
    requestHostname: input.context.requestHostname,
    authenticated: input.authenticated,
    abuseKey,
  });
}

export function parseStorefrontAbuseControlDecisionV1(
  value: unknown,
): StorefrontAbuseControlDecisionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError("Storefront abuse-control decision must be an object.");
  }
  const source = value as Record<string, unknown>;
  const allowed = new Set([
    "decisionVersion",
    "state",
    "reason",
    "policyRevision",
    "retryAfterSeconds",
  ]);
  const unexpected = Object.keys(source).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Storefront abuse-control decision contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (source.decisionVersion !== "storefront-abuse-control-decision.v1") {
    throw new StorefrontContractError("Unsupported storefront abuse-control decision version.");
  }
  if (source.state !== "allow" && source.state !== "deny" && source.state !== "unavailable") {
    throw new StorefrontContractError("Storefront abuse-control decision state is unsupported.");
  }
  const allowedReasons: readonly StorefrontAbuseDecisionReasonV1[] = [
    "within_limit",
    "rate_limited",
    "provider_unavailable",
    "configuration_error",
  ];
  if (typeof source.reason !== "string" || !allowedReasons.includes(source.reason as StorefrontAbuseDecisionReasonV1)) {
    throw new StorefrontContractError("Storefront abuse-control decision reason is unsupported.");
  }
  if (typeof source.policyRevision !== "string" || !REVISION.test(source.policyRevision)) {
    throw new StorefrontContractError("Storefront abuse-control policy revision is invalid.");
  }
  let retryAfterSeconds: number | null = null;
  if (source.retryAfterSeconds !== null && source.retryAfterSeconds !== undefined) {
    if (
      !Number.isInteger(source.retryAfterSeconds) ||
      (source.retryAfterSeconds as number) < 1 ||
      (source.retryAfterSeconds as number) > 86_400
    ) {
      throw new StorefrontContractError(
        "Storefront abuse-control retryAfterSeconds must be between 1 and 86400.",
      );
    }
    retryAfterSeconds = source.retryAfterSeconds as number;
  }
  if (source.state === "allow" && source.reason !== "within_limit") {
    throw new StorefrontContractError("Allowed abuse-control decisions must use within_limit reason.");
  }
  if (source.state === "deny" && source.reason !== "rate_limited") {
    throw new StorefrontContractError("Denied abuse-control decisions must use rate_limited reason.");
  }
  if (
    source.state === "unavailable" &&
    source.reason !== "provider_unavailable" &&
    source.reason !== "configuration_error"
  ) {
    throw new StorefrontContractError(
      "Unavailable abuse-control decisions must use an unavailable reason.",
    );
  }
  return Object.freeze({
    decisionVersion: "storefront-abuse-control-decision.v1",
    state: source.state,
    reason: source.reason as StorefrontAbuseDecisionReasonV1,
    policyRevision: source.policyRevision,
    retryAfterSeconds,
  });
}

function guardedHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
}

export function enforceStorefrontAbuseDecisionV1(input: {
  readonly request: StorefrontAbuseControlRequestV1;
  readonly decision: unknown;
}): Response | null {
  const decision = parseStorefrontAbuseControlDecisionV1(input.decision);
  if (decision.state === "allow") return null;
  if (
    decision.state === "unavailable" &&
    input.request.unavailableMode === "fail_open_observe"
  ) {
    return null;
  }

  const headers = guardedHeaders();
  if (decision.state === "deny" && decision.retryAfterSeconds !== null) {
    headers.set("Retry-After", String(decision.retryAfterSeconds));
  }
  return new Response(
    JSON.stringify({
      error: {
        code:
          decision.state === "deny"
            ? "STOREFRONT_RATE_LIMITED"
            : "STOREFRONT_ABUSE_CONTROL_UNAVAILABLE",
      },
    }),
    {
      status: decision.state === "deny" ? 429 : 503,
      headers,
    },
  );
}
