import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { errorResponse, PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { handleInventoryRequest } from "./modules/inventory/handler.js";
import { handleProcurementRequest } from "./modules/procurement/handler.js";
import { buildRequestContext } from "./request-context.js";
import {
  issueStagingCommandToken,
  StagingCommandTokenVerifier,
} from "./staging-command-token.js";
import {
  issueStagingInternalToken,
  StagingInternalTokenVerifier,
} from "./staging-internal-token.js";
import {
  clearStagingStepUpCookie,
  consumeStagingStepUp,
  STAGING_RESERVATION_PERMISSION,
  type StagingMfaEnvironment,
} from "./staging-mfa.js";
import {
  resolveStagingReadContext,
  type StagingReadContextEnvironment,
} from "./staging-read-context.js";

const AUDIENCE = "store-management-api-staging";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_READ_PATHS = new Set([
  "/v1/inventory/availability",
  "/v1/inventory/movements",
  "/v1/procurement/suppliers",
  "/v1/procurement/purchase-orders",
]);
const RESERVATION_CREATE_PATH = "/v1/inventory/reservations";
const RESERVATION_RELEASE = /^\/v1\/inventory\/reservations\/([0-9a-f-]+)\/release$/iu;

export interface StagingProtectedApiEnvironment
  extends StagingReadContextEnvironment,
    StagingMfaEnvironment {
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
      "Warehouse scope is required for this protected route",
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

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlatformError("VALIDATION_FAILED", message, 400);
  }
  return value as Record<string, unknown>;
}

function requireUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new PlatformError("VALIDATION_FAILED", message, 400);
  }
  return value;
}

function requireInteger(value: unknown, minimum: number, maximum: number, message: string): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new PlatformError("VALIDATION_FAILED", message, 400);
  }
  return Number(value);
}

async function scopedCommandBody(
  request: Request,
  internalUrl: URL,
  warehouseId: string | undefined,
): Promise<string> {
  if (!warehouseId) {
    throw new PlatformError("PERMISSION_DENIED", "Warehouse scope is required", 403);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new PlatformError("VALIDATION_FAILED", "Reservation command requires JSON", 400);
  }
  const body = requireRecord(await request.json(), "Reservation command body is invalid");
  if (internalUrl.pathname === RESERVATION_CREATE_PATH) {
    const id = requireUuid(body.id, "Reservation id is invalid");
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length !== 1) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Controlled reservation requires exactly one line",
        400,
      );
    }
    const line = requireRecord(rawLines[0], "Reservation line is invalid");
    const suppliedWarehouse = requireUuid(line.warehouseId, "Reservation warehouse is invalid");
    if (suppliedWarehouse !== warehouseId) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Reservation warehouse is outside the authenticated scope",
        403,
      );
    }
    const quantity = requireRecord(line.quantity, "Reservation quantity is invalid");
    const amount = typeof quantity.amount === "string" ? Number(quantity.amount) : Number.NaN;
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 5 ||
      quantity.unit !== "EACH" ||
      quantity.scale !== 0
    ) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Controlled reservation quantity must be 1 to 5 EACH",
        400,
      );
    }
    const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
    if (sourceId.length < 1 || sourceId.length > 100) {
      throw new PlatformError("VALIDATION_FAILED", "Reservation source id is invalid", 400);
    }
    return JSON.stringify({
      id,
      sourceType: "staging_manual",
      sourceId,
      fulfillmentPolicy: "all_or_nothing",
      lines: [
        {
          id: requireUuid(line.id, "Reservation line id is invalid"),
          variantId: requireUuid(line.variantId, "Reservation variant is invalid"),
          warehouseId,
          quantity: { amount: String(amount), unit: "EACH", scale: 0 },
        },
      ],
    });
  }
  if (RESERVATION_RELEASE.test(internalUrl.pathname)) {
    return JSON.stringify({
      expectedVersion: requireInteger(
        body.expectedVersion,
        1,
        Number.MAX_SAFE_INTEGER,
        "Reservation version is invalid",
      ),
    });
  }
  throw new PlatformError("NOT_FOUND", "Controlled reservation route is not enabled", 404);
}

async function assertReleaseWarehouse(
  database: NeonDatabase,
  tenantId: string,
  reservationId: string,
  warehouseId: string,
): Promise<void> {
  const rows = await database.httpQuery<{ in_scope: boolean } & Record<string, unknown>>(
    `SELECT
       COUNT(*) > 0
       AND BOOL_AND(l.warehouse_id = $3::uuid) AS in_scope
     FROM inventory.stock_reservation_lines AS l
     WHERE l.tenant_id = $1::uuid
       AND l.reservation_id = $2::uuid`,
    [tenantId, reservationId, warehouseId],
  );
  if (rows[0]?.in_scope !== true) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      "Reservation is outside the authenticated warehouse scope",
      403,
    );
  }
}

function securedResponse(response: Response, head: boolean, clearGrant = false): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (clearGrant) headers.append("Set-Cookie", clearStagingStepUpCookie());
  return new Response(head ? null : response.body, {
    status: response.status,
    headers,
  });
}

export async function handleStagingProtectedApi(
  request: Request,
  env: StagingProtectedApiEnvironment,
): Promise<Response | null> {
  const sourceUrl = new URL(request.url);
  if (!sourceUrl.pathname.startsWith("/api/v1/")) return null;
  const id = requestId(request);
  let commandAttempt = false;
  try {
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
    const readRoute =
      (request.method === "GET" || request.method === "HEAD") &&
      ALLOWED_READ_PATHS.has(internalUrl.pathname);
    const commandRoute =
      request.method === "POST" &&
      (internalUrl.pathname === RESERVATION_CREATE_PATH ||
        RESERVATION_RELEASE.test(internalUrl.pathname));
    if (!readRoute && !commandRoute) {
      throw new PlatformError(
        "NOT_FOUND",
        "Protected staging route is not enabled",
        404,
      );
    }

    const secret = requireSecret(env);
    const issuer = `${sourceUrl.origin}/internal-identity`;
    const database = new NeonDatabase({ connectionString: env.DATABASE_URL });
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.set("x-request-id", id);
    headers.set("accept-language", "en-GB");
    headers.set("x-time-zone", "Asia/Dhaka");
    headers.set("x-business-date", new Date().toISOString().slice(0, 10));

    let token: string;
    let verifier: StagingInternalTokenVerifier | StagingCommandTokenVerifier;
    let body: string | undefined;
    if (readRoute) {
      scopeProtectedRead(internalUrl, context.scope.warehouseId);
      token = await issueStagingInternalToken({
        secret,
        issuer,
        audience: AUDIENCE,
        context,
      });
      verifier = new StagingInternalTokenVerifier({
        secret,
        issuer,
        audience: AUDIENCE,
        freshContext: async () => await resolveStagingReadContext(request, env),
      });
    } else {
      commandAttempt = true;
      body = await scopedCommandBody(request, internalUrl, context.scope.warehouseId);
      const release = RESERVATION_RELEASE.exec(internalUrl.pathname);
      if (release) {
        await assertReleaseWarehouse(
          database,
          context.tenant.id,
          requireUuid(release[1], "Reservation id is invalid"),
          context.scope.warehouseId!,
        );
      }
      if (!(await consumeStagingStepUp(request, env, STAGING_RESERVATION_PERMISSION))) {
        throw new PlatformError(
          "PERMISSION_DENIED",
          "A fresh single-use MFA step-up grant is required",
          403,
        );
      }
      token = await issueStagingCommandToken({
        secret,
        issuer,
        audience: AUDIENCE,
        context,
      });
      verifier = new StagingCommandTokenVerifier({
        secret,
        issuer,
        audience: AUDIENCE,
        freshContext: async () => await resolveStagingReadContext(request, env),
      });
      headers.set("content-type", "application/json; charset=utf-8");
    }

    headers.set("authorization", `Bearer ${token}`);
    const internalRequest = new Request(internalUrl, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const requestContext = await buildRequestContext(
      internalRequest,
      verifier,
      env.REGION,
    );
    const inventoryResponse = await handleInventoryRequest(
      internalRequest,
      internalUrl,
      requestContext,
      database,
    );
    const response = inventoryResponse ?? await handleProcurementRequest(
      internalRequest,
      internalUrl,
      requestContext,
      database,
    );
    if (!response) {
      throw new PlatformError("NOT_FOUND", "Protected staging route was not handled", 404);
    }
    return securedResponse(
      response,
      request.method === "HEAD",
      commandRoute,
    );
  } catch (error) {
    const response = errorResponse(error, id);
    return commandAttempt
      ? securedResponse(response, false, true)
      : securedResponse(response, false, false);
  }
}
