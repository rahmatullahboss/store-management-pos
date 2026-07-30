import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  STAGING_RESERVATION_PERMISSION,
  STAGING_STEP_UP_SECONDS,
  STAGING_TOTP_PBKDF2_ITERATIONS,
  STAGING_TOTP_PERIOD_SECONDS,
  stagingTotpBase32,
  totpCodeAt,
  verifyTotpCode,
} from "../../build/apps/api/src/staging-mfa.js";

const factorId = "018f0000-0000-7000-8000-000000009101";
const password = "correct horse battery staple";
const rfcSecret = new TextEncoder().encode("12345678901234567890");

test("TOTP implementation matches the RFC SHA-1 vector reduced to six digits", async () => {
  const encoded = stagingTotpBase32.encode(rfcSecret);
  assert.equal(encoded, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(stagingTotpBase32.decode(encoded), rfcSecret);
  const value = await totpCodeAt(rfcSecret, 59_000);
  assert.equal(value.code, "287082");
  assert.equal(value.counter, 1);
  assert.equal(await verifyTotpCode(rfcSecret, "287082", 59_000), 1);
  assert.equal(await verifyTotpCode(rfcSecret, "000000", 59_000), null);
});

test("TOTP secret is encrypted with password-derived AES-GCM and rejects a wrong password", async () => {
  const encrypted = await encryptTotpSecret(rfcSecret, password, factorId);
  assert.equal(encrypted.iterations, 310_000);
  assert.match(encrypted.ciphertext, /^[A-Za-z0-9_-]+$/u);
  assert.match(encrypted.iv, /^[A-Za-z0-9_-]{16}$/u);
  assert.match(encrypted.salt, /^[A-Za-z0-9_-]{22}$/u);
  assert.notEqual(encrypted.ciphertext, stagingTotpBase32.encode(rfcSecret));

  const factor = {
    id: factorId,
    userId: "018f0000-0000-7000-8000-000000009001",
    tenantId: "018f0000-0000-7000-8000-000000000002",
    status: "pending",
    label: "Primary authenticator",
    ...encrypted,
  };
  assert.deepEqual(await decryptTotpSecret(factor, password), rfcSecret);
  await assert.rejects(
    () => decryptTotpSecret(factor, "incorrect-password"),
    /Current password is invalid/u,
  );
});

test("MFA constants keep the controlled command narrowly bounded", () => {
  assert.equal(STAGING_RESERVATION_PERMISSION, "inventory.reservation.manage");
  assert.equal(STAGING_STEP_UP_SECONDS, 300);
  assert.equal(STAGING_TOTP_PERIOD_SECONDS, 30);
  assert.equal(STAGING_TOTP_PBKDF2_ITERATIONS, 310_000);
});
