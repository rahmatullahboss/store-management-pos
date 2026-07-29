import test from "node:test";
import assert from "node:assert/strict";
import { adminRoutes } from "../../build/apps/admin-web/src/app-shell/routes.js";
import { renderAccountingControlPage } from "../../build/apps/admin-web/src/modules/accounting/page.js";
import { renderBankReconciliationPage } from "../../build/apps/admin-web/src/modules/banking/page.js";
import { renderPaymentOperationsPage } from "../../build/apps/admin-web/src/modules/payments/page.js";
import { formatFinanceMoney } from "../../build/apps/admin-web/src/modules/reporting/finance-ui.js";
import { permittedRoutes } from "../../build/packages/ui/src/app-shell.js";

const gbp = (amountMinor) => ({ amountMinor, currency: "GBP", scale: 2 });

test("finance routes remain permission scoped", () => {
  const paymentsOnly = permittedRoutes(adminRoutes, new Set(["payment.read"]));
  assert.ok(paymentsOnly.some((route) => route.path === "/finance/payments"));
  assert.ok(!paymentsOnly.some((route) => route.path === "/finance/accounting"));
  assert.ok(!paymentsOnly.some((route) => route.path === "/finance/banking"));
  const finance = permittedRoutes(adminRoutes, new Set(["payment.read", "accounting.read", "banking.read"]));
  assert.equal(finance.filter((route) => route.path.startsWith("/finance/")).length, 3);
});

test("payment operations page exposes recovery state and escapes external references", () => {
  const html = renderPaymentOperationsPage({
    refreshedAt: "2026-07-29T01:00:00Z",
    capturedTotal: gbp("120000"),
    refundTotal: gbp("5000"),
    unknownCount: 1,
    rows: [{
      paymentId: "payment-1",
      customerReference: "<script>alert(1)</script>",
      provider: "Provider & Co",
      amount: gbp("10000"),
      status: "unknown",
      updatedAt: "2026-07-29T00:55:00Z",
    }],
  }, "en-GB");
  assert.match(html, /<h1 id="payment-operations-title">Payment operations<\/h1>/u);
  assert.match(html, /requires recovery/u);
  assert.match(html, /£1,200\.00/u);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /Provider &amp; Co/u);
});

test("accounting page shows balanced control totals, freshness and drill-through", () => {
  const html = renderAccountingControlPage({
    refreshedAt: "2026-07-29T01:00:00Z",
    periodId: "period-1",
    periodCode: "2026-07",
    periodStatus: "soft_closed",
    totalDebit: gbp("250000"),
    totalCredit: gbp("250000"),
    openReceivableCount: 3,
    openPayableCount: 2,
    rows: [{
      accountId: "account-1",
      accountCode: "1200",
      accountName: "Accounts receivable",
      debit: gbp("250000"),
      credit: gbp("0"),
      balance: gbp("250000"),
      journalCount: "4",
    }],
  }, "en-GB");
  assert.match(html, /Trial balance is balanced/u);
  assert.match(html, /Refreshed 2026-07-29T01:00:00Z/u);
  assert.match(html, /soft closed/u);
  assert.match(html, /accountId=account-1/u);
  assert.match(html, /5<\/dd>/u);
});

test("banking page keeps partial reconciliation evidence actionable", () => {
  const html = renderBankReconciliationPage({
    bankAccountId: "bank-1",
    bankAccountName: "Operating <Main>",
    refreshedAt: "2026-07-29T01:00:00Z",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    statementTotal: gbp("10000"),
    matchedTotal: gbp("4000"),
    difference: gbp("6000"),
    rows: [{
      statementLineId: "statement-line-1",
      bookedAt: "2026-07-28",
      reference: "Settlement & fees",
      originalAmount: gbp("10000"),
      matchedAmount: gbp("4000"),
      unmatchedAmount: gbp("6000"),
      status: "partially_matched",
    }],
  }, "en-GB");
  assert.match(html, /Unreconciled difference requires review/u);
  assert.match(html, /partially matched/u);
  assert.match(html, /statementLineId=statement-line-1/u);
  assert.match(html, /Operating &lt;Main&gt;/u);
  assert.match(html, /Settlement &amp; fees/u);
});

test("exact finance formatting falls back without losing large integer precision", () => {
  assert.equal(formatFinanceMoney({ amountMinor: "123456", currency: "GBP", scale: 2 }, "en-GB"), "£1,234.56");
  assert.equal(
    formatFinanceMoney({ amountMinor: "900719925474099300", currency: "GBP", scale: 2 }, "en-GB"),
    "GBP 9007199254740993.00",
  );
  assert.throws(() => formatFinanceMoney({ amountMinor: "1.25", currency: "GBP", scale: 2 }, "en-GB"), /invalid finance money/i);
});
