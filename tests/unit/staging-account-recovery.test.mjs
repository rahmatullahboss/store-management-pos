import assert from "node:assert/strict";
import test from "node:test";
import {
  handleStagingAccountRecoveryRequest,
  stagingAccountRecoveryConstants,
} from "../../build/apps/api/src/staging-account-recovery.js";

const origin = "https://store-pos-staging.example";

function actionRequest(pathname, fields) {
  return new Request(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Account-Recovery-Test/1.0",
      "x-forwarded-for": "203.0.113.7",
      "x-request-id": `request-${crypto.randomUUID()}`,
    },
    body: new URLSearchParams(fields),
  });
}

function fakeStore(overrides = {}) {
  return {
    async requestActionToken() {
      return { issued: false };
    },
    async completePasswordReset() {
      return false;
    },
    async completeEmailVerification() {
      return false;
    },
    ...overrides,
  };
}

function cookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const value = response.headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,]+=)/u) : [];
}

test("known and unknown recovery requests have the same visible response", async () => {
  let knownInput;
  let deliveryInput;
  const known = await handleStagingAccountRecoveryRequest(
    actionRequest("/auth/password-recovery/request", {
      email: "operator@example.test",
    }),
    new URL(`${origin}/auth/password-recovery/request`),
    {
      DATABASE_URL: "unused",
      STAGING_AUTH_TENANT_CODE: "synthetic-beta",
      STAGING_ACCOUNT_RECOVERY_STORE: fakeStore({
        async requestActionToken(input) {
          knownInput = input;
          return { issued: true, email: "operator@example.test" };
        },
      }),
      STAGING_AUTH_DELIVERY: {
        async deliverPasswordRecovery(input) {
          deliveryInput = input;
        },
      },
    },
  );
  const unknown = await handleStagingAccountRecoveryRequest(
    actionRequest("/auth/password-recovery/request", {
      email: "missing@example.test",
    }),
    new URL(`${origin}/auth/password-recovery/request`),
    {
      DATABASE_URL: "unused",
      STAGING_AUTH_TENANT_CODE: "synthetic-beta",
      STAGING_ACCOUNT_RECOVERY_STORE: fakeStore(),
    },
  );

  assert.equal(known?.status, 303);
  assert.equal(unknown?.status, 303);
  assert.equal(known?.headers.get("location"), `${origin}/forgot-password?requested=1`);
  assert.equal(unknown?.headers.get("location"), `${origin}/forgot-password?requested=1`);
  assert.match(knownInput.tokenHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(knownInput.purpose, "password_recovery");
  assert.equal(knownInput.tenantCode, "synthetic-beta");
  assert.match(deliveryInput.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(knownInput.tokenHash, deliveryInput.token);
  assert.ok(deliveryInput.resetUrl.endsWith(`/reset-password?token=${deliveryInput.token}`));
  assert.equal(JSON.stringify(knownInput).includes(deliveryInput.token), false);
});

test("successful reset sends only a hash to the store and clears session and step-up cookies", async () => {
  const rawToken = "A".repeat(43);
  let completedInput;
  const response = await handleStagingAccountRecoveryRequest(
    actionRequest("/auth/password-recovery/complete", {
      token: rawToken,
      password: "new-password-12345",
      confirmPassword: "new-password-12345",
    }),
    new URL(`${origin}/auth/password-recovery/complete`),
    {
      DATABASE_URL: "unused",
      STAGING_ACCOUNT_RECOVERY_STORE: fakeStore({
        async completePasswordReset(tokenHash, password, requestId) {
          completedInput = { tokenHash, password, requestId };
          return true;
        },
      }),
    },
  );

  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), `${origin}/password-reset-complete`);
  assert.match(completedInput.tokenHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(completedInput.tokenHash, rawToken);
  assert.equal(completedInput.password, "new-password-12345");
  const cookies = cookieValues(response);
  assert.equal(cookies.some((value) => value.startsWith("ozzyl_staging_session=;")), true);
  assert.equal(cookies.some((value) => value.startsWith("ozzyl_staging_step_up=;")), true);
  assert.equal(cookies.every((value) => value.includes("HttpOnly") && value.includes("Secure")), true);
});

test("used or invalid reset token receives a bounded generic failure", async () => {
  const rawToken = "B".repeat(43);
  const response = await handleStagingAccountRecoveryRequest(
    actionRequest("/auth/password-recovery/complete", {
      token: rawToken,
      password: "another-password-123",
      confirmPassword: "another-password-123",
    }),
    new URL(`${origin}/auth/password-recovery/complete`),
    {
      DATABASE_URL: "unused",
      STAGING_ACCOUNT_RECOVERY_STORE: fakeStore(),
    },
  );

  assert.equal(response?.status, 303);
  const location = response?.headers.get("location") ?? "";
  assert.ok(location.startsWith(`${origin}/reset-password?error=`));
  assert.equal(location.includes(rawToken), false);
  assert.equal(cookieValues(response).length, 0);
});

test("cross-site recovery action fails closed", async () => {
  const request = new Request(`${origin}/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ email: "operator@example.test" }),
  });
  const response = await handleStagingAccountRecoveryRequest(
    request,
    new URL(request.url),
    {
      DATABASE_URL: "unused",
      STAGING_ACCOUNT_RECOVERY_STORE: fakeStore(),
    },
  );
  assert.equal(response?.status, 403);
  assert.match(await response.text(), /request was rejected/u);
});

test("email verification consumes only a hashed single-use token", async () => {
  const rawToken = "C".repeat(43);
  let receivedHash;
  const response = await handleStagingAccountRecoveryRequest(
    actionRequest("/auth/email-verification/complete", { token: rawToken }),
    new URL(`${origin}/auth/email-verification/complete`),
    {
      DATABASE_URL: "unused",
      STAGING_ACCOUNT_RECOVERY_STORE: fakeStore({
        async completeEmailVerification(tokenHash) {
          receivedHash = tokenHash;
          return true;
        },
      }),
    },
  );
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), `${origin}/email-verification-complete`);
  assert.match(receivedHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(receivedHash, rawToken);
});

test("account recovery constants remain bounded", () => {
  assert.equal(stagingAccountRecoveryConstants.passwordRecoverySeconds, 900);
  assert.equal(stagingAccountRecoveryConstants.emailVerificationSeconds, 86_400);
  assert.equal(stagingAccountRecoveryConstants.tokenLength, 43);
  assert.equal(stagingAccountRecoveryConstants.minimumPasswordLength, 10);
  assert.equal(stagingAccountRecoveryConstants.maximumPasswordLength, 128);
});
