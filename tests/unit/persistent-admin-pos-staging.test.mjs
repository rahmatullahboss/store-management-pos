import assert from "node:assert/strict";
import test from "node:test";
import stagingWorker from "../../build/apps/api/src/staging.js";

const environment = {
  DATABASE_URL: "postgresql://unused.invalid/neondb",
  APP_ENV: "staging-test",
  REGION: "test",
  STAGING_GIT_SHA: "0123456789abcdef",
};

async function request(path, init, bindings = environment) {
  return await stagingWorker.fetch(
    new Request(`https://staging.example.test${path}`, init),
    bindings,
  );
}

test("persistent staging redirects the root to Admin", async () => {
  const response = await request("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://staging.example.test/admin");
});

test("persistent staging renders the current Admin shell and real fixture pages", async () => {
  for (const [path, marker] of [
    ["/admin", "Store Management Admin"],
    ["/admin/inventory", "Inventory"],
    ["/admin/procurement", "Procurement"],
    ["/admin/catalog", "Catalog"],
  ]) {
    const response = await request(path);
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(html, new RegExp(marker, "u"), path);
    assert.match(html, /Persistent staging/u, path);
    assert.match(html, /href="\/admin\/inventory"/u, path);
    assert.doesNotMatch(html, /postgresql:\/\//u, path);
  }
});

test("persistent staging renders a read-only POS register with exact demo totals", async () => {
  const response = await request("/pos");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Persistent staging · synthetic POS/u);
  assert.match(html, /Demo Linen Shirt/u);
  assert.match(html, /Complete checkout/u);
  assert.match(html, /authoritative checkout disabled/u);
  assert.match(html, /disabled/u);
});

test("persistent staging delegates API health without requiring authentication", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "healthy");
  assert.equal(body.service, "api");
  assert.equal(body.databaseMode, "direct-neon");
});

test("persistent staging exposes a bounded status document", async () => {
  const response = await request("/staging/status");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "healthy",
    service: "persistent-admin-pos-staging",
    version: "0123456789ab",
    database: "dedicated-neon-staging",
    browserMode: "synthetic-read-only",
    authentication: "not-required",
  });
});

test("persistent staging preserves HEAD and fail-closed method and route behavior", async () => {
  const head = await request("/pos", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const method = await request("/admin", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");

  const missing = await request("/not-found");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Staging route not found/u);
});

test("Neon Auth requirement redirects anonymous Admin and POS requests to the login page", async () => {
  const bindings = {
    ...environment,
    STAGING_AUTH_REQUIRED: "1",
    NEON_AUTH_URL: "https://auth.example.test/neondb/auth",
    STAGING_AUTH_FETCH: async () => Response.json(null),
  };
  for (const path of ["/admin", "/pos"]) {
    const response = await request(path, undefined, bindings);
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("returnTo"), path);
  }

  const login = await request("/login?returnTo=%2Fpos", undefined, bindings);
  const html = await login.text();
  assert.equal(login.status, 200);
  assert.match(html, /Sign in to staging/u);
  assert.match(html, /Create staging account/u);
  assert.match(html, /name="returnTo" value="\/pos"/u);
  assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

test("Neon Auth sign-up is same-origin and forwards a localized secure session cookie", async () => {
  let observedUrl = "";
  let observedBody = null;
  const bindings = {
    ...environment,
    STAGING_AUTH_REQUIRED: "1",
    NEON_AUTH_URL: "https://auth.example.test/neondb/auth",
    STAGING_AUTH_FETCH: async (input, init) => {
      observedUrl = String(input);
      observedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ user: { id: "auth-user-1" } }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "better-auth.session_token=provider-session; Domain=auth.example.test; Path=/neondb/auth; HttpOnly; Secure; SameSite=None",
          },
        },
      );
    },
  };
  const response = await request(
    "/auth/sign-up",
    {
      method: "POST",
      headers: {
        Origin: "https://staging.example.test",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Staging User",
        email: "staging.user@example.com",
        password: "correct-horse-battery-staple",
        returnTo: "/admin/inventory",
      }),
    },
    bindings,
  );
  assert.equal(observedUrl, "https://auth.example.test/neondb/auth/sign-up/email");
  assert.deepEqual(observedBody, {
    email: "staging.user@example.com",
    password: "correct-horse-battery-staple",
    name: "Staging User",
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://staging.example.test/admin/inventory");
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /better-auth\.session_token=provider-session/u);
  assert.match(cookie, /Path=\//u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /Secure/u);
  assert.match(cookie, /SameSite=Lax/u);
  assert.doesNotMatch(cookie, /Domain=/u);
});

test("authenticated Neon Auth session unlocks read-only Admin rendering without granting API writes", async () => {
  const bindings = {
    ...environment,
    STAGING_AUTH_REQUIRED: "1",
    NEON_AUTH_URL: "https://auth.example.test/neondb/auth",
    STAGING_AUTH_FETCH: async (input) => {
      assert.equal(String(input), "https://auth.example.test/neondb/auth/get-session");
      return Response.json({
        user: {
          id: "auth-user-1",
          email: "staging.user@example.com",
          name: "Staging User",
        },
        session: {
          id: "session-1",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      });
    },
  };
  const response = await request(
    "/admin/inventory",
    { headers: { Cookie: "better-auth.session_token=provider-session" } },
    bindings,
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Signed in as/u);
  assert.match(html, /Staging User/u);
  assert.match(html, /staging\.user@example\.com/u);
  assert.match(html, /action="\/auth\/sign-out"/u);
  assert.match(html, /Read-only browser milestone/u);
});
