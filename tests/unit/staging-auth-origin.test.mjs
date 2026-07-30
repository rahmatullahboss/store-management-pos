import assert from "node:assert/strict";
import test from "node:test";
import stagingWorker from "../../build/apps/api/src/staging.js";

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

function environment(store) {
  return {
    DATABASE_URL: "postgresql://unused.invalid/neondb",
    APP_ENV: "staging-test",
    REGION: "test",
    STAGING_GIT_SHA: "0123456789abcdef",
    STAGING_AUTH_REQUIRED: "1",
    STAGING_AUTH_STORE: store,
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
  const store = {
    register: async () => session,
    signIn: async () => {
      called = true;
      return session;
    },
    session: async () => null,
    revoke: async () => undefined,
  };
  const response = await stagingWorker.fetch(
    formRequest(headers),
    environment(store),
  );
  assert.equal(called, true);
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://staging.example.test/admin",
  );
  assert.match(
    response.headers.get("set-cookie") ?? "",
    /^ozzyl_staging_session=[A-Za-z0-9_-]{43};/u,
  );
}

test("same-origin Fetch Metadata permits omitted or opaque Origin", async () => {
  await accepted({ "Sec-Fetch-Site": "same-origin" });
  await accepted({ Origin: "null", "Sec-Fetch-Site": "same-origin" });
});

test("cross-site and origin-mismatch posts fail before custom auth store access", async () => {
  for (const headers of [
    { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://evil.example", "Sec-Fetch-Site": "same-origin" },
    { Origin: "null", "Sec-Fetch-Site": "cross-site" },
    { Origin: "null" },
    {},
  ]) {
    let called = false;
    const response = await stagingWorker.fetch(
      formRequest(headers),
      environment({
        register: async () => session,
        signIn: async () => {
          called = true;
          return session;
        },
        session: async () => null,
        revoke: async () => undefined,
      }),
    );
    assert.equal(called, false);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(typeof body.error.requestId, "string");
  }
});
