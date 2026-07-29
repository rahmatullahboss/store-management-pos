import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { AccountingService } from "../../build/modules/accounting/src/service.js";

const gbp = (minor) => money(BigInt(minor), "GBP", 2);
const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-accounting",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  legalEntityId: "018f0000-0000-7000-8000-000000000004",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-28",
  region: "test",
  permissions: new Set([
    "accounting.journal.post",
    "accounting.journal.manual",
    "accounting.journal.reverse",
    "accounting.open_item.allocate",
    "accounting.period.close",
    "accounting.period.reopen",
    "accounting.reports.read",
  ]),
};

class FakeAccountingStore {
  constructor() {
    this.journals = new Map();
    this.openItems = new Map();
    this.period = { periodId: "period-1", status: "open", version: 1n };
    this.postCalls = 0;
  }

  async postJournal(_context, command) {
    this.postCalls += 1;
    const existing = this.journals.get(command.idempotencyKey);
    if (existing) return { ...existing, replayed: true };
    const result = {
      journalId: command.journal.journalId,
      postingGroupId: command.journal.postingGroupId,
      status: "posted",
      totalDebit: command.journal.totalDebit,
      totalCredit: command.journal.totalCredit,
      businessDate: command.journal.businessDate,
      postedAt: "2026-07-28T00:00:00.000Z",
      replayed: false,
    };
    this.journals.set(command.idempotencyKey, result);
    return result;
  }

  async getJournal(_context, journalId) {
    for (const result of this.journals.values()) {
      if (result.journalId === journalId) {
        return {
          journalId: result.journalId,
          postingGroupId: result.postingGroupId,
          businessDate: result.businessDate,
          currency: "GBP",
          source: { type: "payment", id: "payment-1", version: "1" },
          lines: [
            { accountCode: "1100", accountId: "account-bank", debit: gbp(5_000), credit: gbp(0), baseDebit: gbp(5_000), baseCredit: gbp(0) },
            { accountCode: "1200", accountId: "account-ar", debit: gbp(0), credit: gbp(5_000), baseDebit: gbp(0), baseCredit: gbp(5_000) },
          ],
          status: "posted",
          totalDebit: gbp(5_000),
          totalCredit: gbp(5_000),
        };
      }
    }
    throw new Error("journal missing");
  }

  async createOpenItem(_context, command) {
    const result = {
      openItemId: command.openItemId,
      partyType: command.partyType,
      partyId: command.partyId,
      direction: command.direction,
      original: command.amount,
      allocated: gbp(0),
      outstanding: command.amount,
      status: "open",
      replayed: false,
    };
    this.openItems.set(command.openItemId, result);
    return result;
  }

  async allocateOpenItem(_context, command) {
    const item = this.openItems.get(command.openItemId);
    if (!item) throw new Error("open item missing");
    if (command.amount.amountMinor > item.outstanding.amountMinor) throw new Error("allocation exceeds outstanding amount");
    const allocated = gbp(item.allocated.amountMinor + command.amount.amountMinor);
    const outstanding = gbp(item.original.amountMinor - allocated.amountMinor);
    const result = { ...item, allocated, outstanding, status: outstanding.amountMinor === 0n ? "settled" : "partially_allocated", replayed: false };
    this.openItems.set(command.openItemId, result);
    return result;
  }

  async closePeriod(_context, command) {
    this.period = { periodId: command.periodId, status: "closed", version: this.period.version + 1n };
    return { ...this.period, replayed: false };
  }

  async reopenPeriod(_context, command) {
    this.period = { periodId: command.periodId, status: "open", version: this.period.version + 1n };
    return { ...this.period, replayed: false };
  }

  async trialBalance() {
    return {
      currency: "GBP",
      scale: 2,
      totalDebit: gbp(5_000),
      totalCredit: gbp(5_000),
      refreshedAt: "2026-07-28T00:00:00.000Z",
      rows: [{ accountId: "account-bank", accountCode: "1100", debit: gbp(5_000), credit: gbp(0), balance: gbp(5_000), journalCount: 1n }],
    };
  }

  async generalLedger() {
    return { refreshedAt: "2026-07-28T00:00:00.000Z", rows: [{ journalId: "journal-1", sourceType: "payment", sourceId: "payment-1", accountCode: "1100", debit: gbp(5_000), credit: gbp(0) }] };
  }

  async openItemAging() {
    return { refreshedAt: "2026-07-28T00:00:00.000Z", rows: [{ openItemId: "open-1", partyType: "customer", partyId: "customer-1", outstanding: gbp(5_000), bucket: "current" }] };
  }
}

function journalCommand(overrides = {}) {
  return {
    journalId: "journal-1",
    postingGroupId: "posting-1",
    chartId: "chart-1",
    fiscalPeriodId: "period-1",
    journalType: "system",
    postingKind: "ordinary",
    source: { type: "payment", id: "payment-1", version: "1" },
    transactionCurrency: "GBP",
    baseCurrency: "GBP",
    exchangeRateNumerator: 1n,
    exchangeRateDenominator: 1n,
    lines: [
      { accountId: "account-bank", accountCode: "1100", debit: gbp(5_000), credit: gbp(0), baseDebit: gbp(5_000), baseCredit: gbp(0) },
      { accountId: "account-ar", accountCode: "1200", debit: gbp(0), credit: gbp(5_000), baseDebit: gbp(0), baseCredit: gbp(5_000) },
    ],
    idempotencyKey: "journal-post-001",
    requestHash: "hash-journal-post-001",
    ...overrides,
  };
}

test("accounting service validates and posts a balanced journal once", async () => {
  const store = new FakeAccountingStore();
  const service = new AccountingService(store);
  const first = await service.postJournal(context, journalCommand());
  const replay = await service.postJournal(context, journalCommand());
  assert.equal(first.status, "posted");
  assert.equal(replay.replayed, true);
  assert.equal(first.totalDebit.amountMinor, 5_000n);
  assert.equal(store.postCalls, 2);
  await assert.rejects(() => service.postJournal(context, journalCommand({
    idempotencyKey: "journal-bad-001",
    lines: [
      { accountId: "account-bank", accountCode: "1100", debit: gbp(5_000), credit: gbp(0), baseDebit: gbp(5_000), baseCredit: gbp(0) },
      { accountId: "account-ar", accountCode: "1200", debit: gbp(0), credit: gbp(4_900), baseDebit: gbp(0), baseCredit: gbp(4_900) },
    ],
  })), /not balanced/i);
});

test("manual and adjustment journals require approved evidence", async () => {
  const service = new AccountingService(new FakeAccountingStore());
  await assert.rejects(() => service.postJournal(context, journalCommand({ journalType: "manual", idempotencyKey: "manual-1" })), /approval/i);
  await assert.rejects(() => service.postJournal(context, journalCommand({ postingKind: "adjustment", idempotencyKey: "adjustment-1" })), /approval/i);
  const posted = await service.postJournal(context, journalCommand({ journalType: "manual", approvalRequestId: "approval-1", reason: "Month-end accrual", idempotencyKey: "manual-2" }));
  assert.equal(posted.status, "posted");
  await assert.rejects(() => service.postJournal(context, journalCommand({
    journalType: "reversal",
    postingKind: "ordinary",
    approvalRequestId: "approval-2",
    reason: "Invalid reversal",
    idempotencyKey: "reversal-kind-mismatch",
  })), /must be used together/i);
  await assert.rejects(() => service.postJournal(context, journalCommand({
    journalType: "adjustment",
    postingKind: "ordinary",
    approvalRequestId: "approval-3",
    reason: "Invalid adjustment",
    idempotencyKey: "adjustment-kind-mismatch",
  })), /require adjustment posting kind/i);
});

test("journal reversal creates a new balanced correction linked to the original", async () => {
  const store = new FakeAccountingStore();
  const service = new AccountingService(store);
  await service.postJournal(context, journalCommand());
  const reversal = await service.reverseJournal(context, {
    originalJournalId: "journal-1",
    reversalJournalId: "journal-2",
    reversalPostingGroupId: "posting-group-2",
    businessDate: "2026-07-29",
    reason: "Provider reversal",
    approvalRequestId: "approval-2",
    idempotencyKey: "journal-reverse-001",
    requestHash: "hash-journal-reverse-001",
  });
  assert.equal(reversal.status, "posted");
  const stored = [...store.journals.values()].find((item) => item.journalId === "journal-2");
  assert.ok(stored);
});

test("AR and AP open items allocate exactly and reject over-allocation", async () => {
  const store = new FakeAccountingStore();
  const service = new AccountingService(store);
  const item = await service.createOpenItem(context, {
    openItemId: "open-1",
    controlAccountId: "account-ar",
    partyType: "customer",
    partyId: "customer-1",
    direction: "receivable",
    documentType: "invoice",
    documentId: "invoice-1",
    documentVersion: "1",
    amount: gbp(5_000),
    dueDate: "2026-08-15",
    journalId: "journal-1",
    idempotencyKey: "open-item-001",
    requestHash: "hash-open-item-001",
  });
  assert.equal(item.outstanding.amountMinor, 5_000n);
  const partial = await service.allocateOpenItem(context, {
    allocationId: "allocation-1",
    openItemId: "open-1",
    sourceType: "payment",
    sourceId: "payment-1",
    amount: gbp(2_000),
    journalId: "journal-1",
    idempotencyKey: "open-allocation-001",
    requestHash: "hash-open-allocation-001",
  });
  assert.equal(partial.status, "partially_allocated");
  assert.equal(partial.outstanding.amountMinor, 3_000n);
  await assert.rejects(() => service.allocateOpenItem(context, {
    allocationId: "allocation-2",
    openItemId: "open-1",
    sourceType: "payment",
    sourceId: "payment-2",
    amount: gbp(3_001),
    journalId: "journal-1",
    idempotencyKey: "open-allocation-002",
    requestHash: "hash-open-allocation-002",
  }), /exceeds outstanding/i);
  await assert.rejects(() => service.allocateOpenItem(context, {
    allocationId: "allocation-3",
    openItemId: "open-1",
    sourceType: "journal_reversal",
    sourceId: "journal-2",
    amount: gbp(2_000),
    journalId: "journal-2",
    reversalOfAllocationId: "allocation-1",
    idempotencyKey: "open-allocation-003",
    requestHash: "hash-open-allocation-003",
  }), /reversal reason/i);
});

test("period close and reopen require explicit approval evidence", async () => {
  const service = new AccountingService(new FakeAccountingStore());
  await assert.rejects(() => service.closePeriod(context, { periodId: "period-1", idempotencyKey: "close-1", requestHash: "hash-close-1", evidence: {} }), /approval/i);
  const closed = await service.closePeriod(context, { periodId: "period-1", approvalRequestId: "approval-close", idempotencyKey: "close-2", requestHash: "hash-close-2", evidence: { trialBalanceBalanced: true } });
  assert.equal(closed.status, "closed");
  await assert.rejects(() => service.reopenPeriod(context, { periodId: "period-1", reason: "Correction", idempotencyKey: "reopen-1", requestHash: "hash-reopen-1" }), /approval/i);
  const open = await service.reopenPeriod(context, { periodId: "period-1", approvalRequestId: "approval-reopen", reason: "Approved correction", idempotencyKey: "reopen-2", requestHash: "hash-reopen-2" });
  assert.equal(open.status, "open");
});

test("financial reports expose freshness and drill-through references", async () => {
  const service = new AccountingService(new FakeAccountingStore());
  const trial = await service.trialBalance(context, { chartId: "chart-1", periodId: "period-1" });
  const ledger = await service.generalLedger(context, { accountId: "account-bank", fromDate: "2026-07-01", toDate: "2026-07-31" });
  const aging = await service.openItemAging(context, { partyType: "customer", asOfDate: "2026-07-31" });
  assert.equal(trial.totalDebit.amountMinor, trial.totalCredit.amountMinor);
  assert.equal(ledger.rows[0].journalId, "journal-1");
  assert.equal(aging.rows[0].openItemId, "open-1");
  assert.match(trial.refreshedAt, /2026-07-28/);
});
