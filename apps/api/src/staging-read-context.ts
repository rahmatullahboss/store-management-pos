import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { errorResponse, PlatformError } from "../../../packages/foundation/src/errors.js";

const SESSION_COOKIE = "ozzyl_staging_session";

export interface StagingReadContext {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  };
  readonly tenant: {
    readonly id: string;
    readonly name: string;
  };
  readonly membershipId: string;
  readonly role: string;
  readonly scope: {
    readonly legalEntityId?: string;
    readonly storeId?: string;
    readonly warehouseId?: string;
    readonly registerId?: string;
  };
  readonly permissions: readonly string[];
}

interface ContextRow extends Record<string, unknown> {
  readonly session_id: string;
  readonly expires_at: string;
  readonly user_id: string;
  readonly display_name: string;
  readonly email_normalized: string;
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly membership_id: string;
  readonly role_code: string;
  readonly legal_entity_id?: string | null;
  readonly store_id?: string | null;
  readonly warehouse_id?: string | null;
  readonly register_id?: string | null;
  readonly permissions: readonly string[];
}

export interface StagingReadContextEnvironment {
  readonly DATABASE_URL: string;
  readonly STAGING_READ_CONTEXT_RESOLVER?: (
    tokenHash: string,
  ) => Promise<StagingReadContext | null>;
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const item of cookie.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const value = parts.join("=");
    return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
  }
  return null;
}

function optionalUuid(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rowToContext(row: ContextRow): StagingReadContext {
  const permissions = Array.isArray(row.permissions)
    ? row.permissions.filter(
        (permission): permission is string =>
          typeof permission === "string" && permission.length > 0,
      )
    : [];
  if (permissions.length === 0) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      "No staging permissions are assigned",
      403,
    );
  }
  return {
    sessionId: String(row.session_id),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    user: {
      id: String(row.user_id),
      name: String(row.display_name),
      email: String(row.email_normalized),
    },
    tenant: {
      id: String(row.tenant_id),
      name: String(row.tenant_name),
    },
    membershipId: String(row.membership_id),
    role: String(row.role_code),
    scope: {
      ...(optionalUuid(row.legal_entity_id)
        ? { legalEntityId: optionalUuid(row.legal_entity_id)! }
        : {}),
      ...(optionalUuid(row.store_id)
        ? { storeId: optionalUuid(row.store_id)! }
        : {}),
      ...(optionalUuid(row.warehouse_id)
        ? { warehouseId: optionalUuid(row.warehouse_id)! }
        : {}),
      ...(optionalUuid(row.register_id)
        ? { registerId: optionalUuid(row.register_id)! }
        : {}),
    },
    permissions: [...new Set(permissions)].sort(),
  };
}

async function resolveContext(
  tokenHash: string,
  env: StagingReadContextEnvironment,
): Promise<StagingReadContext | null> {
  if (env.STAGING_READ_CONTEXT_RESOLVER) {
    return await env.STAGING_READ_CONTEXT_RESOLVER(tokenHash);
  }
  const database = new NeonDatabase({
    connectionString: env.DATABASE_URL,
    statementTimeoutMs: 8_000,
    lockTimeoutMs: 1_000,
  });
  const rows = await database.httpQuery<ContextRow>(
    "SELECT * FROM platform.custom_auth_resolve_context($1::text)",
    [tokenHash],
  );
  const row = rows[0];
  return row ? rowToContext(row) : null;
}

export async function resolveStagingReadContext(
  request: Request,
  env: StagingReadContextEnvironment,
): Promise<StagingReadContext | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return await resolveContext(await sha256(token), env);
}

export async function handleStagingReadContext(
  request: Request,
  env: StagingReadContextEnvironment,
): Promise<Response> {
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
    if (!sessionToken(request)) {
      throw new PlatformError(
        "AUTHENTICATION_REQUIRED",
        "Custom staging session is required",
        401,
      );
    }
    if (!context) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Active unambiguous staging role assignment is required",
        403,
      );
    }
    const body = JSON.stringify({
      authenticated: true,
      authorizationMode: "database-resolved-rbac",
      context,
    });
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch (error) {
    return errorResponse(error, id);
  }
}
