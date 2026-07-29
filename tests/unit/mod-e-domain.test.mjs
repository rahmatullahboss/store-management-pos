import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import {
  availableRefundAmount,
  assertPaymentCommandAllowed,
  calculateSettlementNet,
  transitionPayment,
} from "../../build/modules/payments/src/domain.js";
import {
  buildJournal,
  reverseJournal,
  assertPeriodAllowsPosting,
  trialBalance,
} from "../../build/modules/accounting/src/domain.js";
import {
  matchStatementLine,
  statementFingerprint,
} from "../../build/modules/banking/src/domain.js";

const gbp = (minor) => money(BigInt(minor), "GBP", 2);

test("payment state transitions are explicit and unknown blocks blind commands", () => {
  assert.equal(transitionPayment("created", "authorize"), "authorized");
  assert.equal(transitionPayment("authorized", "capture"), "captured");
  assert.equal(transitionPayment("captured", "refund_partial"), "partially_refunded");
  assert.throws(() => transitionPayment("captured", "authorize"), /invalid payment transition/i);
  assert.throws(() => assertPaymentCommandAllowed("unknown", "capture"), /status recovery/i);
  assert.doesNotThrow(() => assertPaymentCommandAllowed("unknown", "recover_status"));
});

test("refund capacity never exceeds captured less prior refunds", () => {
  assert.equal(availableRefundAmount(gbp(10_000), gbp(2_500)).amountMinor, 7_500n);
  assert.throws(() => availableRefundAmount(gbp(10_000), gbp(10_001)), /exceed captured/i);
});

test("settlement gross-to-net arithmetic is exact", () => {
  const result = calculateSettlementNet({ gross: gbp(10_000), fees: gbp(325), adjustments: gbp(-75) });
  assert.equal(result.amountMinor, 9_750n);
  assert.throws(() => calculateSettlementNet({ gross: gbp(10_000), fees: money(100n, "BDT", 2), adjustments: gbp(0) }), /different currencies/i);
});

test("journal builder rejects unbalanced or two-sided lines", () => {
  const journal = buildJournal({
    journalId: "journal-1",
    postingGroupId: "posting-1",
    businessDate: "2026-07-28",
    currency: "GBP",
    source: { type: "sale", id: "sale-1", version: "1" },
    lines: [
      { accountCode: "1100", debit: gbp(10_000), credit: gbp(0) },
      { accountCode: "4000", debit: gbp(0), credit: gbp(8_000) },
      { accountCode: "2200", debit: gbp(0), credit: gbp(2_000) },
    ],
  });
  assert.equal(journal.totalDebit.amountMinor, 10_000n);
  assert.equal(journal.totalCredit.amountMinor, 10_000n);
  assert.throws(() => buildJournal({ ...journal, journalId: "bad", lines: [{ accountCode: "1100", debit: gbp(1), credit: gbp(1) }, { accountCode: "4000", debit: gbp(0), credit: gbp(1) }] }), /one-sided/i);
  assert.throws(() => buildJournal({ ...journal, journalId: "bad-2", lines: [{ accountCode: "1100", debit: gbp(1), credit: gbp(0) }, { accountCode: "4000", debit: gbp(0), credit: gbp(2) }] }), /not balanced/i);
});

test("journal correction creates a linked reversal without mutating original", () => {
  const original = buildJournal({
    journalId: "journal-1",
    postingGroupId: "posting-1",
    businessDate: "2026-07-28",
    currency: "GBP",
    source: { type: "payment", id: "payment-1", version: "1" },
    lines: [
      { accountCode: "1100", debit: gbp(5_000), credit: gbp(0) },
      { accountCode: "1200", debit: gbp(0), credit: gbp(5_000) },
    ],
  });
  const reversal = reverseJournal(original, { journalId: "journal-2", businessDate: "2026-07-29", reason: "Provider reversal" });
  assert.equal(reversal.reversalOfJournalId, original.journalId);
  assert.equal(reversal.lines[0].debit.amountMinor, original.lines[0].credit.amountMinor);
  assert.equal(reversal.lines[0].credit.amountMinor, original.lines[0].debit.amountMinor);
  assert.equal(original.lines[0].debit.amountMinor, 5_000n);
  assert.ok(Object.isFrozen(original));
});

test("closed periods reject ordinary posting and require explicit adjustment evidence", () => {
  assert.throws(() => assertPeriodAllowsPosting({ status: "closed", startDate: "2026-07-01", endDate: "2026-07-31" }, { businessDate: "2026-07-28", kind: "ordinary" }), /closed/i);
  assert.throws(() => assertPeriodAllowsPosting({ status: "closed", startDate: "2026-07-01", endDate: "2026-07-31" }, { businessDate: "2026-07-28", kind: "adjustment" }), /approval/i);
  assert.doesNotThrow(() => assertPeriodAllowsPosting({ status: "closed", startDate: "2026-07-01", endDate: "2026-07-31" }, { businessDate: "2026-07-28", kind: "adjustment", approvalId: "approval-1" }));
});

test("trial balance retains account drill-through and balanced control totals", () => {
  const journal = buildJournal({
    journalId: "journal-1",
    postingGroupId: "posting-1",
    businessDate: "2026-07-28",
    currency: "GBP",
    source: { type: "payment", id: "payment-1", version: "1" },
    lines: [
      { accountCode: "1100", debit: gbp(5_000), credit: gbp(0) },
      { accountCode: "1200", debit: gbp(0), credit: gbp(5_000) },
    ],
  });
  const report = trialBalance([journal]);
  assert.equal(report.totalDebit.amountMinor, 5_000n);
  assert.equal(report.totalCredit.amountMinor, 5_000n);
  assert.deepEqual(report.accounts.map((row) => row.accountCode), ["1100", "1200"]);
  assert.deepEqual(report.accounts[0].journalIds, ["journal-1"]);
});

test("bank statement fingerprints deduplicate imports and matching requires exact currency and amount", () => {
  const line = { bankAccountId: "bank-1", bookedAt: "2026-07-28", amount: gbp(9_750), reference: "SETTLEMENT-001" };
  assert.equal(statementFingerprint(line), statementFingerprint({ ...line }));
  assert.equal(matchStatementLine(line, [{ candidateId: "settlement-1", amount: gbp(9_750), reference: "SETTLEMENT-001" }]).candidateId, "settlement-1");
  assert.throws(() => matchStatementLine(line, [{ candidateId: "settlement-1", amount: gbp(9_700), reference: "SETTLEMENT-001" }]), /no exact match/i);
});
