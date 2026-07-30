import assert from "node:assert/strict";
import test from "node:test";
import stagingWorker from "../../build/apps/api/src/staging.js";

const environment = {
  DATABASE_URL: "postgresql://unused.invalid/neondb",
  APP_ENV: "staging-test",
  REGION: "test",
  STAGING_GIT_SHA: "0123456789abcdef",
};

const session = {
  user: {
    id: "018f0000-0000-7000-8000-000000009001",
    email: "staging.user@example.com",
    name: "Staging User",
  },
  tenant: {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Synthetic Beta Retail",
  },
  session: {
    id: "018f0000-0000-7000-8000-000000009002",
    expiresAt: "2030-01-01T00:00:00.000Z",
  },
};

function authStore(overrides = {}) {
  return {
    register: async () => session,
    signIn: async () => session,
    session: async () => null,
    revoke: async () => undefined,
    ...overrides,
  };
}

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

test("persistent staging renders current Admin fixture pages", async () => {
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
    assert.doesNotMatch(html, /postgresql:\/\//u, path);
  }
});

test("persistent staging renders read-only POS with exact demo totals", async () => {
  const response = await request("/pos");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Persistent staging · synthetic POS/u);
  assert.match(html, /Demo Linen Shirt/u);
  assert.match(html, /Complete checkout/u);
  assert.match(html, /authoritative checkout disabled/u);
  assert.match(html, /disabled/u);
});

test("API health remains public", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "healthy");
  assert.equal(body.service, "api");
});

test("staging status is bounded when auth is disabled", async () => {
  const response = await request("/staging/status");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "healthy");
  assert.equal(body.authentication, "not-required");
});

test("HEAD, method and missing-route behavior remain fail closed", async () => {
  const head = await request("/pos", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const method = await request("/admin", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");

  const missing = await request("/not-found");
  assert.equal(missing.status, 404);
});

test("custom auth redirects anonymous Admin and POS requests to login", async () => {
  const bindings = {
    ...environment,
    STAGING_AUTH_REQUIRED: "1",
    STAGING_AUTH_STORE: authStore(),
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
  assert.match(html, /Ozzyl custom authentication/u);
  assert.match(html, /Create staging account/u);
  assert.match(html, /name="returnTo" value="\/pos"/u);
  assert.match(html, /minlength="10"/u);
});

test("custom sign-up creates an internal account and secure opaque session cookie", async () => {
  let observed;
  const bindings = {
    ...environment,
    STAGING_AUTH_REQUIRED: "1",
    STAGING_AUTH_STORE: authStore({
      register: async (input) => {
        observed = input;
        return session;
      },
    }),
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
        email: "Staging.User@example.com",
        password: "correct-horse-battery-staple",
        returnTo: "/admin/inventory",
      }),
    },
    bindings,
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://staging.example.test/admin/inventory");
  assert.equal(observed.email, "staging.user@example.com");
  assert.equal(observed.name, "Staging User");
  assert.equal(observed.password, "correct-horse-battery-staple");
  assert.equal(observed.tenantCode, "synthetic-beta");
  assert.match(observed.tokenHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(observed.ipHash, /^[A-Za-z0-9_-]{43}$/u);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^ozzyl_staging_session=[A-Za-z0-9_-]{43};/u);
  assert.match(cookie, /Path=\//u);
  assert.match(cookie, /Max-Age=28800/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /Secure/u);
  assert.match(cookie, /SameSite=Lax/u);
  assert.doesNotMatch(cookie, /Domain=/u);
});

test("custom authenticated session unlocks read-only Admin without API authority", async () => {
  let tokenHash = "";
  const bindings = {
    ...environment,
    STAGING_AUTH_REQUIRED: "1",
    STAGING_AUTH_STORE: authStore({
      session: async (value) => {
        tokenHash = value;
        return session;
      },
    }),
  };
  const response = await request(
    "/admin/inventory",
    { headers: { Cookie: `ozzyl_staging_session=${"a".repeat(43)}` } },
    bindings,
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(tokenHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(html, /Signed in as/u);
  assert.match(html, /Staging User/u);
  assert.match(html, /staging\.user@example\.com/u);
  assert.match(html, /action="\/auth\/sign-out"/u);
  assert.match(html, /Read-only browser milestone/u);
});
