import {
  errorResponse,
  PlatformError,
} from "../../../packages/foundation/src/errors.js";

export interface StagingAuthEnvironment {
  readonly NEON_AUTH_URL?: string;
  readonly STAGING_AUTH_REQUIRED?: string;
  readonly STAGING_AUTH_FETCH?: typeof fetch;
}

export interface StagingAuthSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
  readonly session: {
    readonly id: string;
    readonly expiresAt: string;
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

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

function authBaseUrl(env: StagingAuthEnvironment): URL {
  if (!env.NEON_AUTH_URL) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Staging identity provider is not configured",
      503,
    );
  }
  const url = new URL(env.NEON_AUTH_URL);
  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new PlatformError(
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "Staging identity provider URL is invalid",
      503,
    );
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function authFetcher(env: StagingAuthEnvironment): typeof fetch {
  return env.STAGING_AUTH_FETCH ?? fetch;
}

function exactOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function validateActionOrigin(request: Request): void {
  const expected = exactOrigin(request);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== null && origin !== expected) {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Staging authentication request origin is invalid",
      403,
    );
  }
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Cross-site staging authentication is not allowed",
      403,
    );
  }
  if (origin === null && fetchSite !== "same-origin") {
    throw new PlatformError(
      "AUTHENTICATION_REQUIRED",
      "Staging authentication request origin evidence is missing",
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

function localizedCookie(value: string): string {
  const withoutDomain = value.replace(/;\s*Domain=[^;]+/giu, "");
  const withRootPath = /;\s*Path=/iu.test(withoutDomain)
    ? withoutDomain.replace(/;\s*Path=[^;]*/iu, "; Path=/")
    : `${withoutDomain}; Path=/`;
  const secure = /;\s*Secure(?:;|$)/iu.test(withRootPath)
    ? withRootPath
    : `${withRootPath}; Secure`;
  const httpOnly = /;\s*HttpOnly(?:;|$)/iu.test(secure)
    ? secure
    : `${secure}; HttpOnly`;
  return /;\s*SameSite=/iu.test(httpOnly)
    ? httpOnly.replace(/;\s*SameSite=[^;]*/iu, "; SameSite=Lax")
    : `${httpOnly}; SameSite=Lax`;
}

function providerCookies(response: Response): readonly string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = headers.getSetCookie?.() ?? [];
  if (values.length > 0) return values.map(localizedCookie);
  const combined = response.headers.get("set-cookie");
  return combined ? [localizedCookie(combined)] : [];
}

function appendCookies(headers: Headers, cookies: readonly string[]): void {
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
}

function redirectWithCookies(
  request: Request,
  pathname: string,
  cookies: readonly string[],
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: new URL(pathname, request.url).toString(),
  });
  appendCookies(headers, cookies);
  return new Response(null, { status: 303, headers });
}

function loginPage(request: Request): Response {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const returnTo = /^\/(?:admin|pos)(?:\/|$)/u.test(
    url.searchParams.get("returnTo") ?? "",
  )
    ? url.searchParams.get("returnTo")!
    : "/admin";
  const errorPanel = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : "";
  const body = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Staging sign in</title><style>:root{font-family:ui-sans-serif,system-ui;color:#17231e;background:#f5f3ec}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem}.card{width:min(100%,34rem);background:#fffefa;border:1px solid #d7ddd8;border-radius:1rem;padding:clamp(1rem,4vw,2rem);box-shadow:0 12px 34px rgba(23,35,30,.12)}h1{margin:.25rem 0 .5rem;font-size:clamp(2rem,7vw,3rem)}p{line-height:1.55}.notice{border:2px solid #8a5a00;background:#fff0c7;color:#4c3100;padding:.8rem 1rem;border-radius:.65rem}.error{border:2px solid #9b2c2c;background:#fff2f0;color:#762020;padding:.75rem;border-radius:.5rem}form{display:grid;gap:.8rem;margin-top:1.25rem}label{font-weight:800}input{width:100%;min-height:48px;padding:.7rem .8rem;border:1px solid #87928b;border-radius:.45rem;font:inherit}button{min-height:48px;border:0;border-radius:.45rem;background:#14251e;color:#fff;font:800 1rem/1 system-ui;cursor:pointer}button.secondary{background:#fff;color:#14251e;border:1px solid #14251e}.split{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}@media(max-width:32rem){.split{grid-template-columns:1fr}}</style></head><body><main class="card"><p class="notice"><strong>Persistent staging</strong><br>Synthetic data only. Payments and authoritative business writes remain disabled.</p><h1>Sign in</h1><p>Create a staging-only account or use an account you already created here. No production identity or customer data is used.</p>${errorPanel}<form action="/auth/sign-in" method="post"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"><div><label for="signin-email">Email</label><input id="signin-email" name="email" type="email" autocomplete="email" required></div><div><label for="signin-password">Password</label><input id="signin-password" name="password" type="password" autocomplete="current-password" minlength="8" required></div><button type="submit">Sign in to staging</button></form><hr><h2>Create staging account</h2><form action="/auth/sign-up" method="post"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"><div><label for="signup-name">Name</label><input id="signup-name" name="name" autocomplete="name" minlength="2" maxlength="80" required></div><div><label for="signup-email">Email</label><input id="signup-email" name="email" type="email" autocomplete="email" required></div><div><label for="signup-password">Password</label><input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><button class="secondary" type="submit">Create staging account</button></form></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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

async function providerAction(
  request: Request,
  env: StagingAuthEnvironment,
  endpoint: "/sign-in/email" | "/sign-up/email",
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
  const returnTo = safeReturnTo(form.get("returnTo"));
  const name =
    typeof form.get("name") === "string"
      ? String(form.get("name")).trim()
      : "";
  if (
    !EMAIL_PATTERN.test(email) ||
    password.length < 8 ||
    password.length > 128
  ) {
    return authFailureRedirect(
      request,
      "Email or password is invalid.",
      returnTo,
    );
  }
  if (
    endpoint === "/sign-up/email" &&
    (name.length < 2 || name.length > 80)
  ) {
    return authFailureRedirect(request, "Name is invalid.", returnTo);
  }

  const target = new URL(authBaseUrl(env));
  target.pathname += endpoint;
  const response = await authFetcher(env)(target, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: exactOrigin(request),
      "User-Agent":
        request.headers.get("user-agent") ?? "Ozzyl-Staging-Auth",
    },
    body: JSON.stringify({
      email,
      password,
      ...(endpoint === "/sign-up/email" ? { name } : { rememberMe: true }),
    }),
    redirect: "manual",
  });
  const cookies = providerCookies(response);
  if (!response.ok || cookies.length === 0) {
    let message = "Authentication failed.";
    try {
      const body = (await response.json()) as {
        readonly message?: unknown;
        readonly error?: { readonly message?: unknown };
      };
      const candidate = body.error?.message ?? body.message;
      if (typeof candidate === "string" && candidate.length > 0) {
        message = candidate;
      }
    } catch {
      // Keep the bounded generic failure.
    }
    return authFailureRedirect(request, message, returnTo);
  }
  return redirectWithCookies(request, returnTo, cookies);
}

export async function getStagingAuthSession(
  request: Request,
  env: StagingAuthEnvironment,
): Promise<StagingAuthSession | null> {
  if (!authRequired(env)) return null;
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const target = new URL(authBaseUrl(env));
  target.pathname += "/get-session";
  const response = await authFetcher(env)(target, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      Origin: exactOrigin(request),
      "User-Agent":
        request.headers.get("user-agent") ?? "Ozzyl-Staging-Auth",
    },
    redirect: "manual",
  });
  if (!response.ok) return null;
  const value = (await response.json()) as unknown;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const user = record.user;
  const session = record.session;
  if (
    typeof user !== "object" ||
    user === null ||
    typeof session !== "object" ||
    session === null
  ) {
    return null;
  }
  const userRecord = user as Record<string, unknown>;
  const sessionRecord = session as Record<string, unknown>;
  if (
    typeof userRecord.id !== "string" ||
    typeof userRecord.email !== "string" ||
    typeof userRecord.name !== "string" ||
    typeof sessionRecord.id !== "string" ||
    typeof sessionRecord.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    user: {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
    },
    session: {
      id: sessionRecord.id,
      expiresAt: sessionRecord.expiresAt,
    },
  };
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
      return await providerAction(request, env, "/sign-in/email");
    }
    if (url.pathname === "/auth/sign-up" && request.method === "POST") {
      return await providerAction(request, env, "/sign-up/email");
    }
    if (url.pathname === "/auth/session" && request.method === "GET") {
      const session = await getStagingAuthSession(request, env);
      return Response.json(
        session
          ? { authenticated: true, user: session.user }
          : { authenticated: false },
        {
          status: session ? 200 : 401,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (url.pathname === "/auth/sign-out" && request.method === "POST") {
      validateActionOrigin(request);
      const target = new URL(authBaseUrl(env));
      target.pathname += "/sign-out";
      const response = await authFetcher(env)(target, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Cookie: request.headers.get("cookie") ?? "",
          Origin: exactOrigin(request),
          "Content-Type": "application/json",
        },
        body: "{}",
        redirect: "manual",
      });
      const cookies = providerCookies(response);
      return redirectWithCookies(request, "/login", cookies);
    }
    return null;
  } catch (error) {
    return errorResponse(
      error,
      request.headers.get("x-request-id") ?? crypto.randomUUID(),
    );
  }
}
