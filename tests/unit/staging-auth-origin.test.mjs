import assert from "node:assert/strict";
import test from "node:test";
import stagingWorker from "../../build/apps/api/src/staging.js";

function environment(fetcher) {
  return {
    DATABASE_URL: "postgresql://unused.invalid/neondb",
    APP_ENV: "staging-test",
    REGION: "test",
    STAGING_GIT_SHA: "0123456789abcdef",
    STAGING_AUTH_REQUIRED: "1",
    NEON_AUTH_URL: "https://auth.example.test/neondb/auth",
    STAGING_AUTH_FETCH: fetcher,
  };
}

function formRequest(headers = {}) {
  return new Request("https://staging.example.test/auth/sign-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams({
      email: "staging.user@example.com",
      password: "correct-horse-battery-staple",
      returnTo: "/admin",
    }),
  });
}

async function accepted(headers) {
  let called = false;
  const response = await stagingWorker.fetch(
    formRequest(headers),
    environment(async () => {
      called = true;
      return new Response(JSON.stringify({ user: { id: "auth-user-1" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "__Secure-neon-auth.session_token=provider-session; Path=/neondb/auth; HttpOnly; Secure; SameSite=None",
        },
      });
    }),
  );
  assert.equal(called, true);
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://staging.example.test/admin",
  );
}

test("same-origin Fetch Metadata permits browser form posts with omitted or opaque Origin", async () => {
  await accepted({ "Sec-Fetch-Site": "same-origin" });
  await accepted({ Origin: "null", "Sec-Fetch-Site": "same-origin" });
});

test("cross-site and origin-mismatch auth posts fail with bounded platform errors", async () => {
  for (const headers of [
    { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://evil.example", "Sec-Fetch-Site": "same-origin" },
    { Origin: "null", "Sec-Fetch-Site": "cross-site" },
    { Origin: "null" },
    {},
  ]) {
    const response = await stagingWorker.fetch(
      formRequest(headers),
      environment(async () => {
        throw new Error("provider must not be called");
      }),
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(typeof body.error.requestId, "string");
  }
});
