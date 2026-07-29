import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { PlatformError } from "../../build/packages/foundation/src/errors.js";
import { DeterministicPaymentProvider } from "../../build/modules/payments/src/simulator.js";
import { MapPaymentProviderRegistry, PaymentService } from "../../build/modules/payments/src/service.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-payments",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  legalEntityId: "018f0000-0000-7000-8000-000000000004",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-28",
  region: "test",
  permissions: new Set([
    "payments.intent.create",
    "payments.authorize",
    "payments.capture",
    "payments.refund.request",
    "payments.refund.approve",
    "payments.recover",
    "payments.settlement.import",
  ]),
};
const gbp = (minor) => money(BigInt(minor), "GBP", 2);

class FakePaymentStore {
  constructor() {
    this.intent = null;
    this.attempts = new Map();
    this.refunds = new Map();
    this.settlements = new Map();
    this.completeCalls = [];
  }

  async createIntent(_context, command) {
    if (this.intent) {
      if (this.intent.requestHash !== command.requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "different request", 409);
      return { ...this.intent.result, replayed: true };
    }
    const result = {
      intentId: command.intentId,
      providerAccountId: command.providerAccountId,
      providerKey: "simulator",
      status: "created",
      amount: command.amount,
      capturedAmount: gbp(0),
      refundedAmount: gbp(0),
      methodReference: command.methodReference,
      version: 1n,
      observedAt: "2026-07-28T00:00:00.000Z",
      replayed: false,
    };
    this.intent = { requestHash: command.requestHash, result };
    return result;
  }

  async beginAttempt(_context, command) {
    const existing = this.attempts.get(command.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== command.requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "different request", 409);
      return existing.claim.completedResult ? { ...existing.claim, execute: false, replayed: true } : { ...existing.claim, execute: false, replayed: false };
    }
    if (!this.intent) throw new PlatformError("NOT_FOUND", "intent missing", 404);
    if (this.intent.result.status === "unknown" && command.operation !== "status_query") throw new PlatformError("CONFLICT", "status recovery is required", 409);
    const claim = {
      execute: true,
      replayed: false,
      attemptId: `attempt-${this.attempts.size + 1}`,
      operation: command.operation,
      intentId: this.intent.result.intentId,
      providerKey: this.intent.result.providerKey,
      providerReference: this.intent.result.providerReference,
      methodReference: this.intent.result.methodReference,
      commandAmount: command.amount ?? gbp(this.intent.result.amount.amountMinor - this.intent.result.capturedAmount.amountMinor),
      currentStatus: this.intent.result.status,
    };
    this.attempts.set(command.idempotencyKey, { requestHash: command.requestHash, claim });
    return claim;
  }

  async completeAttempt(_context, command) {
    this.completeCalls.push(command);
    const result = {
      ...this.intent.result,
      status: command.status,
      providerReference: command.providerReference,
      capturedAmount: command.status === "captured" ? this.intent.result.amount : this.intent.result.capturedAmount,
      version: this.intent.result.version + 1n,
      observedAt: command.observedAt,
      replayed: false,
    };
    this.intent.result = result;
    const attempt = [...this.attempts.values()].find((entry) => entry.claim.attemptId === command.attemptId);
    if (attempt) attempt.claim.completedResult = result;
    return result;
  }

  async beginRefund(_context, command) {
    if (!this.intent) throw new PlatformError("NOT_FOUND", "intent missing", 404);
    const existing = this.refunds.get(command.idempotencyKey);
    if (existing) return { ...existing, execute: false, replayed: true };
    const claim = {
      execute: true,
      replayed: false,
      refundId: command.refundId,
      attemptId: `refund-attempt-${this.refunds.size + 1}`,
      intentId: this.intent.result.intentId,
      providerKey: this.intent.result.providerKey,
      providerReference: this.intent.result.providerReference,
      commandAmount: command.amount,
      currentStatus: this.intent.result.status,
      finalRefund: command.amount.amountMinor === this.intent.result.capturedAmount.amountMinor - this.intent.result.refundedAmount.amountMinor,
    };
    this.refunds.set(command.idempotencyKey, claim);
    return claim;
  }

  async completeRefund(_context, command) {
    const refundedAmount = gbp(this.intent.result.refundedAmount.amountMinor + command.amount.amountMinor);
    const result = {
      refundId: command.refundId,
      intentId: this.intent.result.intentId,
      status: command.status,
      amount: command.amount,
      providerReference: command.providerReference,
      observedAt: command.observedAt,
      replayed: false,
    };
    this.intent.result = {
      ...this.intent.result,
      status: command.status === "succeeded" ? (refundedAmount.amountMinor === this.intent.result.capturedAmount.amountMinor ? "refunded" : "partially_refunded") : command.status === "unknown" ? "unknown" : this.intent.result.status,
      refundedAmount,
      version: this.intent.result.version + 1n,
    };
    return result;
  }

  async importSettlement(_context, command) {
    const existing = this.settlements.get(command.providerSettlementId);
    if (existing) return { ...existing, replayed: true };
    const result = { ...command, settlementId: command.settlementId, status: "imported", replayed: false };
    this.settlements.set(command.providerSettlementId, result);
    return result;
  }
}

function service(store, provider = new DeterministicPaymentProvider()) {
  return new PaymentService(store, new MapPaymentProviderRegistry([["simulator", provider]]));
}

async function createdAndAuthorized(store, paymentService, intentId = "intent-1") {
  await paymentService.createIntent(context, {
    intentId,
    providerAccountId: "provider-1",
    sourceType: "invoice",
    sourceId: "invoice-1",
    sourceVersion: "1",
    amount: gbp(12_500),
    methodReference: "tok_safe_1",
    idempotencyKey: `${intentId}:create`,
    requestHash: "create-hash",
  });
  return await paymentService.authorize(context, { intentId, idempotencyKey: `${intentId}:authorize`, requestHash: "authorize-hash" });
}

test("payment service creates and authorizes once for duplicate idempotency", async () => {
  const store = new FakePaymentStore();
  const provider = new DeterministicPaymentProvider();
  const paymentService = service(store, provider);
  const authorization = await createdAndAuthorized(store, paymentService);
  const replay = await paymentService.authorize(context, { intentId: "intent-1", idempotencyKey: "intent-1:authorize", requestHash: "authorize-hash" });
  assert.equal(authorization.status, "authorized");
  assert.equal(replay.status, "authorized");
  assert.equal(provider.effectCount, 1);
  assert.equal(store.completeCalls.length, 1);
});

test("provider timeout after capture records unknown and recovery queries provider state", async () => {
  const store = new FakePaymentStore();
  const provider = new DeterministicPaymentProvider({ timeoutAfterEffectFor: new Set(["intent-2:capture"]) });
  const paymentService = service(store, provider);
  await createdAndAuthorized(store, paymentService, "intent-2");
  const ambiguous = await paymentService.capture(context, { intentId: "intent-2", idempotencyKey: "intent-2:capture", requestHash: "capture-hash" });
  assert.equal(ambiguous.status, "unknown");
  await assert.rejects(() => paymentService.capture(context, { intentId: "intent-2", idempotencyKey: "intent-2:capture-2", requestHash: "capture-hash-2" }), /status recovery/i);
  const recovered = await paymentService.recoverStatus(context, { intentId: "intent-2", idempotencyKey: "intent-2:recover", requestHash: "recover-hash" });
  assert.equal(recovered.status, "captured");
  assert.equal(provider.effectCount, 2);
  assert.equal(store.completeCalls.at(-1).outcome, "succeeded");
});

test("refund requires permission and completes exact full refund", async () => {
  const store = new FakePaymentStore();
  const paymentService = service(store);
  await createdAndAuthorized(store, paymentService, "intent-3");
  await paymentService.capture(context, { intentId: "intent-3", idempotencyKey: "intent-3:capture", requestHash: "capture" });
  const result = await paymentService.refund(context, {
    refundId: "refund-1",
    intentId: "intent-3",
    amount: gbp(12_500),
    reason: "Customer return",
    approvalRequestId: "approval-1",
    idempotencyKey: "refund-1:create",
    requestHash: "refund-hash",
  });
  assert.equal(result.status, "succeeded");
  assert.equal(store.intent.result.status, "refunded");

  const deniedContext = { ...context, permissions: new Set(["payments.refund.request"]) };
  await assert.rejects(() => paymentService.refund(deniedContext, {
    refundId: "refund-2",
    intentId: "intent-3",
    amount: gbp(100),
    reason: "Denied",
    approvalRequestId: "approval-2",
    idempotencyKey: "refund-2:create",
    requestHash: "refund-hash-2",
  }), /payments\.refund\.approve/i);
});

test("settlement import validates provider arithmetic and replays duplicate", async () => {
  const store = new FakePaymentStore();
  const paymentService = service(store);
  const command = {
    settlementId: "settlement-1",
    providerAccountId: "provider-1",
    providerSettlementId: "provider-settlement-1",
    gross: gbp(12_500),
    fees: gbp(300),
    adjustments: gbp(-50),
    net: gbp(12_250),
    settledAt: "2026-07-28T12:00:00.000Z",
    sourceHash: "settlement-hash",
    idempotencyKey: "settlement-1:import",
    requestHash: "settlement-request-hash",
  };
  const first = await paymentService.importSettlement(context, command);
  const replay = await paymentService.importSettlement(context, command);
  assert.equal(first.status, "imported");
  assert.equal(replay.replayed, true);
  await assert.rejects(() => paymentService.importSettlement(context, { ...command, providerSettlementId: "bad", net: gbp(1) }), /does not reconcile/i);
});
