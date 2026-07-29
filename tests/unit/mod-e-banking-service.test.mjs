import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { BankingService, InMemoryBankingStore } from "../../build/modules/banking/src/service.js";

const gbp = (minor) => money(BigInt(minor), "GBP", 2);
const context = {
  requestId: "018f0000-0000-7000-8000-000000000101",
  traceId: "trace-banking",
  tenantId: "018f0000-0000-7000-8000-000000000102",
  actorId: "018f0000-0000-7000-8000-000000000103",
  legalEntityId: "018f0000-0000-7000-8000-000000000104",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-28",
  region: "test",
  permissions: new Set([
    "banking.read",
    "banking.statement.import",
    "banking.reconcile.auto",
    "banking.reconcile.manual",
  ]),
};

function statementCommand(overrides = {}) {
  return {
    statementImportId: "statement-import-1",
    bankAccountId: "bank-account-1",
    sourceType: "csv",
    sourceName: "statement-july.csv",
    sourceHash: "source-hash-july",
    lines: [
      {
        statementLineId: "statement-line-1",
        lineNumber: 1,
        bookedAt: "2026-07-28T12:00:00.000Z",
        valueDate: "2026-07-28",
        amount: gbp(10_000),
        runningBalance: gbp(25_000),
        reference: "Provider Settlement 001",
        externalId: "bank-line-001",
      },
      {
        statementLineId: "statement-line-2",
        lineNumber: 2,
        bookedAt: "2026-07-28T13:00:00.000Z",
        amount: gbp(-2_500),
        reference: "Supplier Payment 001",
        externalId: "bank-line-002",
      },
    ],
    idempotencyKey: "statement-import-july-001",
    requestHash: "hash-statement-import-july-001",
    ...overrides,
  };
}

test("statement import fingerprints lines and replays one immutable result", async () => {
  const service = new BankingService(new InMemoryBankingStore());
  const first = await service.importStatement(context, statementCommand());
  const replay = await service.importStatement(context, statementCommand({ statementImportId: "statement-import-other" }));
  assert.equal(first.status, "completed");
  assert.equal(first.lineCount, 2);
  assert.match(first.lines[0].fingerprint, /^[0-9a-f]{16}$/u);
  assert.equal(first.lines[0].reconciliationStatus, "unmatched");
  assert.equal(replay.statementImportId, "statement-import-1");
  assert.equal(replay.replayed, true);
  await assert.rejects(() => service.importStatement(context, statementCommand({ requestHash: "different-hash" })), /payload mismatch/i);
});

test("statement import detects duplicate source and invalid line identity", async () => {
  const service = new BankingService(new InMemoryBankingStore());
  await service.importStatement(context, statementCommand());
  const duplicate = await service.importStatement(context, statementCommand({
    statementImportId: "statement-import-2",
    idempotencyKey: "statement-import-july-002",
    requestHash: "hash-statement-import-july-002",
  }));
  assert.equal(duplicate.status, "duplicate");
  await assert.rejects(() => service.importStatement(context, statementCommand({
    statementImportId: "bad-import",
    sourceHash: "bad-source",
    idempotencyKey: "bad-statement-import",
    requestHash: "hash-bad-import",
    lines: [
      { statementLineId: "bad-1", lineNumber: 1, bookedAt: "2026-07-28T00:00:00Z", amount: gbp(1), reference: "A" },
      { statementLineId: "bad-2", lineNumber: 1, bookedAt: "2026-07-28T00:01:00Z", amount: gbp(2), reference: "B" },
    ],
  })), /line numbers/i);
});

test("bank reconciliation supports partial exact matching and blocks over-match", async () => {
  const service = new BankingService(new InMemoryBankingStore());
  await service.importStatement(context, statementCommand());
  const partial = await service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-1",
    statementLineId: "statement-line-1",
    candidateType: "settlement",
    candidateId: "settlement-1",
    amount: gbp(4_000),
    matchMethod: "manual",
    reason: "Confirmed provider batch",
    idempotencyKey: "reconcile-settlement-001",
    requestHash: "hash-reconcile-settlement-001",
  });
  assert.equal(partial.statementStatus, "partially_matched");
  assert.equal(partial.statementUnmatchedAmount.amountMinor, 6_000n);
  const completed = await service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-2",
    statementLineId: "statement-line-1",
    candidateType: "settlement",
    candidateId: "settlement-2",
    amount: gbp(6_000),
    matchMethod: "automatic",
    confidenceBasisPoints: 10_000,
    ruleId: "rule-settlement-reference",
    idempotencyKey: "reconcile-settlement-002",
    requestHash: "hash-reconcile-settlement-002",
  });
  assert.equal(completed.statementStatus, "matched");
  assert.equal(completed.statementUnmatchedAmount.amountMinor, 0n);
  await assert.rejects(() => service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-3",
    statementLineId: "statement-line-2",
    candidateType: "supplier_payment",
    candidateId: "supplier-payment-1",
    amount: gbp(-2_501),
    matchMethod: "manual",
    reason: "Too much",
    idempotencyKey: "reconcile-supplier-001",
    requestHash: "hash-reconcile-supplier-001",
  }), /exceeds the unmatched/i);
});

test("automatic and manual reconciliation enforce distinct evidence", async () => {
  const service = new BankingService(new InMemoryBankingStore());
  await service.importStatement(context, statementCommand());
  await assert.rejects(() => service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-auto-bad",
    statementLineId: "statement-line-1",
    candidateType: "settlement",
    candidateId: "settlement-auto-bad",
    amount: gbp(10_000),
    matchMethod: "automatic",
    confidenceBasisPoints: 9_000,
    idempotencyKey: "reconcile-auto-bad",
    requestHash: "hash-reconcile-auto-bad",
  }), /requires a rule/i);
  await assert.rejects(() => service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-manual-bad",
    statementLineId: "statement-line-1",
    candidateType: "settlement",
    candidateId: "settlement-manual-bad",
    amount: gbp(10_000),
    matchMethod: "manual",
    idempotencyKey: "reconcile-manual-bad",
    requestHash: "hash-reconcile-manual-bad",
  }), /manual reconciliation reason/i);
});

test("reconciliation reversal is append-only, replayable and restores unmatched balance", async () => {
  const service = new BankingService(new InMemoryBankingStore());
  await service.importStatement(context, statementCommand());
  await service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-original",
    statementLineId: "statement-line-1",
    candidateType: "settlement",
    candidateId: "settlement-original",
    amount: gbp(10_000),
    matchMethod: "manual",
    reason: "Confirmed settlement",
    idempotencyKey: "reconcile-original-001",
    requestHash: "hash-reconcile-original-001",
  });
  const reversed = await service.reverseReconciliation(context, {
    reconciliationId: "reconciliation-reversal",
    originalReconciliationId: "reconciliation-original",
    reason: "Wrong settlement selected",
    idempotencyKey: "reconcile-reversal-001",
    requestHash: "hash-reconcile-reversal-001",
  });
  assert.equal(reversed.status, "reversed");
  assert.equal(reversed.matchedAmount.amountMinor, -10_000n);
  assert.equal(reversed.statementUnmatchedAmount.amountMinor, 10_000n);
  assert.equal(reversed.statementStatus, "reversed");
  const replay = await service.reverseReconciliation(context, {
    reconciliationId: "reconciliation-other",
    originalReconciliationId: "reconciliation-original",
    reason: "Wrong settlement selected",
    idempotencyKey: "reconcile-reversal-001",
    requestHash: "hash-reconcile-reversal-001",
  });
  assert.equal(replay.reconciliationId, "reconciliation-reversal");
  assert.equal(replay.replayed, true);
  await assert.rejects(() => service.reverseReconciliation(context, {
    reconciliationId: "reconciliation-second-reversal",
    originalReconciliationId: "reconciliation-original",
    reason: "Attempt second reversal",
    idempotencyKey: "reconcile-reversal-002",
    requestHash: "hash-reconcile-reversal-002",
  }), /already reversed/i);
  const outstanding = await service.listUnreconciled(context, "bank-account-1");
  assert.equal(outstanding.find((line) => line.statementLineId === "statement-line-1").unmatchedAmount.amountMinor, 10_000n);
  const rematched = await service.reconcileStatementLine(context, {
    reconciliationId: "reconciliation-corrected",
    statementLineId: "statement-line-1",
    candidateType: "settlement",
    candidateId: "settlement-original",
    amount: gbp(10_000),
    matchMethod: "manual",
    reason: "Corrected settlement match",
    idempotencyKey: "reconcile-corrected-001",
    requestHash: "hash-reconcile-corrected-001",
  });
  assert.equal(rematched.statementStatus, "matched");
});

test("banking service denies operations without scoped permission", async () => {
  const service = new BankingService(new InMemoryBankingStore());
  const denied = { ...context, permissions: new Set() };
  await assert.rejects(() => service.importStatement(denied, statementCommand()), /permission denied/i);
  await assert.rejects(() => service.listUnreconciled(denied), /permission denied/i);
});
