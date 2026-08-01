import { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { StagingAuthEnvironment } from "./staging-auth.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const PASSWORD_RECOVERY_SECONDS = 15 * 60;
const EMAIL_VERIFICATION_SECONDS = 24 * 60 * 60;
const SESSION_COOKIE = "ozzyl_staging_session";
const STEP_UP_COOKIE = "ozzyl_staging_step_up";
const encoder = new TextEncoder();

type ActionPurpose = "password_recovery" | "email_verification";

interface ActionTokenRequestInput {
  readonly email: string;
  readonly tenantCode: string;
  readonly purpose: ActionPurpose;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly rateKey: string;
  readonly requestId: string;
  readonly ipHash: string;
  readonly userAgentHash: string;
}

interface ActionTokenRequestResult {
  readonly issued: boolean;
  readonly email?: string;
}

export interface StagingAccountRecoveryStore {
  requestActionToken(
    input: ActionTokenRequestInput,
  ): Promise<ActionTokenRequestResult>;
  completePasswordReset(
    tokenHash: string,
    newPassword: string,
    requestId: string,
  ): Promise<boolean>;
  completeEmailVerification(
    tokenHash: string,
    requestId: string,
  ): Promise<boolean>;
}

export interface StagingAuthDelivery {
  deliverPasswordRecovery(input: {
    readonly email: string;
    readonly token: string;
    readonly resetUrl: string;
    readonly expiresAt: string;
  }): Promise<void>;
  deliverEmailVerification?(input: {
    readonly email: string;
    readonly token: string;
    readonly verificationUrl: string;
    readonly expiresAt: string;
  }): Promise<void>;
}

export interface StagingAccountRecoveryEnvironment extends StagingAuthEnvironment {
  readonly STAGING_ACCOUNT_RECOVERY_STORE?: StagingAccountRecoveryStore;
  readonly STAGING_AUTH_DELIVERY?: StagingAuthDelivery;
}

interface RequestRow extends Record<string, unknown> {
  readonly issued: boolean;
  readonly email_normalized?: string | null;
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
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tenantCode(env: StagingAccountRecoveryEnvironment): string {
  const value = env.STAGING_AUTH_TENANT_CODE?.trim();
  return value && /^[a-z][a-z0-9-]{2,62}$/u.test(value)
    ? value
    : "synthetic-beta";
}

function requestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
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
  purpose: ActionPurpose,
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
    sha256(`auth-action:${purpose}:${email}:${ip}`),
  ]);
  return { ipHash, userAgentHash, rateKey };
}

function validateActionOrigin(request: Request): void {
  const url = new URL(request.url);
  const expected = `${url.protocol}//${url.host}`;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== null && origin !== "null" && origin !== expected) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Account recovery request origin is invalid",
      403,
    );
  }
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Cross-site account recovery is not allowed",
      403,
    );
  }
  if ((origin === null || origin === "null") && fetchSite !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Account recovery origin evidence is missing",
      403,
    );
  }
}

function securityHeaders(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

function htmlResponse(request: Request, body: string, status = 200): Response {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: securityHeaders("text/html; charset=utf-8"),
  });
}

function clearedCookie(name: string, sameSite: "Lax" | "Strict"): string {
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=${sameSite}`;
}

function redirect(
  request: Request,
  pathname: string,
  cookies: readonly string[] = [],
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    Location: new URL(pathname, request.url).toString(),
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function pageShell(title: string, content: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title><style>:root{font-family:ui-sans-serif,system-ui;color:#17231e;background:#f5f3ec}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem}.card{width:min(100%,34rem);background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem;padding:clamp(1rem,4vw,2rem);box-shadow:0 12px 34px rgba(23,35,30,.12)}h1{margin:.25rem 0 .5rem;font-size:clamp(2rem,7vw,3rem)}p{line-height:1.55}.notice,.success,.error{padding:.8rem 1rem;border-radius:.65rem}.notice,.success{border:2px solid #1f6a51;background:#edf8f3;color:#153e31}.error{border:2px solid #9b2c2c;background:#fff2f0;color:#762020}form{display:grid;gap:.8rem;margin-top:1.25rem}label{font-weight:800}input{width:100%;min-height:48px;padding:.7rem .8rem;border:1px solid #87928b;border-radius:.45rem;font:inherit}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:0;border-radius:.45rem;background:#14251e;color:#fff;padding:.7rem .9rem;font:800 1rem/1 system-ui;text-decoration:none;cursor:pointer}a{color:#174e3d}small{color:#5b665f}</style></head><body><main class="card">${content}</main></body></html>`;
}

function forgotPasswordPage(request: Request): Response {
  const requested = new URL(request.url).searchParams.get("requested") === "1";
  const status = requested
    ? '<p class="success" role="status">If the account exists, recovery instructions have been prepared. This staging environment does not claim production email delivery.</p>'
    : "";
  return htmlResponse(
    request,
    pageShell(
      "Forgot password",
      `<p class="notice"><strong>Synthetic staging account recovery</strong><br>The same response is shown for known and unknown accounts.</p><h1>Reset your password</h1><p>Enter the account email. Recovery links expire after 15 minutes and can be used once.</p>${status}<form action="/auth/password-recovery/request" method="post"><div><label for="recovery-email">Email</label><input id="recovery-email" name="email" type="email" autocomplete="email" maxlength="254" required></div><button type="submit">Request recovery</button></form><p><a href="/login">Return to sign in</a></p>`,
    ),
  );
}

function resetPasswordPage(request: Request): Response {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const error = url.searchParams.get("error");
  const validShape = TOKEN_PATTERN.test(token);
  const panel = error
    ? `<p class="error" role="alert">${escapeHtml(error.slice(0, 180))}</p>`
    : !validShape
      ? '<p class="error" role="alert">This recovery link is invalid or incomplete.</p>'
      : "";
  return htmlResponse(
    request,
    pageShell(
      "Choose a new password",
      `<p class="notice"><strong>Single-use recovery</strong><br>A successful reset signs out every existing session and revokes password-derived TOTP factors.</p><h1>Choose a new password</h1>${panel}${validShape ? `<form action="/auth/password-recovery/complete" method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><div><label for="new-password">New password</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}" required></div><div><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}" required></div><button type="submit">Reset password</button></form>` : ""}<p><a href="/forgot-password">Request a new recovery link</a></p>`,
    ),
  );
}

function resetCompletePage(request: Request): Response {
  return htmlResponse(
    request,
    pageShell(
      "Password reset complete",
      '<p class="success" role="status">Your password was changed. Existing sessions and password-derived MFA factors were revoked.</p><h1>Sign in again</h1><p>Use the new password. MFA must be enrolled again before a controlled reservation command.</p><a class="button" href="/login">Continue to sign in</a>',
    ),
  );
}

function verificationPage(request: Request): Response {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const error = url.searchParams.get("error");
  const validShape = TOKEN_PATTERN.test(token);
  const panel = error
    ? `<p class="error" role="alert">${escapeHtml(error.slice(0, 180))}</p>`
    : !validShape
      ? '<p class="error" role="alert">This verification link is invalid or incomplete.</p>'
      : "";
  return htmlResponse(
    request,
    pageShell(
      "Verify email",
      `<p class="notice"><strong>Email verification</strong><br>This proves the token lifecycle only; production delivery is not configured.</p><h1>Verify your email</h1>${panel}${validShape ? `<form action="/auth/email-verification/complete" method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Verify email</button></form>` : ""}<p><a href="/login">Return to sign in</a></p>`,
    ),
  );
}

function verificationCompletePage(request: Request): Response {
  return htmlResponse(
    request,
    pageShell(
      "Email verified",
      '<p class="success" role="status">The email verification token was accepted and consumed.</p><h1>Email verified</h1><a class="button" href="/login">Continue to sign in</a>',
    ),
  );
}

class PostgresStagingAccountRecoveryStore implements StagingAccountRecoveryStore {
  private readonly database: NeonDatabase;

  constructor(connectionString: string) {
    this.database = new NeonDatabase({
      connectionString,
      statementTimeoutMs: 12_000,
      lockTimeoutMs: 2_000,
    });
  }

  async requestActionToken(
    input: ActionTokenRequestInput,
  ): Promise<ActionTokenRequestResult> {
    const rows = await this.database.httpQuery<RequestRow>(
      `SELECT * FROM platform.custom_auth_request_action_token(
        $1::text,$2::text,$3::text,$4::uuid,$5::text,$6::timestamptz,
        $7::text,$8::text,$9::text,$10::text
      )`,
      [
        input.email,
        input.tenantCode,
        input.purpose,
        input.tokenId,
        input.tokenHash,
        input.expiresAt,
        input.rateKey,
        input.requestId,
        input.ipHash,
        input.userAgentHash,
      ],
    );
    const row = rows[0];
    return {
      issued: row?.issued === true,
      ...(typeof row?.email_normalized === "string"
        ? { email: row.email_normalized }
        : {}),
    };
  }

  async completePasswordReset(
    tokenHash: string,
    newPassword: string,
    requestIdValue: string,
  ): Promise<boolean> {
    const rows = await this.database.httpQuery<
      { completed: boolean } & Record<string, unknown>
    >(
      "SELECT platform.custom_auth_complete_password_reset($1::text,$2::text,$3::text) AS completed",
      [tokenHash, newPassword, requestIdValue],
    );
    return rows[0]?.completed === true;
  }

  async completeEmailVerification(
    tokenHash: string,
    requestIdValue: string,
  ): Promise<boolean> {
    const rows = await this.database.httpQuery<
      { completed: boolean } & Record<string, unknown>
    >(
      "SELECT platform.custom_auth_complete_email_verification($1::text,$2::text) AS completed",
      [tokenHash, requestIdValue],
    );
    return rows[0]?.completed === true;
  }
}

function store(
  env: StagingAccountRecoveryEnvironment,
): StagingAccountRecoveryStore {
  if (env.STAGING_ACCOUNT_RECOVERY_STORE) {
    return env.STAGING_ACCOUNT_RECOVERY_STORE;
  }
  if (!env.DATABASE_URL) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Account recovery database is unavailable",
      503,
    );
  }
  return new PostgresStagingAccountRecoveryStore(env.DATABASE_URL);
}

async function requestPasswordRecovery(
  request: Request,
  env: StagingAccountRecoveryEnvironment,
): Promise<Response> {
  validateActionOrigin(request);
  const form = await request.formData();
  const email = typeof form.get("email") === "string"
    ? String(form.get("email")).trim().toLowerCase()
    : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return redirect(request, "/forgot-password?requested=1");
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RECOVERY_SECONDS * 1_000);
  const fingerprints = await requestFingerprints(
    request,
    email,
    "password_recovery",
  );
  const result = await store(env).requestActionToken({
    email,
    tenantCode: tenantCode(env),
    purpose: "password_recovery",
    tokenId: crypto.randomUUID(),
    tokenHash: await sha256(token),
    expiresAt: expiresAt.toISOString(),
    rateKey: fingerprints.rateKey,
    requestId: requestId(request),
    ipHash: fingerprints.ipHash,
    userAgentHash: fingerprints.userAgentHash,
  });
  if (result.issued && result.email && env.STAGING_AUTH_DELIVERY) {
    await env.STAGING_AUTH_DELIVERY.deliverPasswordRecovery({
      email: result.email,
      token,
      resetUrl: new URL(`/reset-password?token=${token}`, request.url).toString(),
      expiresAt: expiresAt.toISOString(),
    });
  }
  return redirect(request, "/forgot-password?requested=1");
}

async function completePasswordRecovery(
  request: Request,
  env: StagingAccountRecoveryEnvironment,
): Promise<Response> {
  validateActionOrigin(request);
  const form = await request.formData();
  const token = typeof form.get("token") === "string"
    ? String(form.get("token"))
    : "";
  const password = typeof form.get("password") === "string"
    ? String(form.get("password"))
    : "";
  const confirmation = typeof form.get("confirmPassword") === "string"
    ? String(form.get("confirmPassword"))
    : "";
  if (
    !TOKEN_PATTERN.test(token) ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    password !== confirmation
  ) {
    const target = new URL("/reset-password", request.url);
    if (TOKEN_PATTERN.test(token)) target.searchParams.set("token", token);
    target.searchParams.set(
      "error",
      password !== confirmation
        ? "Passwords do not match."
        : `Use a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
    );
    return redirect(request, `${target.pathname}${target.search}`);
  }

  const completed = await store(env).completePasswordReset(
    await sha256(token),
    password,
    requestId(request),
  );
  if (!completed) {
    const target = new URL("/reset-password", request.url);
    target.searchParams.set("error", "This recovery link is invalid, expired or already used.");
    return redirect(request, `${target.pathname}${target.search}`);
  }
  return redirect(request, "/password-reset-complete", [
    clearedCookie(SESSION_COOKIE, "Lax"),
    clearedCookie(STEP_UP_COOKIE, "Strict"),
  ]);
}

async function completeEmailVerification(
  request: Request,
  env: StagingAccountRecoveryEnvironment,
): Promise<Response> {
  validateActionOrigin(request);
  const form = await request.formData();
  const token = typeof form.get("token") === "string"
    ? String(form.get("token"))
    : "";
  if (!TOKEN_PATTERN.test(token)) {
    return redirect(request, "/verify-email?error=This+verification+link+is+invalid.");
  }
  const completed = await store(env).completeEmailVerification(
    await sha256(token),
    requestId(request),
  );
  return completed
    ? redirect(request, "/email-verification-complete")
    : redirect(
        request,
        "/verify-email?error=This+verification+link+is+invalid%2C+expired+or+already+used.",
      );
}

export async function handleStagingAccountRecoveryRequest(
  request: Request,
  url: URL,
  env: StagingAccountRecoveryEnvironment,
): Promise<Response | null> {
  try {
    if (
      url.pathname === "/forgot-password" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return forgotPasswordPage(request);
    }
    if (
      url.pathname === "/reset-password" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return resetPasswordPage(request);
    }
    if (
      url.pathname === "/password-reset-complete" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return resetCompletePage(request);
    }
    if (
      url.pathname === "/verify-email" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return verificationPage(request);
    }
    if (
      url.pathname === "/email-verification-complete" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return verificationCompletePage(request);
    }
    if (
      url.pathname === "/auth/password-recovery/request" &&
      request.method === "POST"
    ) {
      return await requestPasswordRecovery(request, env);
    }
    if (
      url.pathname === "/auth/password-recovery/complete" &&
      request.method === "POST"
    ) {
      return await completePasswordRecovery(request, env);
    }
    if (
      url.pathname === "/auth/email-verification/complete" &&
      request.method === "POST"
    ) {
      return await completeEmailVerification(request, env);
    }
    const recoveryPath =
      url.pathname.startsWith("/auth/password-recovery/") ||
      url.pathname.startsWith("/auth/email-verification/");
    if (recoveryPath) {
      return new Response(null, {
        status: 405,
        headers: {
          ...securityHeaders("text/plain; charset=utf-8"),
          Allow: "POST",
        },
      });
    }
    return null;
  } catch (error) {
    const status = error instanceof PlatformError ? error.status : 500;
    return htmlResponse(
      request,
      pageShell(
        "Account recovery unavailable",
        `<p class="error" role="alert">${status === 403 ? "This account recovery request was rejected." : "Account recovery is temporarily unavailable."}</p><p><a href="/login">Return to sign in</a></p>`,
      ),
      status,
    );
  }
}

export const stagingAccountRecoveryConstants = {
  passwordRecoverySeconds: PASSWORD_RECOVERY_SECONDS,
  emailVerificationSeconds: EMAIL_VERIFICATION_SECONDS,
  tokenLength: 43,
  minimumPasswordLength: MIN_PASSWORD_LENGTH,
  maximumPasswordLength: MAX_PASSWORD_LENGTH,
} as const;
