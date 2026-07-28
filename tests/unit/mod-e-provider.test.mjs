import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { DeterministicPaymentProvider } from "../../build/modules/payments/src/simulator.js";
import { safePaymentDiagnosticFields } from "../../build/modules/payments/src/observability.js";
import { paymentStatusFromProviderResult } from "../../build/modules/payments/src/provider.js";

const amount = money(12_500n, "GBP", 2);

test("deterministic provider replays one authorization for the same idempotency key", async () => {
  const provider = new DeterministicPaymentProvider();
  const request = { intentId: "intent-1", amount, idempotencyKey: "intent-1:authorize", paymentMethodToken: "tok_safe_1" };
  const first = await provider.authorize(request);
  const second = await provider.authorize(request);
  assert.deepEqual(second, first);
  assert.equal(provider.effectCount, 1);
  assert.equal(first.status, "authorized");
});

test("timeout after provider effect enters unknown and status query recovers captured state", async () => {
  const provider = new DeterministicPaymentProvider({ timeoutAfterEffectFor: new Set(["intent-2:capture"]) });
  const authorization = await provider.authorize({ intentId: "intent-2", amount, idempotencyKey: "intent-2:authorize", paymentMethodToken: "tok_safe_2" });
  assert.equal(authorization.status, "authorized");
  await assert.rejects(() => provider.capture({ intentId: "intent-2", amount, idempotencyKey: "intent-2:capture", providerReference: authorization.providerReference }), /timeout after effect/i);
  assert.equal(paymentStatusFromProviderResult({ outcome: "ambiguous" }), "unknown");
  const recovered = await provider.queryStatus(authorization.providerReference);
  assert.equal(recovered.status, "captured");
  assert.equal(provider.effectCount, 2);
});

test("provider decline is normalized without leaking provider payload", async () => {
  const provider = new DeterministicPaymentProvider({ declineIntentIds: new Set(["intent-decline"]) });
  const result = await provider.authorize({ intentId: "intent-decline", amount, idempotencyKey: "intent-decline:authorize", paymentMethodToken: "tok_safe_3" });
  assert.equal(result.status, "declined");
  assert.equal(result.failureCategory, "issuer_decline");
  assert.equal(paymentStatusFromProviderResult({ outcome: "declined" }), "declined");
});

test("payment diagnostics recursively redact restricted card and secret fields", () => {
  const safe = safePaymentDiagnosticFields({
    provider: "simulator",
    providerReference: "pay_123",
    cardNumber: "4111111111111111",
    cvv: "123",
    authorization: "Bearer top-secret",
    nested: { pan: "5555555555554444", token: "secret-token", result: "approved" },
  });
  assert.deepEqual(safe, {
    provider: "simulator",
    providerReference: "pay_123",
    cardNumber: "[REDACTED]",
    cvv: "[REDACTED]",
    authorization: "[REDACTED]",
    nested: { pan: "[REDACTED]", token: "[REDACTED]", result: "approved" },
  });
  assert.doesNotMatch(JSON.stringify(safe), /411111|555555|top-secret|secret-token/);
});
