import { errorResponse, PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import apiWorker from "./index.js";
import {
  issueStagingInternalToken,
  StagingInternalTokenVerifier,
} from "./staging-internal-token.js";
import {
  resolveStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";

const AUDIENCE = "store-management-api-staging";
const ALLOWED_READ_PATHS = new Set([
  "/v1/inventory/availability",
  "/v1/inventory/movements",
  "/v1/procurement/suppliers",
  "/v1/procurement/purchase-orders",
]);

export interface StagingProtectedApiEnvironment
  extends StagingReadContextEnvironment {
  readonly APP_ENV: string;
  readonly REGION: string;
  readonly STAGING_INTERNAL_TOKEN_SECRET?: string;
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? uuidV7();
}

function requireSecret(env: StagingProtectedApiEnvironment): string {
  const value = env.STAGING_INTERNAL_TOKEN_SECRET;
  if (!value || value.length < 43) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Staging internal token service is unavailable",
      503,
    );
  }
  return value;
}

function requireScopedWarehouse(
  url: URL,
  warehouseId: string | undefined,
): void {
  if (!warehouseId) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      "Warehouse scope is required for this protected read",
      403,
    );
  }
  const supplied = url.searchParams.get("warehouseId");
  if (supplied && supplied !== warehouseId) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      "Requested warehouse is outside the authenticated scope",
      403,
    );
  }
  url.searchParams.set("warehouseId", warehouseId);
}

function scopeProtectedRead(
  url: URL,
  warehouseId: string | undefined,
): void {
  if (
    url.pathname === "/v1/inventory/availability" ||
    url.pathname === "/v1/inventory/movements" ||
    url.pathname === "/v1/procurement/purchase-orders"
  ) {
    requireScopedWarehouse(url, warehouseId);
  }
}

export async function handleStagingProtectedApi(
  request: Request,
  env: StagingProtectedApiEnvironment,
): Promise<Response | null> {
  const sourceUrl = new URL(request.url);
  if (!sourceUrl.pathname.startsWith("/api/v1/")) return null;
  const id = requestId(request);
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: {
          Allow: "GET, HEAD",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const context = await resolveStagingReadContext(request, env);
    if (!context) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Custom staging session is required",
        401,
      );
    }

    const internalUrl = new URL(request.url);
    internalUrl.pathname = internalUrl.pathname.slice("/api".length) || "/";
    if (!ALLOWED_READ_PATHS.has(internalUrl.pathname)) {
      throw new PlatformError(
        "NOT_FOUND",
        "Protected staging read route is not enabled",
        404,
      );
    }
    scopeProtectedRead(internalUrl, context.scope.warehouseId);

    const secret = requireSecret(env);
    const issuer = `${sourceUrl.origin}/internal-identity`;
    const token = await issueStagingInternalToken({
      secret,
      issuer,
      audience: AUDIENCE,
      context,
    });
    const verifier = new StagingInternalTokenVerifier({
      secret,
      issuer,
      audience: AUDIENCE,
      freshContext: async () => await resolveStagingReadContext(request, env),
    });

    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-request-id", id);
    headers.set("x-time-zone", "Asia/Dhaka");
    headers.set("x-business-date", new Date().toISOString().slice(0, 10));
    const internalRequest = new Request(internalUrl, {
      method: "GET",
      headers,
    });
    const response = await apiWorker.fetch(internalRequest, {
      ...env,
      APP_ENV: "staging",
      STAGING_TOKEN_VERIFIER: verifier,
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store, max-age=0");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return errorResponse(error, id);
  }
}
