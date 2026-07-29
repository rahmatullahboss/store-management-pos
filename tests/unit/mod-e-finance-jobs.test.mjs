import test from "node:test";
import assert from "node:assert/strict";
import { executeFinanceJob } from "../../build/apps/worker-jobs/src/finance-jobs.js";
import { PlatformError } from "../../build/packages/foundation/src/errors.js";
import { money } from "../../build/packages/foundation/src/money.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000301",
  traceId: "finance-job-test",
  tenantId: "018f0000-0000-7000-8000-000000000302",
  actorId: "018f0000-0000-7000-8000-000000000303",
  legalEntityId: "018f0000-0000-7000-8000-000000000304",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set(["payments.recover", "banking.reconcile.auto"]),
};

function services(overrides = {}) {
  return {
    payments: {
      async recoverStatus(_context, command) {
        return {
          intentId: command.intentId,
          providerAccountId: "provider-account-1",
          providerKey: "provider-1",
          status: "captured",
          amount: money(10000n, "GBP", 2),
          capturedAmount: money(10000n, "GBP", 2),
          refundedAmount: money(0n, "GBP", 2),
          providerReference: "provider-reference-1",
          version: 2n,
          observedAt: "2026-07-29T00:00:00Z",
          replayed: false,
        };
      },
    },
    banking: {
      async recordReconciliationRun(_context, command) {
        return {
          runId: command.runId,
          status: "completed",
          sourceLineCount: 2n,
          matchedLineCount: 2n,
          exceptionCount: 0n,
          statementTotal: money(7500n, "GBP", 2),
          matchedTotal: money(7500n, "GBP", 2),
          difference: money(0n, "GBP", 2),
          replayed: false,
        };
      },
    },
    ...overrides,
  };
}

test("payment recovery job completes a resolved provider state", async () => {
  const outcome = await executeFinanceJob(context, services(), {
    type: "payment_status_recovery",
    intentId: "payment-1",
    idempotencyKey: "payment-recovery-job-001",
    requestHash: "hash-payment-recovery-job-001",
  });
  assert.deepEqual(outcome, {
    type: "payment_status_recovery",
    resourceId: "payment-1",
    status: "completed",
    replayed: false,
  });
});

test("payment recovery job requests retry while provider state remains unknown", async () => {
  const base = services();
  const outcome = await executeFinanceJob(context, services({
    payments: {
      async recoverStatus(jobContext, command) {
        const result = await base.payments.recoverStatus(jobContext, command);
        return { ...result, status: "unknown" };
      },
    },
  }), {
    type: "payment_status_recovery",
    intentId: "payment-2",
    idempotencyKey: "payment-recovery-job-002",
    requestHash: "hash-payment-recovery-job-002",
  });
  assert.equal(outcome.status, "retry");
  assert.match(outcome.reason, /remains unknown/i);
});

test("bank reconciliation control job reports completed exceptions without retrying", async () => {
  const base = services();
  const outcome = await executeFinanceJob(context, services({
    banking: {
      async recordReconciliationRun(jobContext, command) {
        const result = await base.banking.recordReconciliationRun(jobContext, command);
        return { ...result, status: "completed_with_exceptions", difference: money(6000n, "GBP", 2) };
      },
    },
  }), {
    type: "bank_reconciliation_control",
    runId: "run-1",
    bankAccountId: "bank-1",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    idempotencyKey: "bank-reconciliation-job-001",
    requestHash: "hash-bank-reconciliation-job-001",
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason, /completed with exceptions/i);
});

test("finance jobs retry transient conflicts but fail validation errors", async () => {
  const retry = await executeFinanceJob(context, services({
    payments: { async recoverStatus() { throw new PlatformError("CONFLICT", "command is processing", 409); } },
  }), {
    type: "payment_status_recovery",
    intentId: "payment-3",
    idempotencyKey: "payment-recovery-job-003",
    requestHash: "hash-payment-recovery-job-003",
  });
  assert.equal(retry.status, "retry");
  assert.match(retry.reason, /CONFLICT/u);

  const failed = await executeFinanceJob(context, services({
    banking: { async recordReconciliationRun() { throw new PlatformError("VALIDATION_FAILED", "period invalid", 400); } },
  }), {
    type: "bank_reconciliation_control",
    runId: "run-2",
    bankAccountId: "bank-1",
    periodStart: "2026-08-01",
    periodEnd: "2026-07-31",
    idempotencyKey: "bank-reconciliation-job-002",
    requestHash: "hash-bank-reconciliation-job-002",
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.reason, /VALIDATION_FAILED/u);
});
