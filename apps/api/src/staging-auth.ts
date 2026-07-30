import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import {
  errorResponse,
  PlatformError,
} from "../../../packages/foundation/src/errors.js";

export interface StagingAuthSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
  readonly tenant: {
    readonly id: string;
    readonly name: string;
  };
  readonly session: {
    readonly id: string;
    readonly expiresAt: string;
  };
}

interface SessionIssueInput {
  readonly email: string;
  readonly password: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly ipHash: string;
  readonly userAgentHash: string;
  readonly requestId: string;
  readonly tenantCode: string;
}

interface RegisterInput extends SessionIssueInput {
  readonly name: string;
}

interface SignInInput extends SessionIssueInput {
  readonly rateKey: string;
}

export interface StagingAuthStore {
  register(input: RegisterInput): Promise<StagingAuthSession | null>;
  signIn(input: SignInInput): Promise<StagingAuthSession | null>;
  session(tokenHash: string): Promise<StagingAuthSession | null>;
  revoke(tokenHash: string, requestId: string): Promise<void>;
}

export interface StagingAuthEnvironment {
  readonly DATABASE_URL: string;
  readonly STAGING_AUTH_REQUIRED?: string;
  readonly STAGING_AUTH_TENANT_CODE?: string;
  readonly STAGING_AUTH_STORE?: StagingAuthStore;
}

interface AuthRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly display_name: string;
  readonly email_normalized: string;
  readonly expires_at: string;
  readonly tenant_name?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SESSION_COOKIE = "ozzyl_staging_session";
const SESSION_SECONDS = 8 * 60 * 60;
const MIN_PASSWORD_LENGTH = 10;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authRequired(env: StagingAuthEnvironment): boolean {
  return env.STAGING_AUTH_REQUIRED === "1";
}

function tenantCode(env: StagingAuthEnvironment): string {
  const value = env.STAGING_AUTH_TENANT_CODE?.trim();
  return value && /^[a-z][a-z0-9-]{2,62}$/u.test(value)
    ? value
    : "synthetic-beta";
}

function exactOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function validateActionOrigin(request: Request): void {
  const expected = exactOrigin(request);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const opaqueOrigin = origin === "null";
  if (origin !== null && !opaqueOrigin && origin !== expected) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Authentication request origin is invalid",
      403,
    );
  }
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Cross-site authentication is not allowed",
      403,
    );
  }
  if ((origin === null || opaqueOrigin) && fetchSite !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Authentication request origin evidence is missing",
      403,
    );
  }
}

function safeReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/admin";
  const normalized = value.trim();
  return /^\/(?:admin|pos)(?:\/|$)/u.test(normalized)
    ? normalized
    : "/admin";
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

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
    "unknown"
  ).slice(0, 128);
}

async function requestFingerprints(
  request: Request,
  email: string,
): Promise<{
  readonly ipHash: string;
  readonly userAgentHash: string;
  readonly rateKey: string;
}> {
  const ip = clientIp(request);
  const userAgent = (request.headers.get("user-agent") ?? "unknown").slice(0, 512);
  const [ipHash, userAgentHash, rateKey] = await Promise.all([
    sha256(`ip:${ip}`),
    sha256(`ua:${userAgent}`),
    sha256(`login:${email}:${ip}`),
  ]);
  return { ipHash, userAgentHash, rateKey };
}

function sessionCookie(token: string, expiresAt: Date): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; Expires=${expiresAt.toUTCString()}; HttpOnly; Secure; SameSite=Lax`;
}

function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const item of cookie.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = parts.join("=");
      return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
    }
  }
  return null;
}

function redirectWithCookie(
  request: Request,
  pathname: string,
  cookie: string,
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL(pathname, request.url).toString(),
      "Set-Cookie": cookie,
    },
  });
}

function loginPage(request: Request): Response {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const created = url.searchParams.get("created") === "1";
  const returnTo = /^\/(?:admin|pos)(?:\/|$)/u.test(
    url.searchParams.get("returnTo") ?? "",
  )
    ? url.searchParams.get("returnTo")!
    : "/admin";
  const errorPanel = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : "";
  const createdPanel = created
    ? `<p class="success" role="status">Account created. You are signed in.</p>`
    : "";
  const body = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Store staging sign in</title><style>:root{font-family:ui-sans-serif,system-ui;color:#17231e;background:#f5f3ec}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem}.card{width:min(100%,34rem);background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem;padding:clamp(1rem,4vw,2rem);box-shadow:0 12px 34px rgba(23,35,30,.12)}h1{margin:.25rem 0 .5rem;font-size:clamp(2rem,7vw,3rem)}p{line-height:1.55}.notice{border:2px solid #1f6a51;background:#edf8f3;color:#153e31;padding:.8rem 1rem;border-radius:.65rem}.error{border:2px solid #9b2c2c;background:#fff2f0;color:#762020;padding:.75rem;border-radius:.5rem}.success{border:2px solid #1f6a51;background:#edf8f3;color:#153e31;padding:.75rem;border-radius:.5rem}form{display:grid;gap:.8rem;margin-top:1.25rem}label{font-weight:800}input{width:100%;min-height:48px;padding:.7rem .8rem;border:1px solid #87928b;border-radius:.45rem;font:inherit}button{min-height:48px;border:0;border-radius:.45rem;background:#14251e;color:#fff;font:800 1rem/1 system-ui;cursor:pointer}button.secondary{background:#fff;color:#14251e;border:1px solid #14251e}small{color:#5b665f}</style></head><body><main class="card"><p class="notice"><strong>Ozzyl custom authentication</strong><br>Accounts, bcrypt password hashes and secure sessions are stored in the dedicated staging database. No external auth provider is used.</p><h1>Sign in</h1><p>Synthetic staging only. Payments and authoritative business writes remain disabled.</p>${createdPanel}${errorPanel}<form action="/auth/sign-in" method="post"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"><div><label for="signin-email">Email</label><input id="signin-email" name="email" type="email" autocomplete="email" maxlength="254" required></div><div><label for="signin-password">Password</label><input id="signin-password" name="password" type="password" autocomplete="current-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="128" required></div><button type="submit">Sign in</button></form><hr><h2>Create staging account</h2><form action="/auth/sign-up" method="post"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"><div><label for="signup-name">Name</label><input id="signup-name" name="name" autocomplete="name" minlength="2" maxlength="80" required></div><div><label for="signup-email">Email</label><input id="signup-email" name="email" type="email" autocomplete="email" maxlength="254" required></div><div><label for="signup-password">Password</label><input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="128" required><small>Use at least ${MIN_PASSWORD_LENGTH} characters. Do not reuse a production password.</small></div><button class="secondary" type="submit">Create account</button></form></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function authFailureRedirect(
  request: Request,
  message: string,
  returnTo: string,
): Response {
  const target = new URL("/login", request.url);
  target.searchParams.set("error", message.slice(0, 180));
  target.searchParams.set("returnTo", returnTo);
  return new Response(null, {
    status: 303,
    headers: { "Cache-Control": "no-store", Location: target.toString() },
  });
}

function rowToSession(row: AuthRow): StagingAuthSession {
  return {
    user: {
      id: String(row.user_id),
      email: String(row.email_normalized),
      name: String(row.display_name),
    },
    tenant: {
      id: String(row.tenant_id),
      name: String(row.tenant_name ?? "Synthetic Dhaka Store"),
    },
    session: {
      id: String(row.session_id),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    },
  };
}

class PostgresStagingAuthStore implements StagingAuthStore {
  private readonly database: NeonDatabase;

  constructor(connectionString: string) {
    this.database = new NeonDatabase({
      connectionString,
      statementTimeoutMs: 12_000,
      lockTimeoutMs: 2_000,
    });
  }

  async register(input: RegisterInput): Promise<StagingAuthSession | null> {
    const rows = await this.database.httpQuery<AuthRow>(
      `SELECT r.*, t.display_name AS tenant_name
       FROM platform.custom_auth_register(
         $1::text,$2::text,$3::text,$4::text,$5::text,$6::timestamptz,$7::text,$8::text,$9::text
       ) r
       JOIN platform.tenants t ON t.id = r.tenant_id`,
      [
        input.email,
        input.name,
        input.password,
        input.tenantCode,
        input.tokenHash,
        input.expiresAt,
        input.ipHash,
        input.userAgentHash,
        input.requestId,
      ],
    );
    const row = rows[0];
    return row ? rowToSession(row) : null;
  }

  async signIn(input: SignInInput): Promise<StagingAuthSession | null> {
    const rows = await this.database.httpQuery<AuthRow>(
      `SELECT r.*, t.display_name AS tenant_name
       FROM platform.custom_auth_login(
         $1::text,$2::text,$3::text,$4::text,$5::text,$6::timestamptz,$7::text,$8::text,$9::text
       ) r
       JOIN platform.tenants t ON t.id = r.tenant_id`,
      [
        input.email,
        input.password,
        input.tenantCode,
        input.rateKey,
        input.tokenHash,
        input.expiresAt,
        input.ipHash,
        input.userAgentHash,
        input.requestId,
      ],
    );
    const row = rows[0];
    return row ? rowToSession(row) : null;
  }

  async session(tokenHash: string): Promise<StagingAuthSession | null> {
    const rows = await this.database.httpQuery<AuthRow>(
      `SELECT
         s.id::text AS session_id,
         s.user_id::text AS user_id,
         s.tenant_id::text AS tenant_id,
         s.expires_at::text AS expires_at,
         u.display_name,
         u.email_normalized,
         t.display_name AS tenant_name
       FROM platform.auth_sessions s
       JOIN platform.users u ON u.id = s.user_id AND u.status = 'active'
       JOIN platform.memberships m
         ON m.user_id = u.id AND m.tenant_id = s.tenant_id AND m.status = 'active'
       JOIN platform.tenants t ON t.id = s.tenant_id AND t.status = 'active'
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
       LIMIT 1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    await this.database.httpQuery(
      `UPDATE platform.auth_sessions
       SET last_seen_at = now()
       WHERE token_hash = $1
         AND last_seen_at < now() - interval '5 minutes'`,
      [tokenHash],
    );
    return rowToSession(row);
  }

  async revoke(tokenHash: string, requestIdValue: string): Promise<void> {
    await this.database.httpQuery(
      "SELECT platform.custom_auth_revoke_session($1::text,$2::text)",
      [tokenHash, requestIdValue],
    );
  }
}

function authStore(env: StagingAuthEnvironment): StagingAuthStore {
  if (env.STAGING_AUTH_STORE) return env.STAGING_AUTH_STORE;
  if (!env.DATABASE_URL) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Custom authentication database is not configured",
      503,
    );
  }
  return new PostgresStagingAuthStore(env.DATABASE_URL);
}

function isUniqueAccountError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  const message = String(record.message ?? "");
  return (
    record.code === "23505" ||
    message.includes("users_email_normalized_unique") ||
    message.includes("duplicate key")
  );
}

async function authenticationAction(
  request: Request,
  env: StagingAuthEnvironment,
  action: "sign-in" | "sign-up",
): Promise<Response> {
  validateActionOrigin(request);
  const form = await request.formData();
  const email =
    typeof form.get("email") === "string"
      ? String(form.get("email")).trim().toLowerCase()
      : "";
  const password =
    typeof form.get("password") === "string"
      ? String(form.get("password"))
      : "";
  const name =
    typeof form.get("name") === "string"
      ? String(form.get("name")).trim()
      : "";
  const returnTo = safeReturnTo(form.get("returnTo"));

  if (
    !EMAIL_PATTERN.test(email) ||
    email.length > 254 ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > 128
  ) {
    return authFailureRedirect(
      request,
      `Use a valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      returnTo,
    );
  }
  if (action === "sign-up" && (name.length < 2 || name.length > 80)) {
    return authFailureRedirect(request, "Name must be 2 to 80 characters.", returnTo);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1_000);
  const fingerprints = await requestFingerprints(request, email);
  const common = {
    email,
    password,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    ipHash: fingerprints.ipHash,
    userAgentHash: fingerprints.userAgentHash,
    requestId: requestId(request),
    tenantCode: tenantCode(env),
  };

  try {
    const session =
      action === "sign-up"
        ? await authStore(env).register({ ...common, name })
        : await authStore(env).signIn({
            ...common,
            rateKey: fingerprints.rateKey,
          });
    if (!session) {
      return authFailureRedirect(
        request,
        action === "sign-in"
          ? "Email or password is incorrect, or the account is temporarily locked."
          : "Account creation failed.",
        returnTo,
      );
    }
    return redirectWithCookie(
      request,
      returnTo,
      sessionCookie(token, expiresAt),
    );
  } catch (error) {
    if (action === "sign-up" && isUniqueAccountError(error)) {
      return authFailureRedirect(
        request,
        "An account with this email already exists. Sign in instead.",
        returnTo,
      );
    }
    throw error;
  }
}

export async function getStagingAuthSession(
  request: Request,
  env: StagingAuthEnvironment,
): Promise<StagingAuthSession | null> {
  if (!authRequired(env)) return null;
  const token = cookieValue(request);
  if (!token) return null;
  return await authStore(env).session(await sha256(token));
}

export function stagingAuthIsRequired(env: StagingAuthEnvironment): boolean {
  return authRequired(env);
}

export async function handleStagingAuthRequest(
  request: Request,
  url: URL,
  env: StagingAuthEnvironment,
): Promise<Response | null> {
  try {
    if (
      url.pathname === "/login" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (authRequired(env) && (await getStagingAuthSession(request, env))) {
        return Response.redirect(
          new URL("/admin", request.url).toString(),
          302,
        );
      }
      return loginPage(request);
    }
    if (url.pathname === "/auth/sign-in" && request.method === "POST") {
      return await authenticationAction(request, env, "sign-in");
    }
    if (url.pathname === "/auth/sign-up" && request.method === "POST") {
      return await authenticationAction(request, env, "sign-up");
    }
    if (url.pathname === "/auth/session" && request.method === "GET") {
      const session = await getStagingAuthSession(request, env);
      return Response.json(
        session
          ? {
              authenticated: true,
              user: session.user,
              tenant: session.tenant,
              expiresAt: session.session.expiresAt,
            }
          : { authenticated: false },
        {
          status: session ? 200 : 401,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (url.pathname === "/auth/sign-out" && request.method === "POST") {
      validateActionOrigin(request);
      const token = cookieValue(request);
      if (token) {
        await authStore(env).revoke(await sha256(token), requestId(request));
      }
      return redirectWithCookie(request, "/login", clearedSessionCookie());
    }
    return null;
  } catch (error) {
    return errorResponse(error, requestId(request));
  }
}
